import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@/web/auth/bearer-context', () => ({
  resolveContextFromBearerToken: vi.fn().mockResolvedValue({
    userId: 'user-1',
    institutionId: 'institution-1',
    role: 'ADMIN',
  }),
}));
vi.mock('@/infrastructure/aws/dynamodb/document-client', () => ({
  getDocumentClient: () => ({ send: mocks.send }),
}));
vi.mock('@/shared/config/env', () => ({
  getEnv: () => ({ DYNAMODB_TABLE_NAME: 'table' }),
}));

import { handleApiV1Request } from '@/web/http/handle-api-v1-request';

describe('/api/v1 response envelope contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the section 12 success envelope and correlation header', async () => {
    const response = await handleApiV1Request(
      new Request('https://example.test/api/v1/me', {
        headers: { 'x-correlation-id': 'ios-request-123' },
      }),
      async () => ({ id: 'user-1' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('ios-request-123');
    expect(await response.json()).toMatchObject({
      data: { id: 'user-1' },
      meta: { requestId: expect.any(String) },
    });
  });

  it('returns the section 12 stable error envelope and correct status', async () => {
    const response = await handleApiV1Request(
      new Request('https://example.test/api/v1/courses/course-1'),
      async () => {
        throw new ForbiddenError('Sem acesso.', 'ROLE_NOT_ALLOWED');
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'ROLE_NOT_ALLOWED',
        message: 'Sem acesso.',
        details: [],
        requestId: expect.any(String),
      },
    });
  });

  it('does not require or persist Idempotency-Key for join/token/ticket issuance', async () => {
    for (const suffix of ['join', 'token/refresh', 'realtime/ticket']) {
      const response = await handleApiV1Request(
        new Request(`https://example.test/api/v1/lives/live-1/${suffix}`, {
          method: 'POST',
        }),
        async () => ({ secret: 'fresh' }),
      );
      expect(response.status).toBe(200);
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key on accumulating mutations', async () => {
    const response = await handleApiV1Request(
      new Request('https://example.test/api/v1/courses', { method: 'POST' }),
      async () => ({ id: 'course-1' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
  });

  it('replays a completed mutation without executing it again', async () => {
    const operation = vi.fn().mockResolvedValue({ id: 'course-1' });
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: { state: 'COMPLETED', result: { id: 'course-1' } } });
    const request = () =>
      new Request('https://example.test/api/v1/courses', {
        method: 'POST',
        headers: { 'idempotency-key': 'create-course-1' },
      });

    const first = await handleApiV1Request(request(), operation);
    const replay = await handleApiV1Request(request(), operation);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ data: { id: 'course-1' } });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent mutation with the same key', async () => {
    mocks.send.mockResolvedValueOnce({ Item: { state: 'PENDING' } });

    const response = await handleApiV1Request(
      new Request('https://example.test/api/v1/courses', {
        method: 'POST',
        headers: { 'idempotency-key': 'still-running' },
      }),
      async () => ({ id: 'never-created' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_IN_PROGRESS' },
    });
  });
});
