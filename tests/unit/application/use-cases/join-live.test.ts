import { describe, expect, it } from 'vitest';
import { JoinLiveUseCase } from '@/application/use-cases/join-live';
import type { Enrollment } from '@/domain/entities/Enrollment';
import type { LiveSession } from '@/domain/entities/LiveSession';
import { buildContext, FakeEnrollmentRepository } from './fixtures';
import {
  FakeConnectionTicketRepository,
  FakeIvsRealTimeService,
  FakeLiveParticipantRepository,
  FakeLiveSessionRepository,
} from './live-fixtures';

function seedLive(
  repo: FakeLiveSessionRepository,
  overrides: Partial<LiveSession> = {},
): LiveSession {
  const live: LiveSession = {
    liveId: 'live-1',
    classId: 'class-1',
    institutionId: 'institution-1',
    teacherId: 'teacher-1',
    title: 'Aula 1',
    scheduledStartAt: '2026-01-01T14:00:00.000Z',
    status: 'LIVE',
    stageArn: 'arn:aws:ivs:us-east-1:123456789012:stage/fake-stage',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
  repo.seed(live);
  return live;
}

function seedActiveEnrollment(repo: FakeEnrollmentRepository): Enrollment {
  const enrollment: Enrollment = {
    studentId: 'student-1',
    classId: 'class-1',
    courseId: 'course-1',
    institutionId: 'institution-1',
    courseName: 'Ciência da Computação',
    className: 'Aula 1',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
  };
  repo.seed(enrollment);
  return enrollment;
}

function makeUseCase() {
  const liveSessionRepository = new FakeLiveSessionRepository();
  const enrollmentRepository = new FakeEnrollmentRepository();
  const liveParticipantRepository = new FakeLiveParticipantRepository();
  const ivs = new FakeIvsRealTimeService();
  const connectionTicketRepository = new FakeConnectionTicketRepository();
  const useCase = new JoinLiveUseCase(
    liveSessionRepository,
    enrollmentRepository,
    liveParticipantRepository,
    ivs,
    connectionTicketRepository,
  );
  return {
    useCase,
    liveSessionRepository,
    enrollmentRepository,
    liveParticipantRepository,
    ivs,
    connectionTicketRepository,
  };
}

describe('JoinLiveUseCase — as seis verificações da seção 6', () => {
  it('4. rejects joining a live that has not started its waiting room yet', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository, { status: 'SCHEDULED' });

    const context = buildContext({ role: 'ADMIN' });
    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'LIVE_NOT_AVAILABLE',
    });
  });

  it('3. rejects a student who is not enrolled in the class', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('3. rejects a professor who does not own the class', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-2',
      institutionId: 'institution-1',
    });
    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'CLASS_NOT_OWNED',
    });
  });

  it('2. rejects a user from another institution', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    const context = buildContext({ role: 'ADMIN', institutionId: 'institution-2' });
    await expect(useCase.execute(context, { liveId: 'live-1' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('5/6. an enrolled student gets PUBLISH+SUBSCRIBE for the interactive classroom', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository, ivs } = makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    const result = await useCase.execute(context, { liveId: 'live-1' });

    expect(result.participant.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
    expect(ivs.createParticipantTokenCalls[0]?.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
  });

  it('5/6. the owning professor gets PUBLISH+SUBSCRIBE capabilities', async () => {
    const { useCase, liveSessionRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    const context = buildContext({
      role: 'PROFESSOR',
      userId: 'teacher-1',
      institutionId: 'institution-1',
    });
    const result = await useCase.execute(context, { liveId: 'live-1' });

    expect(result.participant.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
  });

  it('never sends the Cognito sub, institutionId or role-holder identity to IVS — only the opaque liveParticipantId', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository, ivs } = makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    const result = await useCase.execute(context, { liveId: 'live-1' });

    const call = ivs.createParticipantTokenCalls[0];
    expect(call?.userId).toBe(result.participant.liveParticipantId);
    expect(call?.userId).not.toBe('student-1');
    expect(JSON.stringify(call?.attributes)).not.toContain('institution-1');
    expect(JSON.stringify(call?.attributes)).not.toContain('student-1');
  });

  it('capabilities are always passed explicitly to CreateParticipantToken, never omitted', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository, ivs } = makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    await useCase.execute(context, { liveId: 'live-1' });

    expect(ivs.createParticipantTokenCalls[0]?.capabilities).toBeDefined();
    expect(ivs.createParticipantTokenCalls[0]?.capabilities.length).toBeGreaterThan(0);
  });

  it('rejoining reuses the same liveParticipantId (idempotent identity across reconnects)', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    const first = await useCase.execute(context, { liveId: 'live-1' });
    const second = await useCase.execute(context, { liveId: 'live-1' });

    expect(second.participant.liveParticipantId).toBe(first.participant.liveParticipantId);
    expect(second.participant.joinedAt).toBe(first.participant.joinedAt);
    expect(second.participant.ivsParticipantId).not.toBe(first.participant.ivsParticipantId);
    expect(second.ivs.participantToken).not.toBe(first.ivs.participantToken);
  });

  it('rejoining never creates a second LiveParticipant record (no duplicate, no double attendance count)', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository, liveParticipantRepository } =
      makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    await useCase.execute(context, { liveId: 'live-1' });
    await useCase.execute(context, { liveId: 'live-1' });
    await useCase.execute(context, { liveId: 'live-1' });

    expect(liveParticipantRepository.size).toBe(1);
  });

  it('a previously promoted student keeps PUBLISH capability on rejoin', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository, liveParticipantRepository } =
      makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);
    liveParticipantRepository.seed({
      liveParticipantId: 'existing-uuid',
      liveId: 'live-1',
      userId: 'student-1',
      role: 'ALUNO',
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      joinedAt: '2026-01-01T00:00:00.000Z',
      promotedAt: '2026-01-01T00:05:00.000Z',
    });

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    const result = await useCase.execute(context, { liveId: 'live-1' });

    expect(result.participant.capabilities).toEqual(['PUBLISH', 'SUBSCRIBE']);
    expect(result.participant.liveParticipantId).toBe('existing-uuid');
  });

  it('never puts the Cognito access token on the connectionToken — only an opaque one-time ticket', async () => {
    const { useCase, liveSessionRepository, connectionTicketRepository } = makeUseCase();
    seedLive(liveSessionRepository);

    const context = buildContext({ role: 'ADMIN' });
    const result = await useCase.execute(context, { liveId: 'live-1' });

    expect(result.realtime.connectionToken).toBeDefined();
    expect(connectionTicketRepository.created).toHaveLength(1);
    expect(connectionTicketRepository.created[0]).toMatchObject({
      ticket: result.realtime.connectionToken,
      liveId: 'live-1',
      userId: context.userId,
    });
  });

  it('issues a brand-new connectionToken on every join, even for the same reused liveParticipantId', async () => {
    const { useCase, liveSessionRepository, enrollmentRepository } = makeUseCase();
    seedLive(liveSessionRepository);
    seedActiveEnrollment(enrollmentRepository);

    const context = buildContext({
      role: 'ALUNO',
      userId: 'student-1',
      institutionId: 'institution-1',
    });
    const first = await useCase.execute(context, { liveId: 'live-1' });
    const second = await useCase.execute(context, { liveId: 'live-1' });

    expect(second.participant.liveParticipantId).toBe(first.participant.liveParticipantId);
    expect(second.realtime.connectionToken).not.toBe(first.realtime.connectionToken);
  });
});
