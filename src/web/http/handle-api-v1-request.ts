import 'server-only';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { successResponse, toErrorResponseBody } from '@/shared/http';
import { resolveContextFromBearerToken } from '@/web/auth/bearer-context';
import { ValidationError } from '@/domain/errors/ValidationError';
import { ConflictError } from '@/domain/errors/ConflictError';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { getEnv } from '@/shared/config/env';
import { emitMetric, structuredLog } from '@/shared/observability/structured-log';

/**
 * Wrapper comum das rotas `/api/v1/*` (contrato do app iOS — seção 13 do README):
 * resolve o Bearer token, chama o handler, e traduz qualquer `DomainError` para o
 * envelope padrão (`toErrorResponseBody`, já usado por outras superfícies). Loading/
 * erro no CLIENTE (painel/iOS) deve reagir ao `code` deste envelope, nunca ao texto
 * de `message` (seção 13 do README, ponto de revisão da Fase 8).
 */
export async function handleApiV1Request<T>(
  request: Request,
  handler: (context: AuthenticatedRequestContext) => Promise<T>,
): Promise<NextResponse> {
  const requestId = randomUUID();
  const suppliedCorrelationId = request.headers.get('x-correlation-id');
  const correlationId =
    suppliedCorrelationId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : requestId;
  const startedAt = Date.now();
  const route = new URL(request.url).pathname;

  try {
    const context = await resolveContextFromBearerToken(request);
    const data = await executeWithIdempotency(request, context, () => handler(context));
    const response = NextResponse.json(successResponse(data, requestId));
    response.headers.set('x-correlation-id', correlationId);
    structuredLog('info', {
      event: 'api.request.completed',
      correlationId,
      requestId,
      route,
      method: request.method,
      status: 200,
      durationMs: Date.now() - startedAt,
    });
    emitMetric('Api2xx', 1, 'Count', { Method: request.method });
    emitMetric('ApiDuration', Date.now() - startedAt, 'Milliseconds', {
      Method: request.method,
    });
    return response;
  } catch (error) {
    const { status, body } = toErrorResponseBody(error, requestId);
    const response = NextResponse.json(body, { status });
    response.headers.set('x-correlation-id', correlationId);
    const errorCode = body.error.code;
    structuredLog(status >= 500 ? 'error' : 'warn', {
      event: 'api.request.failed',
      correlationId,
      requestId,
      route,
      method: request.method,
      status,
      durationMs: Date.now() - startedAt,
      errorCode,
    });
    emitMetric(status >= 500 ? 'Api5xx' : 'Api4xx', 1, 'Count', {
      Method: request.method,
    });
    return response;
  }
}

const NON_IDEMPOTENT_TOKEN_PATHS = [
  /\/join$/,
  /\/token\/refresh$/,
  /\/realtime\/ticket$/,
];

async function executeWithIdempotency<T>(
  request: Request,
  context: AuthenticatedRequestContext,
  operation: () => Promise<T>,
): Promise<T> {
  if (request.method === 'GET') return operation();
  const pathname = new URL(request.url).pathname;
  if (NON_IDEMPOTENT_TOKEN_PATHS.some((pattern) => pattern.test(pathname))) {
    return operation();
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new ValidationError(
      'O header Idempotency-Key é obrigatório nesta operação.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  const digest = createHash('sha256')
    .update(`${context.userId}\n${request.method}\n${pathname}\n${idempotencyKey}`)
    .digest('hex');
  const client = getDocumentClient();
  const tableName = getEnv().DYNAMODB_TABLE_NAME;
  const key = { PK: `IDEMPOTENCY#${digest}`, SK: 'RESULT' };
  const existing = await client.send(
    new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }),
  );
  if (existing.Item?.['result'] !== undefined) return existing.Item['result'] as T;
  if (existing.Item) {
    throw new ConflictError(
      'Uma requisição com esta Idempotency-Key ainda está em processamento.',
      'IDEMPOTENCY_IN_PROGRESS',
    );
  }

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...key,
          state: 'PENDING',
          userId: context.userId,
          ttl: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new ConflictError(
        'Uma requisição com esta Idempotency-Key ainda está em processamento.',
        'IDEMPOTENCY_IN_PROGRESS',
      );
    }
    throw error;
  }

  try {
    const result = await operation();
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #state = :completed, #result = :result',
        ExpressionAttributeNames: { '#state': 'state', '#result': 'result' },
        ExpressionAttributeValues: { ':completed': 'COMPLETED', ':result': result },
      }),
    );
    return result;
  } catch (error) {
    await client.send(new DeleteCommand({ TableName: tableName, Key: key }));
    throw error;
  }
}
