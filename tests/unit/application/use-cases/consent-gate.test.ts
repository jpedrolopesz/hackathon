import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import { AssertRecordingConsentUseCase } from '@/application/use-cases/assert-recording-consent';
import { consentGate } from '@/application/use-cases/consent-gate';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

class FakeRecordingConsentRepository implements RecordingConsentRepository {
  consent: RecordingConsent | null = null;
  calls = 0;

  async findActiveConsent(): Promise<RecordingConsent | null> {
    this.calls += 1;
    return this.consent;
  }
}

const context = {
  userId: 'worker-fictional',
  institutionId: 'institution-fictional',
  role: 'ADMIN',
} as const;

const input = {
  institutionId: 'institution-fictional',
  liveSessionId: 'live-statistics',
  participantUserId: 'participant-fictional',
  atInstant: '2026-01-12T10:00:00.000Z',
} as const;

function consent(overrides: Partial<RecordingConsent> = {}): RecordingConsent {
  return {
    id: 'consent-fictional',
    institutionId: 'institution-fictional',
    liveSessionId: 'live-statistics',
    participantUserId: 'participant-fictional',
    purposes: ['TRANSCRIPTION'],
    grantedAt: '2026-01-12T08:00:00.000Z',
    validFrom: '2026-01-12T09:00:00.000Z',
    validUntil: '2026-01-12T11:00:00.000Z',
    revokedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function setup() {
  const repository = new FakeRecordingConsentRepository();
  const useCase = new AssertRecordingConsentUseCase(repository);
  return { repository, useCase };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recording consent gate', () => {
  it('allows a currently valid consent and returns its reference', async () => {
    const { repository, useCase } = setup();
    repository.consent = consent();

    await expect(consentGate(useCase, context, input)).resolves.toEqual({
      allowed: true,
      consentRef: 'consent-fictional',
    });
  });

  it('discards and logs an event when no consent exists', async () => {
    const { useCase } = setup();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(consentGate(useCase, context, input)).resolves.toEqual({
      allowed: false,
      reason: 'NO_CONSENT',
    });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('"decision":"DISCARDED"');
    expect(log.mock.calls[0]?.[0]).toContain('"reason":"NO_CONSENT"');
  });

  it('discards a revoked consent', async () => {
    const { repository, useCase } = setup();
    repository.consent = consent({
      status: 'REVOKED',
      revokedAt: '2026-01-12T09:30:00.000Z',
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(consentGate(useCase, context, input)).resolves.toEqual({
      allowed: false,
      reason: 'REVOKED',
    });
  });

  it('discards an expired consent', async () => {
    const { repository, useCase } = setup();
    repository.consent = consent({
      status: 'EXPIRED',
      validUntil: '2026-01-12T09:59:59.000Z',
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(consentGate(useCase, context, input)).resolves.toEqual({
      allowed: false,
      reason: 'EXPIRED',
    });
  });

  it('discards a consent that is not valid yet', async () => {
    const { repository, useCase } = setup();
    repository.consent = consent({ validFrom: '2026-01-12T10:00:01.000Z' });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(consentGate(useCase, context, input)).resolves.toEqual({
      allowed: false,
      reason: 'NOT_YET_VALID',
    });
  });

  it('denies a different tenant without querying or leaking its institution', async () => {
    const { repository, useCase } = setup();
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const foreignInstitutionId = 'institution-foreign-fictional';

    await expect(
      consentGate(useCase, context, { ...input, institutionId: foreignInstitutionId }),
    ).resolves.toEqual({ allowed: false, reason: 'NO_CONSENT' });

    expect(repository.calls).toBe(0);
    const loggedEntry = String(log.mock.calls[0]?.[0]);
    expect(loggedEntry).toContain('"institutionId":"institution-fictional"');
    expect(loggedEntry).not.toContain(foreignInstitutionId);
  });
});
