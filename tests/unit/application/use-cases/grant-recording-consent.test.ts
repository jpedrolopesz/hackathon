import { describe, expect, it } from 'vitest';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import { GrantRecordingConsentUseCase } from '@/application/use-cases/grant-recording-consent';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

class FakeRecordingConsentRepository implements RecordingConsentRepository {
  readonly saved: RecordingConsent[] = [];

  async save(consent: RecordingConsent): Promise<void> {
    this.saved.push(consent);
  }

  async findActiveConsent(): Promise<RecordingConsent | null> {
    return null;
  }
}

const context = {
  userId: 'user-fictional',
  institutionId: 'institution-fictional',
  role: 'ALUNO',
} as const;

const validInput = {
  institutionId: 'institution-fictional',
  liveSessionId: 'live-statistics',
  participantUserId: 'user-fictional',
  purposes: ['TRANSCRIPTION', 'EDUCATIONAL_GUIDANCE'],
  grantedAt: '2026-01-12T09:00:00.000Z',
  validFrom: '2026-01-12T09:00:00.000Z',
  validUntil: '2026-01-12T12:00:00.000Z',
} as const;

function setup() {
  const repository = new FakeRecordingConsentRepository();
  const useCase = new GrantRecordingConsentUseCase(repository);
  return { repository, useCase };
}

describe('GrantRecordingConsentUseCase', () => {
  it('persists a valid active consent with no revocation', async () => {
    const { repository, useCase } = setup();

    const consent = await useCase.execute(context, validInput);

    expect(consent.id).toBeTruthy();
    expect(consent.status).toBe('ACTIVE');
    expect(consent.revokedAt).toBeNull();
    expect(repository.saved).toEqual([consent]);
  });

  it('rejects empty purposes without persisting', async () => {
    const { repository, useCase } = setup();

    await expect(useCase.execute(context, { ...validInput, purposes: [] })).rejects.toMatchObject({
      code: 'CONSENT_PURPOSES_REQUIRED',
    });
    expect(repository.saved).toEqual([]);
  });

  it.each([
    ['equal', '2026-01-12T09:00:00.000Z'],
    ['before', '2026-01-12T08:59:59.000Z'],
  ])('rejects validUntil %s validFrom without persisting', async (_case, validUntil) => {
    const { repository, useCase } = setup();

    await expect(useCase.execute(context, { ...validInput, validUntil })).rejects.toMatchObject({
      code: 'CONSENT_VALIDITY_INVALID',
    });
    expect(repository.saved).toEqual([]);
  });

  it('rejects a context from another institution', async () => {
    const { repository, useCase } = setup();
    const foreignContext = { ...context, institutionId: 'institution-foreign-fictional' };

    await expect(useCase.execute(foreignContext, validInput)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(repository.saved).toEqual([]);
  });
});
