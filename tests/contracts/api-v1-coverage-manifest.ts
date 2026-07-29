import type { Role } from '@/domain/value-objects/Role';

export type ContractExpectation = 200 | 403;
export type TenantExpectation = 'not-applicable' | 'collection-filtered' | 'resource-hidden';

export interface ApiV1ContractOperation {
  readonly method: 'get' | 'post' | 'patch' | 'delete';
  readonly path: string;
  readonly roles: Readonly<Record<Role, ContractExpectation>>;
  readonly tenant: TenantExpectation;
  readonly dimensions: {
    readonly successEnvelope: true;
    readonly errorEnvelope: true;
    readonly httpStatus: true;
    readonly roleAuthorization: true;
    readonly institutionIsolation: true;
  };
}

const covered = {
  successEnvelope: true,
  errorEnvelope: true,
  httpStatus: true,
  roleAuthorization: true,
  institutionIsolation: true,
} as const;

function operation(
  method: ApiV1ContractOperation['method'],
  path: string,
  admin: ContractExpectation,
  professor: ContractExpectation,
  aluno: ContractExpectation,
  tenant: TenantExpectation,
): ApiV1ContractOperation {
  return {
    method,
    path,
    roles: { ADMIN: admin, PROFESSOR: professor, ALUNO: aluno },
    tenant,
    dimensions: covered,
  };
}

/** Fonte explícita das expectativas; a suíte compara estas chaves ao OpenAPI. */
export const API_V1_CONTRACT_MANIFEST = [
  operation('get', '/me', 200, 200, 200, 'not-applicable'),
  operation('patch', '/me', 200, 200, 200, 'not-applicable'),
  operation('get', '/courses', 200, 200, 200, 'collection-filtered'),
  operation('post', '/courses', 200, 403, 403, 'not-applicable'),
  operation('get', '/courses/{courseId}', 200, 200, 200, 'resource-hidden'),
  operation('patch', '/courses/{courseId}', 200, 403, 403, 'resource-hidden'),
  operation('get', '/classes', 200, 200, 200, 'collection-filtered'),
  operation('post', '/classes', 200, 403, 403, 'not-applicable'),
  operation('get', '/classes/{classId}', 200, 200, 200, 'resource-hidden'),
  operation('patch', '/classes/{classId}', 200, 403, 403, 'resource-hidden'),
  operation('get', '/classes/{classId}/lives', 200, 200, 200, 'resource-hidden'),
  operation('post', '/classes/{classId}/lives', 200, 200, 403, 'resource-hidden'),
  operation('get', '/lives', 200, 200, 200, 'collection-filtered'),
  operation('get', '/lives/{liveId}', 200, 200, 200, 'resource-hidden'),
  operation('patch', '/lives/{liveId}', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/start', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/finish', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/cancel', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/leave', 200, 200, 200, 'resource-hidden'),
  operation('get', '/lives/{liveId}/participants', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/presenters/{userId}/promote', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/presenters/{userId}/demote', 200, 200, 403, 'resource-hidden'),
  operation('delete', '/lives/{liveId}/participants/{userId}', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/recordings/start', 200, 200, 403, 'resource-hidden'),
  operation('post', '/lives/{liveId}/recordings/stop', 200, 200, 403, 'resource-hidden'),
  operation('get', '/lives/{liveId}/recordings', 200, 200, 200, 'resource-hidden'),
  operation('get', '/recordings/{recordingId}', 200, 200, 200, 'resource-hidden'),
  operation('patch', '/recordings/{recordingId}', 200, 200, 403, 'resource-hidden'),
  operation('post', '/recordings/{recordingId}/publish', 200, 200, 403, 'resource-hidden'),
  operation('post', '/recordings/{recordingId}/hide', 200, 200, 403, 'resource-hidden'),
  operation('get', '/lives/{liveId}/attendance', 200, 200, 403, 'resource-hidden'),
  operation('get', '/lives/{liveId}/questions', 200, 200, 200, 'resource-hidden'),
  operation('get', '/lives/{liveId}/polls', 200, 200, 200, 'resource-hidden'),
  operation('post', '/lives/{liveId}/join', 200, 200, 200, 'resource-hidden'),
  operation('post', '/lives/{liveId}/token/refresh', 200, 200, 200, 'resource-hidden'),
  operation('post', '/lives/{liveId}/realtime/ticket', 200, 200, 200, 'resource-hidden'),
  operation('get', '/recordings/{recordingId}/playback', 200, 200, 200, 'resource-hidden'),
] as const satisfies readonly ApiV1ContractOperation[];

export function operationKey(operation: Pick<ApiV1ContractOperation, 'method' | 'path'>): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}
