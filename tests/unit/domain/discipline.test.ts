import { describe, expect, it } from 'vitest';
import type { Discipline } from '@/domain/entities/Discipline';

describe('Discipline', () => {
  it('represents a discipline belonging to a course', () => {
    const discipline: Discipline = {
      id: 'discipline-statistics',
      institutionId: 'institution-fictional',
      courseId: 'course-data-science',
      name: 'Estatística I',
      semester: '2026.1',
      createdAt: '2026-01-10T10:00:00.000Z',
    };

    expect(discipline).toMatchObject({
      courseId: 'course-data-science',
      semester: '2026.1',
    });
  });
});
