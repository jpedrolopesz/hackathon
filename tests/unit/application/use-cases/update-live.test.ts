import { describe, expect, it } from 'vitest';
import { UpdateLiveUseCase } from '@/application/use-cases/update-live';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext } from './fixtures';
import { FakeLiveSessionRepository } from './live-fixtures';

function seedLive(repo: FakeLiveSessionRepository, overrides: Partial<LiveSession> = {}): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'SCHEDULED',
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

describe('UpdateLiveUseCase', () => {
  it('updates title, description and scheduledStartAt when the live is SCHEDULED', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo);
    const useCase = new UpdateLiveUseCase(repo);
    const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-1' });

    const updated = await useCase.execute(context, {
      liveId: 'live-1',
      title: 'Novo título',
      description: 'Nova descrição',
      scheduledStartAt: '2026-01-02T14:00:00.000Z',
    });

    expect(updated.title).toBe('Novo título');
    expect(updated.description).toBe('Nova descrição');
    expect(updated.scheduledStartAt).toBe('2026-01-02T14:00:00.000Z');
  });

  it('allows editing a DRAFT live', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo, { status: 'DRAFT' });
    const useCase = new UpdateLiveUseCase(repo);
    const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-1' });

    const updated = await useCase.execute(context, {
      liveId: 'live-1',
      title: 'Título',
      scheduledStartAt: '2026-01-02T14:00:00.000Z',
    });
    expect(updated.title).toBe('Título');
  });

  it.each(['WAITING', 'LIVE', 'ENDING', 'ENDED', 'CANCELED', 'FAILED'] as const)(
    'rejects editing once the live has moved past SCHEDULED (status=%s)',
    async (status) => {
      const repo = new FakeLiveSessionRepository();
      seedLive(repo, { status });
      const useCase = new UpdateLiveUseCase(repo);
      const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-1' });

      await expect(
        useCase.execute(context, {
          liveId: 'live-1',
          title: 'Título',
          scheduledStartAt: '2026-01-02T14:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    },
  );

  it('rejects a professor who does not own the class', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo);
    const useCase = new UpdateLiveUseCase(repo);
    const context = buildContext({ role: 'PROFESSOR', userId: 'teacher-2' });

    await expect(
      useCase.execute(context, {
        liveId: 'live-1',
        title: 'Título',
        scheduledStartAt: '2026-01-02T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
  });

  it('rejects a user from another institution with the anti-enumeration code', async () => {
    const repo = new FakeLiveSessionRepository();
    seedLive(repo);
    const useCase = new UpdateLiveUseCase(repo);
    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-2',
    });

    await expect(
      useCase.execute(context, {
        liveId: 'live-1',
        title: 'Título',
        scheduledStartAt: '2026-01-02T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('raises NotFoundError for a live that does not exist', async () => {
    const repo = new FakeLiveSessionRepository();
    const useCase = new UpdateLiveUseCase(repo);
    const context = buildContext({ role: 'ADMIN' });

    await expect(
      useCase.execute(context, {
        liveId: 'missing-live',
        title: 'Título',
        scheduledStartAt: '2026-01-02T14:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
