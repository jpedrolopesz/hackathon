import { describe, expect, it } from 'vitest';
import {
  assertClassOwner,
  assertRole,
  assertSameInstitution,
} from '@/application/authorization/guards';
import { DomainError } from '@/domain/errors/DomainError';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import { buildContext } from '../use-cases/fixtures';

const classGroup: ClassGroup = {
  classId: 'class-1',
  courseId: 'course-1',
  institutionId: 'institution-1',
  teacherId: 'teacher-1',
  name: 'Arquitetura de Software',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function codeOf(fn: () => void): string {
  try {
    fn();
    throw new Error('expected fn to throw');
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
}

describe('assertSameInstitution', () => {
  it('allows a user from the same institution', () => {
    const context = buildContext({ institutionId: 'institution-1' });
    expect(() => assertSameInstitution(context, 'institution-1')).not.toThrow();
  });

  it('rejects a user from another institution with a generic not-found (seção 14 do README — anti-enumeração)', () => {
    const context = buildContext({ institutionId: 'institution-2' });
    expect(codeOf(() => assertSameInstitution(context, 'institution-1'))).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });
});

describe('assertRole', () => {
  it('allows a role in the allowed list', () => {
    const context = buildContext({ role: 'PROFESSOR' });
    expect(() => assertRole(context, ['ADMIN', 'PROFESSOR'])).not.toThrow();
  });

  it('rejects a role outside the allowed list', () => {
    const context = buildContext({ role: 'ALUNO' });
    expect(codeOf(() => assertRole(context, ['ADMIN', 'PROFESSOR']))).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('assertClassOwner', () => {
  it('always allows ADMIN', () => {
    const context = buildContext({ role: 'ADMIN', userId: 'admin-1' });
    expect(() => assertClassOwner(context, classGroup)).not.toThrow();
  });

  it('allows the PROFESSOR who owns the class', () => {
    const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-1' });
    expect(() => assertClassOwner(context, classGroup)).not.toThrow();
  });

  it('rejects a PROFESSOR editing another turma (seção 17 do README)', () => {
    const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-2' });
    expect(codeOf(() => assertClassOwner(context, classGroup))).toBe('CLASS_NOT_OWNED');
  });

  it('rejects an ALUNO regardless of userId', () => {
    const context = buildContext({ role: 'ALUNO', userId: 'teacher-1' });
    expect(codeOf(() => assertClassOwner(context, classGroup))).toBe('CLASS_NOT_OWNED');
  });
});
