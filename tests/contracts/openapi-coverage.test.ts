import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  API_V1_CONTRACT_MANIFEST,
  operationKey,
} from './api-v1-coverage-manifest';

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'delete']);
const document = parse(
  readFileSync(resolve(process.cwd(), 'docs/openapi.yaml'), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };
const openApiOperations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
  Object.keys(pathItem)
    .filter((method) => HTTP_METHODS.has(method))
    .map((method) => ({ method: method as 'get' | 'post' | 'patch' | 'delete', path })),
);

describe('OpenAPI-driven API v1 contract coverage', () => {
  it('has exactly one five-dimensional manifest entry for every OpenAPI operation', () => {
    const openApiKeys = openApiOperations.map(operationKey).sort();
    const manifestKeys = API_V1_CONTRACT_MANIFEST.map(operationKey).sort();

    expect(manifestKeys).toEqual(openApiKeys);
    expect(new Set(manifestKeys).size).toBe(manifestKeys.length);
    for (const entry of API_V1_CONTRACT_MANIFEST) {
      expect(entry.dimensions).toEqual({
        successEnvelope: true,
        errorEnvelope: true,
        httpStatus: true,
        roleAuthorization: true,
        institutionIsolation: true,
      });
      expect(Object.keys(entry.roles).sort()).toEqual(['ADMIN', 'ALUNO', 'PROFESSOR']);
      expect([200, 403]).toContain(entry.roles.ADMIN);
      expect([200, 403]).toContain(entry.roles.PROFESSOR);
      expect([200, 403]).toContain(entry.roles.ALUNO);
    }
  });

  it('nominally denies ALUNO on every administrative mutation', () => {
    const administrativeMutationPaths = [
      'POST /courses',
      'PATCH /courses/{courseId}',
      'POST /classes',
      'PATCH /classes/{classId}',
      'POST /classes/{classId}/lives',
      'PATCH /lives/{liveId}',
      'POST /lives/{liveId}/start',
      'POST /lives/{liveId}/finish',
      'POST /lives/{liveId}/cancel',
      'POST /lives/{liveId}/presenters/{userId}/promote',
      'POST /lives/{liveId}/presenters/{userId}/demote',
      'DELETE /lives/{liveId}/participants/{userId}',
      'POST /lives/{liveId}/recordings/start',
      'POST /lives/{liveId}/recordings/stop',
      'PATCH /recordings/{recordingId}',
      'POST /recordings/{recordingId}/publish',
      'POST /recordings/{recordingId}/hide',
    ];
    const byKey = new Map(
      API_V1_CONTRACT_MANIFEST.map((entry) => [operationKey(entry), entry]),
    );
    for (const key of administrativeMutationPaths) {
      expect(byKey.get(key)?.roles.ALUNO, key).toBe(403);
    }
  });
});
