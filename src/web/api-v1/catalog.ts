import 'server-only';
import { randomUUID } from 'node:crypto';
import { DeleteCommand, PutCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  assertClassOwner,
  assertRole,
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { IvsRealTimeService } from '@/infrastructure/aws/ivs/ivs-real-time-service';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '@/domain/errors';
import type { ClassGroup } from '@/domain/entities/ClassGroup';
import type { Course } from '@/domain/entities/Course';
import type { LiveSession } from '@/domain/entities/LiveSession';
import type { Recording } from '@/domain/entities/Recording';
import { getEnv } from '@/shared/config/env';
import { structuredLog } from '@/shared/observability/structured-log';
import { repositories, useCases } from '@/web/container';

type JsonRecord = Record<string, unknown>;

function requiredString(body: JsonRecord, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Campo "${field}" é obrigatório.`, 'VALIDATION_ERROR', [
      { path: field, message: 'obrigatório' },
    ]);
  }
  return value.trim();
}

function optionalString(body: JsonRecord, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`Campo "${field}" deve ser texto.`, 'VALIDATION_ERROR');
  }
  return value.trim();
}

async function bodyOf(request: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as JsonRecord;
  } catch {
    throw new ValidationError('Corpo JSON inválido.', 'INVALID_JSON');
  }
}

function notFound(internal: string): never {
  throw new NotFoundError(
    RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
    RESOURCE_NOT_FOUND_CODE,
    internal,
  );
}

async function accessibleClass(
  context: AuthenticatedRequestContext,
  classId: string,
): Promise<ClassGroup> {
  const classGroup = await repositories.classGroup.findById(classId);
  if (!classGroup) notFound(`ClassGroup ${classId} not found`);
  assertSameInstitution(context, classGroup.institutionId);
  if (context.role === 'PROFESSOR') assertClassOwner(context, classGroup);
  if (context.role === 'ALUNO') {
    const enrollment = await repositories.enrollment.find(context.userId, classId);
    if (!enrollment || enrollment.status !== 'ACTIVE') notFound(`Class ${classId} inaccessible`);
  }
  return classGroup;
}

async function accessibleLive(
  context: AuthenticatedRequestContext,
  liveId: string,
): Promise<LiveSession> {
  const live = await repositories.liveSession.findById(liveId);
  if (!live) notFound(`LiveSession ${liveId} not found`);
  assertSameInstitution(context, live.institutionId);
  if (context.role === 'PROFESSOR') assertClassOwner(context, live);
  if (context.role === 'ALUNO') {
    const enrollment = await repositories.enrollment.find(context.userId, live.classId);
    if (!enrollment || enrollment.status !== 'ACTIVE') notFound(`Live ${liveId} inaccessible`);
  }
  return live;
}

async function accessibleRecording(
  context: AuthenticatedRequestContext,
  recordingId: string,
): Promise<Recording> {
  const recording = await repositories.recording.findById(recordingId);
  if (!recording) notFound(`Recording ${recordingId} not found`);
  assertSameInstitution(context, recording.institutionId);
  await accessibleLive(context, recording.liveId);
  return recording;
}

function cursorPage<T>(request: Request, items: readonly T[]): {
  readonly items: readonly T[];
  readonly nextCursor?: string;
} {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  let offset = 0;
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    try {
      offset = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Number.isInteger(offset) || offset < 0) throw new Error();
    } catch {
      throw new ValidationError('Cursor inválido.', 'INVALID_CURSOR');
    }
  }
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return nextOffset < items.length
    ? { items: pageItems, nextCursor: Buffer.from(String(nextOffset)).toString('base64url') }
    : { items: pageItems };
}

async function scanEntity<T>(
  entityPrefix: 'COURSE#' | 'CLASS#' | 'LIVE#' | 'RECORDING#',
  institutionId: string,
): Promise<readonly T[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await getDocumentClient().send(
      new ScanCommand({
        TableName: getEnv().DYNAMODB_TABLE_NAME,
        FilterExpression:
          'begins_with(PK, :prefix) AND institutionId = :institutionId AND ' +
          (entityPrefix === 'RECORDING#' ? 'begins_with(SK, :recording)' : 'SK = :metadata'),
        ExpressionAttributeValues: {
          ':prefix': entityPrefix === 'RECORDING#' ? 'COURSE#' : entityPrefix,
          ':institutionId': institutionId,
          ...(entityPrefix === 'RECORDING#'
            ? { ':recording': 'RECORDING#' }
            : { ':metadata': 'METADATA' }),
        },
        ...(exclusiveStartKey !== undefined ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey !== undefined);

  const internalFields = new Set([
    'PK',
    'SK',
    'GSI1PK',
    'GSI1SK',
    'GSI2PK',
    'GSI2SK',
    'GSI3PK',
    'GSI3SK',
    'ttl',
  ]);
  return items.map(
    (item) =>
      Object.fromEntries(
        Object.entries(item).filter(([field]) => !internalFields.has(field)),
      ) as T,
  );
}

export async function dispatchApiV1(
  request: Request,
  context: AuthenticatedRequestContext,
  segments: readonly string[],
): Promise<unknown> {
  const method = request.method;

  if (segments[0] === 'me' && segments.length === 1) {
    const profile = await repositories.userProfile.findBySub(context.userId);
    if (!profile) notFound(`UserProfile ${context.userId} not found`);
    if (method === 'GET') return profile;
    if (method === 'PATCH') {
      const body = await bodyOf(request);
      const updated = {
        ...profile,
        name: optionalString(body, 'name') ?? profile.name,
        email: optionalString(body, 'email') ?? profile.email,
        updatedAt: new Date().toISOString(),
      };
      await repositories.userProfile.save(updated);
      return updated;
    }
  }

  if (segments[0] === 'courses') {
    if (segments.length === 1 && method === 'GET') {
      const courses = await scanEntity<Course>('COURSE#', context.institutionId);
      return cursorPage(request, courses);
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await bodyOf(request);
      return useCases.createCourse.execute(context, {
        courseId: optionalString(body, 'id') ?? randomUUID(),
        name: requiredString(body, 'name'),
      });
    }
    const courseId = segments[1];
    if (courseId && segments.length === 2) {
      const course = await repositories.course.findById(courseId);
      if (!course) notFound(`Course ${courseId} not found`);
      assertSameInstitution(context, course.institutionId);
      if (method === 'GET') return course;
      if (method === 'PATCH') {
        assertRole(context, ['ADMIN']);
        const body = await bodyOf(request);
        const updated = { ...course, name: optionalString(body, 'name') ?? course.name };
        await repositories.course.save(updated);
        return updated;
      }
    }
  }

  if (segments[0] === 'classes') {
    if (segments.length === 1 && method === 'GET') {
      const all = await scanEntity<ClassGroup>('CLASS#', context.institutionId);
      const visible =
        context.role === 'ADMIN'
          ? all
          : context.role === 'PROFESSOR'
            ? all.filter((item) => item.teacherId === context.userId)
            : (
                await Promise.all(
                  all.map(async (item) => ({
                    item,
                    enrollment: await repositories.enrollment.find(context.userId, item.classId),
                  })),
                )
              )
                .filter(({ enrollment }) => enrollment?.status === 'ACTIVE')
                .map(({ item }) => item);
      return cursorPage(request, visible);
    }
    if (segments.length === 1 && method === 'POST') {
      const body = await bodyOf(request);
      const teacherId = optionalString(body, 'teacherId');
      return useCases.createClassGroup.execute(context, {
        classId: optionalString(body, 'id') ?? randomUUID(),
        courseId: requiredString(body, 'courseId'),
        name: requiredString(body, 'name'),
        ...(teacherId !== undefined ? { teacherId } : {}),
      });
    }
    const classId = segments[1];
    if (classId && segments.length === 2) {
      const classGroup = await accessibleClass(context, classId);
      if (method === 'GET') return classGroup;
      if (method === 'PATCH') {
        const body = await bodyOf(request);
        return useCases.updateClassGroup.execute(context, {
          classId,
          name: optionalString(body, 'name') ?? classGroup.name,
        });
      }
    }
    if (classId && segments[2] === 'lives' && segments.length === 3) {
      await accessibleClass(context, classId);
      if (method === 'GET') {
        return cursorPage(request, await repositories.liveSession.listByClass(classId));
      }
      if (method === 'POST') {
        const body = await bodyOf(request);
        const duration = body['scheduledDurationMinutes'];
        const description = optionalString(body, 'description');
        return useCases.scheduleLive.execute(context, {
          liveId: optionalString(body, 'id') ?? randomUUID(),
          classId,
          title: requiredString(body, 'title'),
          scheduledStartAt: requiredString(body, 'scheduledStartAt'),
          ...(description !== undefined ? { description } : {}),
          ...(typeof duration === 'number' ? { scheduledDurationMinutes: duration } : {}),
        });
      }
    }
  }

  if (segments[0] === 'lives') {
    if (segments.length === 1 && method === 'GET') {
      const all = await scanEntity<LiveSession>('LIVE#', context.institutionId);
      const visible: LiveSession[] = [];
      for (const live of all) {
        try {
          await accessibleLive(context, live.liveId);
          visible.push(live);
        } catch (error) {
          // Recurso fora da autorização do chamador não aparece na coleção.
          if (!(error instanceof DomainError)) throw error;
        }
      }
      return cursorPage(request, visible);
    }
    const liveId = segments[1];
    if (!liveId) return routeNotFound(method, segments);

    if (segments.length === 2) {
      const live = await accessibleLive(context, liveId);
      if (method === 'GET') return live;
      if (method === 'PATCH') {
        const body = await bodyOf(request);
        const description =
          body['description'] !== undefined
            ? optionalString(body, 'description')
            : live.description;
        const duration = body['scheduledDurationMinutes'];
        return useCases.updateLive.execute(context, {
          liveId,
          title: optionalString(body, 'title') ?? live.title,
          scheduledStartAt:
            optionalString(body, 'scheduledStartAt') ?? live.scheduledStartAt,
          ...(description !== undefined ? { description } : {}),
          ...(typeof duration === 'number'
            ? { scheduledDurationMinutes: duration }
            : live.scheduledDurationMinutes !== undefined
              ? { scheduledDurationMinutes: live.scheduledDurationMinutes }
              : {}),
        });
      }
    }
    if (segments.length === 3 && method === 'POST') {
      if (segments[2] === 'start') return useCases.startLive.execute(context, liveId);
      if (segments[2] === 'finish') return useCases.finishLive.execute(context, liveId);
      if (segments[2] === 'cancel') return useCases.cancelLive.execute(context, liveId);
      if (segments[2] === 'leave') return removeParticipant(context, liveId, context.userId, false);
    }
    if (segments[2] === 'participants') {
      await accessibleLive(context, liveId);
      if (segments.length === 3 && method === 'GET') {
        const live = await accessibleLive(context, liveId);
        assertClassOwner(context, live);
        return cursorPage(request, await repositories.liveParticipant.listByLive(liveId));
      }
      const userId = segments[3];
      if (userId && segments.length === 4 && method === 'DELETE') {
        return removeParticipant(context, liveId, userId, true);
      }
    }
    if (segments[2] === 'presenters' && segments.length === 5 && method === 'POST') {
      const userId = segments[3]!;
      const participant = await repositories.liveParticipant.findByUser(liveId, userId);
      if (!participant) notFound(`Participant user ${userId} not found in live ${liveId}`);
      if (segments[4] === 'promote') {
        return useCases.promoteParticipant.execute(context, {
          liveId,
          targetLiveParticipantId: participant.liveParticipantId,
        });
      }
      if (segments[4] === 'demote') {
        return useCases.demoteParticipant.execute(context, {
          liveId,
          targetLiveParticipantId: participant.liveParticipantId,
        });
      }
    }
    if (segments[2] === 'recordings') {
      const live = await accessibleLive(context, liveId);
      const recordings = (
        await scanEntity<Recording>('RECORDING#', context.institutionId)
      ).filter((recording) => recording.liveId === liveId);
      if (segments.length === 3 && method === 'GET') return cursorPage(request, recordings);
      if (segments.length === 4 && method === 'POST' && segments[3] === 'start') {
        assertClassOwner(context, live);
        const active = live.activeRecordingId
          ? await repositories.recording.findById(live.activeRecordingId)
          : null;
        return active ?? { status: 'PENDING_PUBLISHER', liveId };
      }
      if (segments.length === 4 && method === 'POST' && segments[3] === 'stop') {
        assertClassOwner(context, live);
        if (!live.activeRecordingId) {
          throw new ConflictError('Não há gravação ativa.', 'RECORDING_NOT_ACTIVE');
        }
        const recording = await repositories.recording.findById(live.activeRecordingId);
        if (!recording?.compositionArn) {
          throw new ConflictError('A gravação ainda está iniciando.', 'RECORDING_NOT_ACTIVE');
        }
        await new IvsRealTimeService().stopComposition(recording.compositionArn);
        return recording;
      }
    }
    if (segments.length === 3 && method === 'GET') {
      await accessibleLive(context, liveId);
      if (segments[2] === 'attendance') {
        const live = await accessibleLive(context, liveId);
        assertClassOwner(context, live);
        return cursorPage(request, await repositories.attendance.listByLive(liveId));
      }
      if (segments[2] === 'questions') {
        return cursorPage(request, await repositories.question.listByLive(liveId));
      }
      if (segments[2] === 'polls') {
        return cursorPage(request, await repositories.poll.listByLive(liveId));
      }
    }
  }

  if (segments[0] === 'recordings') {
    const recordingId = segments[1];
    if (!recordingId) return routeNotFound(method, segments);
    const recording = await accessibleRecording(context, recordingId);
    if (segments.length === 2 && method === 'GET') return recording;
    if (segments.length === 2 && method === 'PATCH') {
      const body = await bodyOf(request);
      const visibility = optionalString(body, 'visibility');
      if (visibility === 'PUBLISHED') {
        return useCases.publishRecording.execute(context, { recordingId });
      }
      if (visibility === 'HIDDEN') {
        return useCases.hideRecording.execute(context, { recordingId });
      }
      throw new ValidationError(
        'visibility deve ser PUBLISHED ou HIDDEN.',
        'VALIDATION_ERROR',
      );
    }
    if (segments.length === 3 && method === 'POST') {
      if (segments[2] === 'publish') {
        return useCases.publishRecording.execute(context, { recordingId });
      }
      if (segments[2] === 'hide') {
        return useCases.hideRecording.execute(context, { recordingId });
      }
    }
  }

  return routeNotFound(method, segments);
}

async function removeParticipant(
  context: AuthenticatedRequestContext,
  liveId: string,
  targetUserId: string,
  moderatorAction: boolean,
): Promise<{ readonly removed: true }> {
  const live = await accessibleLive(context, liveId);
  if (moderatorAction) assertClassOwner(context, live);
  if (!moderatorAction && targetUserId !== context.userId) {
    throw new ConflictError('Participante inválido.', 'PARTICIPANT_MISMATCH');
  }
  const participant = await repositories.liveParticipant.findByUser(liveId, targetUserId);
  if (!participant) {
    if (moderatorAction) {
      await writeParticipantRemovalAudit(context, liveId, targetUserId, 'NOT_PRESENT');
    }
    return { removed: true };
  }
  if (participant.ivsParticipantId && live.stageArn) {
    await new IvsRealTimeService().disconnectParticipant({
      stageArn: live.stageArn,
      ivsParticipantId: participant.ivsParticipantId,
      reason: moderatorAction ? 'Removido pelo professor.' : 'Participante saiu.',
    });
  }
  if (moderatorAction) {
    await writeParticipantRemovalAudit(
      context,
      liveId,
      targetUserId,
      'REMOVED',
      participant.liveParticipantId,
    );
  } else {
    await getDocumentClient().send(
      new DeleteCommand({
        TableName: getEnv().DYNAMODB_TABLE_NAME,
        Key: { PK: `LIVE#${liveId}`, SK: `PARTICIPANT#${participant.liveParticipantId}` },
      }),
    );
  }
  return { removed: true };
}

async function writeParticipantRemovalAudit(
  context: AuthenticatedRequestContext,
  liveId: string,
  targetUserId: string,
  outcome: 'REMOVED' | 'NOT_PRESENT',
  liveParticipantId?: string,
): Promise<void> {
  const occurredAt = new Date().toISOString();
  const auditId = randomUUID();
  const tableName = getEnv().DYNAMODB_TABLE_NAME;
  const auditItem = {
    PK: `INSTITUTION#${context.institutionId}`,
    SK: `AUDIT#${occurredAt}#${auditId}`,
    entityType: 'AuditEvent',
    auditId,
    action: 'LIVE_PARTICIPANT_REMOVED',
    actorUserId: context.userId,
    actorRole: context.role,
    institutionId: context.institutionId,
    liveId,
    targetUserId,
    outcome,
    occurredAt,
  };
  if (liveParticipantId) {
    await getDocumentClient().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: tableName,
              Key: { PK: `LIVE#${liveId}`, SK: `PARTICIPANT#${liveParticipantId}` },
            },
          },
          { Put: { TableName: tableName, Item: auditItem } },
        ],
      }),
    );
  } else {
    await getDocumentClient().send(new PutCommand({ TableName: tableName, Item: auditItem }));
  }
  structuredLog('info', {
    event: 'audit.live_participant.removed',
    auditId,
    actorUserId: context.userId,
    actorRole: context.role,
    institutionId: context.institutionId,
    liveId,
    targetUserId,
    outcome,
  });
}

function routeNotFound(method: string, segments: readonly string[]): never {
  throw new NotFoundError(
    'Endpoint não encontrado.',
    'ROUTE_NOT_FOUND',
    `${method} /api/v1/${segments.join('/')} not found`,
  );
}
