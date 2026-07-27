import { describe, expect, it } from 'vitest';
import {
  IVS_TOKEN_CAPABILITIES_BY_ROLE,
  IVS_TOKEN_DURATION_MINUTES,
  assertNoSensitiveTokenFields,
  assertValidCapabilities,
  assertValidDurationMinutes,
  buildParticipantTokenAttributes,
  buildParticipantTokenUserId,
} from '@/infrastructure/aws/ivs/participant-token-attributes';

const identity = {
  liveParticipantId: '3f9a21d4-6c1b-4e2a-9c3e-2a6f9b1d7e55',
  role: 'ALUNO' as const,
};

describe('buildParticipantTokenAttributes / buildParticipantTokenUserId', () => {
  it('only includes the opaque id and the role', () => {
    const attributes = buildParticipantTokenAttributes(identity);
    expect(attributes).toEqual({ liveParticipantId: identity.liveParticipantId, role: 'ALUNO' });
    expect(buildParticipantTokenUserId(identity)).toBe(identity.liveParticipantId);
  });

  it('never leaks real identifiers, even if someone tries to smuggle them in', () => {
    const attributes = buildParticipantTokenAttributes(identity);
    expect(() =>
      assertNoSensitiveTokenFields({ userId: buildParticipantTokenUserId(identity), attributes }),
    ).not.toThrow();
  });
});

describe('assertNoSensitiveTokenFields', () => {
  it('rejects known sensitive keys regardless of case', () => {
    expect(() => assertNoSensitiveTokenFields({ attributes: { institutionId: 'inst-1' } })).toThrow(
      /sensível/,
    );
    expect(() => assertNoSensitiveTokenFields({ attributes: { SUB: 'abc' } })).toThrow(/sensível/);
    expect(() => assertNoSensitiveTokenFields({ attributes: { email: 'a@b.com' } })).toThrow(
      /sensível/,
    );
  });

  it('rejects values that look like an email even under a safe key name', () => {
    expect(() =>
      assertNoSensitiveTokenFields({ attributes: { contact: 'joao@example.com' } }),
    ).toThrow(/e-mail/);
  });

  it('rejects values that look like a JWT', () => {
    expect(() =>
      assertNoSensitiveTokenFields({
        attributes: {
          note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYbwcKYU8OI',
        },
      }),
    ).toThrow(/JWT/);
  });

  it('rejects attributes over the 1KB CreateParticipantToken limit', () => {
    expect(() => assertNoSensitiveTokenFields({ attributes: { blob: 'x'.repeat(2000) } })).toThrow(
      /1024 bytes/,
    );
  });

  it('accepts a safe, minimal payload', () => {
    expect(() =>
      assertNoSensitiveTokenFields({
        userId: identity.liveParticipantId,
        attributes: { role: 'ALUNO' },
      }),
    ).not.toThrow();
  });
});

describe('assertValidCapabilities', () => {
  it('accepts the two role presets', () => {
    expect(() =>
      assertValidCapabilities(IVS_TOKEN_CAPABILITIES_BY_ROLE.SUBSCRIBER_ONLY),
    ).not.toThrow();
    expect(() => assertValidCapabilities(IVS_TOKEN_CAPABILITIES_BY_ROLE.PRESENTER)).not.toThrow();
  });

  it('rejects an empty list even though the raw API would allow it', () => {
    expect(() => assertValidCapabilities([])).toThrow(/1 ou 2/);
  });

  it('rejects duplicates', () => {
    expect(() => assertValidCapabilities(['SUBSCRIBE', 'SUBSCRIBE'])).toThrow(/duplicatas/);
  });

  it('rejects publish-only, since every participant must at least subscribe', () => {
    expect(() => assertValidCapabilities(['PUBLISH'])).toThrow(/SUBSCRIBE/);
  });
});

describe('assertValidDurationMinutes', () => {
  it('accepts the documented default', () => {
    expect(() => assertValidDurationMinutes(IVS_TOKEN_DURATION_MINUTES.DEFAULT)).not.toThrow();
  });

  it('accepts the documented boundaries', () => {
    expect(() => assertValidDurationMinutes(IVS_TOKEN_DURATION_MINUTES.MIN)).not.toThrow();
    expect(() => assertValidDurationMinutes(IVS_TOKEN_DURATION_MINUTES.MAX)).not.toThrow();
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => assertValidDurationMinutes(0)).toThrow();
    expect(() => assertValidDurationMinutes(20161)).toThrow();
    expect(() => assertValidDurationMinutes(12.5)).toThrow();
  });
});
