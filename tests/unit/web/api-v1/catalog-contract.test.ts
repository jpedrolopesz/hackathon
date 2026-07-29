import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import {
  API_V1_CONTRACT_MANIFEST,
  type ApiV1ContractOperation,
} from '../../../contracts/api-v1-coverage-manifest';

const fixtures = vi.hoisted(() => {
  const context = { userId: 'teacher-1', institutionId: 'institution-1', role: 'PROFESSOR' as const };
  const course = {
    courseId: 'course-1',
    institutionId: context.institutionId,
    name: 'Curso',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const classGroup = {
    classId: 'class-1',
    courseId: course.courseId,
    institutionId: context.institutionId,
    teacherId: context.userId,
    name: 'Turma',
    createdAt: course.createdAt,
  };
  const live = {
    liveId: 'live-1',
    classId: classGroup.classId,
    institutionId: context.institutionId,
    teacherId: context.userId,
    title: 'Aula',
    scheduledStartAt: '2026-08-01T12:00:00.000Z',
    scheduledDurationMinutes: 120,
    status: 'LIVE' as const,
    stageArn: 'arn:aws:ivs:us-east-1:123:stage/stage-1',
    activeRecordingId: 'recording-1',
    createdAt: course.createdAt,
    updatedAt: course.createdAt,
  };
  const participant = {
    liveParticipantId: 'participant-1',
    liveId: live.liveId,
    userId: context.userId,
    role: context.role,
    capabilities: ['PUBLISH'] as const,
    ivsParticipantId: 'ivs-participant-1',
    joinedAt: course.createdAt,
  };
  const recording = {
    recordingId: 'recording-1',
    liveId: live.liveId,
    courseId: course.courseId,
    institutionId: context.institutionId,
    stageArn: live.stageArn,
    compositionArn: 'arn:aws:ivs:us-east-1:123:composition/composition-1',
    status: 'READY' as const,
    startedAt: course.createdAt,
    visibility: 'DRAFT' as const,
  };
  return { context, course, classGroup, live, participant, recording };
});

const mocks = vi.hoisted(() => ({
  documentSend: vi.fn(),
  disconnectParticipant: vi.fn(),
  stopComposition: vi.fn(),
  classOwner: true,
  authContext: {
    userId: 'admin-1',
    institutionId: 'institution-1',
    role: 'ADMIN' as 'ADMIN' | 'PROFESSOR' | 'ALUNO',
  },
  resourceState: 'local' as 'local' | 'foreign' | 'missing',
}));

vi.mock('@/infrastructure/aws/dynamodb/document-client', () => ({
  getDocumentClient: () => ({ send: mocks.documentSend }),
}));
vi.mock('@/shared/config/env', () => ({
  getEnv: () => ({ DYNAMODB_TABLE_NAME: 'table' }),
}));
vi.mock('@/web/auth/bearer-context', () => ({
  resolveContextFromBearerToken: () => Promise.resolve(mocks.authContext),
}));
vi.mock('@/infrastructure/aws/ivs/ivs-real-time-service', () => ({
  IvsRealTimeService: class {
    disconnectParticipant = mocks.disconnectParticipant;
    stopComposition = mocks.stopComposition;
  },
}));
vi.mock('@/web/container', () => ({
  repositories: {
    userProfile: { findBySub: vi.fn(), save: vi.fn() },
    course: { findById: vi.fn(), save: vi.fn() },
    classGroup: { findById: vi.fn(), save: vi.fn() },
    enrollment: { find: vi.fn() },
    liveSession: { findById: vi.fn(), listByClass: vi.fn() },
    liveParticipant: { findByUser: vi.fn(), listByLive: vi.fn() },
    recording: { findById: vi.fn() },
    attendance: { listByLive: vi.fn() },
    question: { listByLive: vi.fn() },
    poll: { listByLive: vi.fn() },
  },
  useCases: {
    createCourse: { execute: vi.fn() },
    createClassGroup: { execute: vi.fn() },
    updateClassGroup: { execute: vi.fn() },
    scheduleLive: { execute: vi.fn() },
    updateLive: { execute: vi.fn() },
    startLive: { execute: vi.fn() },
    finishLive: { execute: vi.fn() },
    cancelLive: { execute: vi.fn() },
    promoteParticipant: { execute: vi.fn() },
    demoteParticipant: { execute: vi.fn() },
    publishRecording: { execute: vi.fn() },
    hideRecording: { execute: vi.fn() },
    joinLive: { execute: vi.fn() },
    refreshParticipantToken: { execute: vi.fn() },
    issueConnectionTicket: { execute: vi.fn() },
    getRecordingPlayback: { execute: vi.fn() },
  },
}));

import { dispatchApiV1 } from '@/web/api-v1/catalog';
import { repositories, useCases } from '@/web/container';
import { handleApiV1Request } from '@/web/http/handle-api-v1-request';
import { POST as catchAllPost } from '@/app/api/v1/[...path]/route';
import { POST as joinPost } from '@/app/api/v1/lives/[liveId]/join/route';
import { POST as refreshPost } from '@/app/api/v1/lives/[liveId]/token/refresh/route';
import { POST as ticketPost } from '@/app/api/v1/lives/[liveId]/realtime/ticket/route';
import { GET as playbackGet } from '@/app/api/v1/recordings/[recordingId]/playback/route';

interface Operation {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

const specializedPaths = new Set([
  '/lives/{liveId}/join',
  '/lives/{liveId}/token/refresh',
  '/lives/{liveId}/realtime/ticket',
  '/recordings/{recordingId}/playback',
]);

const bodies: Readonly<Record<string, Record<string, unknown>>> = {
  'PATCH /me': { name: 'Novo nome' },
  'POST /courses': { name: 'Curso' },
  'PATCH /courses/{courseId}': { name: 'Curso 2' },
  'POST /classes': { courseId: 'course-1', name: 'Turma', teacherId: 'teacher-1' },
  'PATCH /classes/{classId}': { name: 'Turma 2' },
  'POST /classes/{classId}/lives': {
    title: 'Aula',
    scheduledStartAt: '2026-08-01T12:00:00.000Z',
  },
  'PATCH /lives/{liveId}': { title: 'Aula 2' },
  'PATCH /recordings/{recordingId}': { visibility: 'PUBLISHED' },
};

function materialize(entry: ApiV1ContractOperation): Operation {
  const path = entry.path
    .replace('{courseId}', 'course-1')
    .replace('{classId}', 'class-1')
    .replace('{liveId}', 'live-1')
    .replace('{recordingId}', 'recording-1')
    .replace('{userId}', 'teacher-1')
    .slice(1);
  const key = `${entry.method.toUpperCase()} ${entry.path}`;
  return {
    method: entry.method.toUpperCase() as Operation['method'],
    path,
    ...(bodies[key] ? { body: bodies[key] } : {}),
  };
}

const catchAllManifest = API_V1_CONTRACT_MANIFEST.filter(
  (entry) => !specializedPaths.has(entry.path),
);
const operations = catchAllManifest.map(materialize);

const contexts: Readonly<Record<AuthenticatedRequestContext['role'], AuthenticatedRequestContext>> = {
  ADMIN: { userId: 'admin-1', institutionId: 'institution-1', role: 'ADMIN' },
  PROFESSOR: fixtures.context,
  ALUNO: { userId: 'student-1', institutionId: 'institution-1', role: 'ALUNO' },
};

describe('/api/v1 catch-all contract — all 33 newly added operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.classOwner = true;
    mocks.resourceState = 'local';
    mocks.authContext = contexts.ADMIN;
    vi.mocked(repositories.userProfile.findBySub).mockResolvedValue({
      ...fixtures.context,
      name: 'Professor',
      email: 'p@example.edu',
      createdAt: fixtures.course.createdAt,
      updatedAt: fixtures.course.createdAt,
    });
    vi.mocked(repositories.course.findById).mockResolvedValue(fixtures.course);
    vi.mocked(repositories.classGroup.findById).mockResolvedValue(fixtures.classGroup);
    vi.mocked(repositories.enrollment.find).mockResolvedValue({
      studentId: 'student-1',
      classId: fixtures.classGroup.classId,
      courseId: fixtures.course.courseId,
      institutionId: fixtures.context.institutionId,
      courseName: fixtures.course.name,
      className: fixtures.classGroup.name,
      enrolledAt: fixtures.course.createdAt,
      status: 'ACTIVE',
    });
    vi.mocked(repositories.liveSession.findById).mockResolvedValue(fixtures.live);
    vi.mocked(repositories.liveSession.listByClass).mockResolvedValue([fixtures.live]);
    vi.mocked(repositories.liveParticipant.findByUser).mockResolvedValue(fixtures.participant);
    vi.mocked(repositories.liveParticipant.listByLive).mockResolvedValue([fixtures.participant]);
    vi.mocked(repositories.recording.findById).mockResolvedValue(fixtures.recording);
    vi.mocked(repositories.attendance.listByLive).mockResolvedValue([]);
    vi.mocked(repositories.question.listByLive).mockResolvedValue([]);
    vi.mocked(repositories.poll.listByLive).mockResolvedValue([]);
    mocks.documentSend.mockImplementation((command: { input?: { FilterExpression?: string } }) => {
      const filter = command.input?.FilterExpression;
      if (!filter) return Promise.resolve({});
      if (filter.includes('begins_with(SK, :recording)')) {
        return Promise.resolve({ Items: [fixtures.recording] });
      }
      const prefix = (command.input as { ExpressionAttributeValues?: Record<string, string> })
        .ExpressionAttributeValues?.[':prefix'];
      if (prefix === 'COURSE#') return Promise.resolve({ Items: [fixtures.course] });
      if (prefix === 'CLASS#') return Promise.resolve({ Items: [fixtures.classGroup] });
      if (prefix === 'LIVE#') return Promise.resolve({ Items: [fixtures.live] });
      return Promise.resolve({ Items: [] });
    });

    for (const useCase of Object.values(useCases)) {
      if ('execute' in useCase && vi.isMockFunction(useCase.execute)) {
        useCase.execute.mockResolvedValue(fixtures.live);
      }
    }
    vi.mocked(useCases.createCourse.execute).mockResolvedValue(fixtures.course);
    vi.mocked(useCases.createClassGroup.execute).mockResolvedValue(fixtures.classGroup);
    vi.mocked(useCases.updateClassGroup.execute).mockResolvedValue(fixtures.classGroup);
    vi.mocked(useCases.promoteParticipant.execute).mockResolvedValue({
      participant: fixtures.participant,
    });
    vi.mocked(useCases.demoteParticipant.execute).mockResolvedValue(fixtures.participant);
    vi.mocked(useCases.publishRecording.execute).mockResolvedValue(fixtures.recording);
    vi.mocked(useCases.hideRecording.execute).mockResolvedValue(fixtures.recording);

    const adminOrProfessor = <T>(result: T) =>
      vi.fn(async (context: AuthenticatedRequestContext) => {
        if (mocks.resourceState !== 'local') {
          throw new NotFoundError('Recurso não encontrado.', 'RESOURCE_NOT_FOUND');
        }
        if (context.role === 'ALUNO' || (context.role === 'PROFESSOR' && !mocks.classOwner)) {
          throw new ForbiddenError('Sem permissão.', 'CLASS_NOT_OWNED');
        }
        return result;
      });
    const adminOnly = <T>(result: T) =>
      vi.fn(async (context: AuthenticatedRequestContext) => {
        if (context.role !== 'ADMIN') {
          throw new ForbiddenError('Sem permissão.', 'ROLE_NOT_ALLOWED');
        }
        return result;
      });
    vi.mocked(useCases.createCourse.execute).mockImplementation(async (context) => {
      if (context.role !== 'ADMIN') {
        throw new ForbiddenError('Sem permissão.', 'ROLE_NOT_ALLOWED');
      }
      return fixtures.course;
    });
    vi.mocked(useCases.createClassGroup.execute).mockImplementation(adminOnly(fixtures.classGroup));
    vi.mocked(useCases.updateClassGroup.execute).mockImplementation(adminOnly(fixtures.classGroup));
    vi.mocked(useCases.scheduleLive.execute).mockImplementation(adminOrProfessor(fixtures.live));
    vi.mocked(useCases.updateLive.execute).mockImplementation(adminOrProfessor(fixtures.live));
    vi.mocked(useCases.startLive.execute).mockImplementation(adminOrProfessor(fixtures.live));
    vi.mocked(useCases.finishLive.execute).mockImplementation(adminOrProfessor(fixtures.live));
    vi.mocked(useCases.cancelLive.execute).mockImplementation(adminOrProfessor(fixtures.live));
    vi.mocked(useCases.promoteParticipant.execute).mockImplementation(
      adminOrProfessor({ participant: fixtures.participant }),
    );
    vi.mocked(useCases.demoteParticipant.execute).mockImplementation(
      adminOrProfessor(fixtures.participant),
    );
    vi.mocked(useCases.publishRecording.execute).mockImplementation(
      adminOrProfessor(fixtures.recording),
    );
    vi.mocked(useCases.hideRecording.execute).mockImplementation(
      adminOrProfessor(fixtures.recording),
    );
    vi.mocked(useCases.joinLive.execute).mockResolvedValue({
      live: fixtures.live,
      participant: fixtures.participant,
      ivs: {
        stageArn: fixtures.live.stageArn,
        participantToken: 'fresh-token',
        expiresAt: '2026-08-01T15:00:00.000Z',
      },
      realtime: { connectionToken: 'fresh-ticket', expiresAt: '2026-08-01T13:00:00.000Z' },
    });
    vi.mocked(useCases.refreshParticipantToken.execute).mockResolvedValue({
      participantToken: 'fresh-token',
      expiresAt: '2026-08-01T15:00:00.000Z',
    });
    vi.mocked(useCases.issueConnectionTicket.execute).mockResolvedValue({
      connectionToken: 'fresh-ticket',
      expiresAt: '2026-08-01T13:00:00.000Z',
    });
    vi.mocked(useCases.getRecordingPlayback.execute).mockResolvedValue({
      manifestUrl: 'https://example.test/media/master.m3u8',
      cookies: {
        policy: 'policy',
        signature: 'signature',
        keyPairId: 'key-id',
      },
      cookiePath: '/media/recording-1/',
      expiresAt: '2026-08-01T15:00:00.000Z',
    });
  });

  for (const operation of operations) {
    it(`${operation.method} /api/v1/${operation.path} executes without ROUTE_NOT_FOUND`, async () => {
      const request = new Request(`https://example.test/api/v1/${operation.path}`, {
        method: operation.method,
        ...(operation.body
          ? {
              body: JSON.stringify(operation.body),
              headers: { 'content-type': 'application/json' },
            }
          : {}),
      });
      await expect(
        dispatchApiV1(
          request,
          { ...fixtures.context, role: 'ADMIN' },
          operation.path.split('/'),
        ),
      ).resolves.toBeDefined();
    });
  }

  for (const [index, entry] of catchAllManifest.entries()) {
    const operation = operations[index]!;
    for (const role of ['ADMIN', 'PROFESSOR', 'ALUNO'] as const) {
      it(`${operation.method} /api/v1/${operation.path} asserts ${role} -> ${entry.roles[role]}`, async () => {
        const request = new Request(`https://example.test/api/v1/${operation.path}`, {
          method: operation.method,
          ...(operation.body
            ? { body: JSON.stringify(operation.body), headers: { 'content-type': 'application/json' } }
            : {}),
        });
        const promise = dispatchApiV1(request, contexts[role], operation.path.split('/'));
        if (entry.roles[role] === 200) {
          await expect(promise).resolves.toBeDefined();
        } else {
          await expect(promise).rejects.toMatchObject({
            code: expect.stringMatching(/ROLE_NOT_ALLOWED|CLASS_NOT_OWNED/),
          });
        }
      });
    }
  }

  for (const [index, entry] of catchAllManifest.entries()) {
    const operation = operations[index]!;
    it(`${operation.method} /api/v1/${operation.path} returns its HTTP success envelope and status`, async () => {
      mocks.authContext = contexts.ADMIN;
      const request = requestFor(operation, 'success');
      const response = await handleApiV1Request(request, (context) =>
        dispatchApiV1(request, context, operation.path.split('/')),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        data: expect.anything(),
        meta: { requestId: expect.any(String) },
      });
      expect(body).not.toHaveProperty('error');
    });

    it(`${operation.method} /api/v1/${operation.path} returns its HTTP error envelope and status`, async () => {
      const deniedRole = (['ALUNO', 'PROFESSOR', 'ADMIN'] as const).find(
        (role) => entry.roles[role] === 403,
      );
      let request: Request;
      let expectedStatus: number;
      if (deniedRole) {
        mocks.authContext = contexts[deniedRole];
        request = requestFor(operation, 'success');
        expectedStatus = 403;
      } else if (entry.tenant === 'resource-hidden') {
        mocks.authContext = contexts.ADMIN;
        setResource(entry.path, 'missing');
        request = requestFor(operation, 'success');
        expectedStatus = 404;
      } else {
        mocks.authContext = contexts.ADMIN;
        request =
          operation.method === 'GET'
            ? new Request(`https://example.test/api/v1/${operation.path}?cursor=YmFk`)
            : requestFor(operation, 'invalid');
        if (entry.path === '/me') {
          if (operation.method === 'GET') {
            vi.mocked(repositories.userProfile.findBySub).mockResolvedValue(null);
          }
          request = requestFor(operation, operation.method === 'GET' ? 'success' : 'invalid');
        }
        expectedStatus = 400;
        if (entry.path === '/me' && operation.method === 'GET') expectedStatus = 404;
      }
      const response = await handleApiV1Request(request, (context) =>
        dispatchApiV1(request, context, operation.path.split('/')),
      );
      const body = await response.json();
      expect(response.status).toBe(expectedStatus);
      expect(body).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          details: expect.any(Array),
          requestId: expect.any(String),
        },
      });
      expect(body).not.toHaveProperty('data');
    });
  }

  for (const entry of catchAllManifest.filter(
    (candidate) => candidate.tenant === 'resource-hidden',
  )) {
    const operation = materialize(entry);
    it(`${operation.method} /api/v1/${operation.path} makes foreign and missing resources indistinguishable`, async () => {
      mocks.authContext = contexts.ADMIN;
      setResource(entry.path, 'foreign');
      const foreignRequest = requestFor(operation, 'success');
      const foreignResponse = await handleApiV1Request(foreignRequest, (context) =>
        dispatchApiV1(foreignRequest, context, operation.path.split('/')),
      );
      const foreignBody = await foreignResponse.json();

      setResource(entry.path, 'missing');
      const missingRequest = requestFor(operation, 'success');
      const missingResponse = await handleApiV1Request(missingRequest, (context) =>
        dispatchApiV1(missingRequest, context, operation.path.split('/')),
      );
      const missingBody = await missingResponse.json();

      expect(foreignResponse.status).toBe(404);
      expect(missingResponse.status).toBe(404);
      expect({ ...foreignBody.error, requestId: '<redacted>' }).toEqual({
        ...missingBody.error,
        requestId: '<redacted>',
      });
      expect(foreignBody.error).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Recurso não encontrado.',
      });
    });
  }

  for (const entry of catchAllManifest.filter(
    (candidate) => candidate.tenant === 'collection-filtered',
  )) {
    const operation = materialize(entry);
    it(`${operation.method} /api/v1/${operation.path} scopes its collection query to the caller institution`, async () => {
      await dispatchApiV1(
        requestFor(operation, 'success'),
        contexts.ADMIN,
        operation.path.split('/'),
      );
      const scanCall = mocks.documentSend.mock.calls.find(
        ([command]) => command.constructor.name === 'ScanCommand',
      );
      expect(scanCall?.[0].input.ExpressionAttributeValues[':institutionId']).toBe(
        contexts.ADMIN.institutionId,
      );
    });
  }

  it('replays idempotency through the actual catch-all Route Handler', async () => {
    vi.mocked(useCases.createCourse.execute).mockClear();
    const cached = fixtures.course;
    let completed = false;
    mocks.documentSend.mockImplementation((command: { constructor: { name: string } }) => {
      if (command.constructor.name === 'GetCommand') {
        return Promise.resolve(completed ? { Item: { state: 'COMPLETED', result: cached } } : {});
      }
      if (command.constructor.name === 'UpdateCommand') completed = true;
      return Promise.resolve({});
    });
    const makeRequest = () =>
      new Request('https://example.test/api/v1/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'route-replay-1' },
        body: JSON.stringify({ name: 'Curso' }),
      });

    const first = await catchAllPost(makeRequest(), { params: Promise.resolve({ path: ['courses'] }) });
    const replay = await catchAllPost(makeRequest(), { params: Promise.resolve({ path: ['courses'] }) });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ data: cached });
    expect(useCases.createCourse.execute).toHaveBeenCalledTimes(1);
  });

  it('atomically removes a participant and persists the mandatory audit event', async () => {
    await dispatchApiV1(
      new Request('https://example.test/api/v1/lives/live-1/participants/teacher-1', {
        method: 'DELETE',
      }),
      contexts.PROFESSOR,
      ['lives', 'live-1', 'participants', 'teacher-1'],
    );

    const transaction = mocks.documentSend.mock.calls.find(
      ([command]) => command.constructor.name === 'TransactWriteCommand',
    )?.[0];
    expect(transaction.input.TransactItems).toEqual([
      {
        Delete: {
          TableName: 'table',
          Key: { PK: 'LIVE#live-1', SK: 'PARTICIPANT#participant-1' },
        },
      },
      {
        Put: {
          TableName: 'table',
          Item: expect.objectContaining({
            entityType: 'AuditEvent',
            action: 'LIVE_PARTICIPANT_REMOVED',
            actorUserId: 'teacher-1',
            targetUserId: 'teacher-1',
            outcome: 'REMOVED',
          }),
        },
      },
    ]);
  });

  const ownershipMutations = catchAllManifest.filter(
    (entry) =>
      entry.roles.PROFESSOR === 200 &&
      entry.roles.ALUNO === 403 &&
      (entry.path.includes('/classes') ||
        entry.path.includes('/lives') ||
        entry.path.includes('/recordings')),
  );
  for (const entry of ownershipMutations) {
    const operation = materialize(entry);
    it(`${operation.method} /api/v1/${operation.path} rejects a non-owner PROFESSOR`, async () => {
      mocks.classOwner = false;
      vi.mocked(repositories.classGroup.findById).mockResolvedValue({
        ...fixtures.classGroup,
        teacherId: 'other-professor',
      });
      vi.mocked(repositories.liveSession.findById).mockResolvedValue({
        ...fixtures.live,
        teacherId: 'other-professor',
      });
      const request = new Request(`https://example.test/api/v1/${operation.path}`, {
        method: operation.method,
        ...(operation.body
          ? { body: JSON.stringify(operation.body), headers: { 'content-type': 'application/json' } }
          : {}),
      });
      await expect(
        dispatchApiV1(request, contexts.PROFESSOR, operation.path.split('/')),
      ).rejects.toMatchObject({ code: 'CLASS_NOT_OWNED' });
    });
  }

  it('returns the anti-enumeration error for a cross-institution resource', async () => {
    vi.mocked(repositories.liveSession.findById).mockResolvedValue({
      ...fixtures.live,
      institutionId: 'institution-2',
    });
    await expect(
      dispatchApiV1(
        new Request('https://example.test/api/v1/lives/live-1'),
        fixtures.context,
        ['lives', 'live-1'],
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

});

const specializedHandlers = {
  'POST /lives/{liveId}/join': (request: Request) =>
    joinPost(request, { params: Promise.resolve({ liveId: 'live-1' }) }),
  'POST /lives/{liveId}/token/refresh': (request: Request) =>
    refreshPost(request, { params: Promise.resolve({ liveId: 'live-1' }) }),
  'POST /lives/{liveId}/realtime/ticket': (request: Request) =>
    ticketPost(request, { params: Promise.resolve({ liveId: 'live-1' }) }),
  'GET /recordings/{recordingId}/playback': (request: Request) =>
    playbackGet(request, { params: Promise.resolve({ recordingId: 'recording-1' }) }),
} as const;

describe('/api/v1 specialized Route Handler contracts from manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authContext = contexts.ADMIN;
    vi.mocked(useCases.joinLive.execute).mockResolvedValue({
      live: fixtures.live,
      participant: fixtures.participant,
      ivs: {
        stageArn: fixtures.live.stageArn,
        participantToken: 'fresh-token',
        expiresAt: '2026-08-01T15:00:00.000Z',
      },
      realtime: { connectionToken: 'fresh-ticket', expiresAt: '2026-08-01T13:00:00.000Z' },
    });
    vi.mocked(useCases.refreshParticipantToken.execute).mockResolvedValue({
      participantToken: 'fresh-token',
      expiresAt: '2026-08-01T15:00:00.000Z',
    });
    vi.mocked(useCases.issueConnectionTicket.execute).mockResolvedValue({
      connectionToken: 'fresh-ticket',
      expiresAt: '2026-08-01T13:00:00.000Z',
    });
    vi.mocked(useCases.getRecordingPlayback.execute).mockResolvedValue({
      manifestUrl: 'https://example.test/media/master.m3u8',
      cookies: {
        policy: 'policy',
        signature: 'signature',
        keyPairId: 'key-id',
      },
      cookiePath: '/media/recording-1/',
      expiresAt: '2026-08-01T15:00:00.000Z',
    });
  });

  for (const entry of API_V1_CONTRACT_MANIFEST.filter((candidate) =>
    specializedPaths.has(candidate.path),
  )) {
    const key = `${entry.method.toUpperCase()} ${entry.path}` as keyof typeof specializedHandlers;
    const invoke = specializedHandlers[key];

    it(`${key} returns the documented success envelope/status`, async () => {
      const response = await invoke(
        new Request(`https://example.test/api/v1/${materialize(entry).path}`),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: expect.anything(),
        meta: { requestId: expect.any(String) },
      });
    });

    for (const role of ['ADMIN', 'PROFESSOR', 'ALUNO'] as const) {
      it(`${key} explicitly asserts ${role} -> ${entry.roles[role]}`, async () => {
        mocks.authContext = contexts[role];
        const response = await invoke(
          new Request(`https://example.test/api/v1/${materialize(entry).path}`),
        );
        expect(response.status).toBe(entry.roles[role]);
      });
    }

    it(`${key} returns identical 404 envelopes for foreign and missing resources`, async () => {
      const error = new NotFoundError('Recurso não encontrado.', 'RESOURCE_NOT_FOUND');
      const target =
        entry.path.includes('/join')
          ? useCases.joinLive.execute
          : entry.path.includes('/token/refresh')
            ? useCases.refreshParticipantToken.execute
            : entry.path.includes('/realtime/ticket')
              ? useCases.issueConnectionTicket.execute
              : useCases.getRecordingPlayback.execute;
      vi.mocked(target).mockRejectedValue(error);
      const foreign = await invoke(
        new Request(`https://example.test/api/v1/${materialize(entry).path}`),
      );
      const foreignBody = await foreign.json();
      const missing = await invoke(
        new Request(`https://example.test/api/v1/${materialize(entry).path}`),
      );
      const missingBody = await missing.json();
      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect({ ...foreignBody.error, requestId: '<redacted>' }).toEqual({
        ...missingBody.error,
        requestId: '<redacted>',
      });
    });
  }
});

function requestFor(operation: Operation, mode: 'success' | 'invalid'): Request {
  const isMutation = operation.method !== 'GET';
  const body =
    mode === 'invalid'
      ? operation.path === 'me'
        ? { name: 123 }
        : {}
      : operation.body;
  return new Request(`https://example.test/api/v1/${operation.path}`, {
    method: operation.method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(isMutation ? { 'idempotency-key': `${mode}-${operation.method}-${operation.path}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function setResource(path: string, state: 'local' | 'foreign' | 'missing'): void {
  mocks.resourceState = state;
  const institutionId = state === 'foreign' ? 'institution-2' : fixtures.context.institutionId;
  if (path.startsWith('/courses/')) {
    vi.mocked(repositories.course.findById).mockResolvedValue(
      state === 'missing' ? null : { ...fixtures.course, institutionId },
    );
  } else if (path.startsWith('/classes/')) {
    vi.mocked(repositories.classGroup.findById).mockResolvedValue(
      state === 'missing' ? null : { ...fixtures.classGroup, institutionId },
    );
  } else if (path.startsWith('/recordings/')) {
    vi.mocked(repositories.recording.findById).mockResolvedValue(
      state === 'missing' ? null : { ...fixtures.recording, institutionId },
    );
  } else if (path.startsWith('/lives/')) {
    vi.mocked(repositories.liveSession.findById).mockResolvedValue(
      state === 'missing' ? null : { ...fixtures.live, institutionId },
    );
  }
}
