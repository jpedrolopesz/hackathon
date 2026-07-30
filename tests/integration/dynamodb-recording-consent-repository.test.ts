import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';
import { DynamoDbRecordingConsentRepository } from '@/infrastructure/repositories/dynamodb-recording-consent-repository';
import { launchDynamoDbLocal, stopDynamoDbLocal } from './support/dynamodb-local';

const PORT = 8210;
const TABLE_NAME = 'test-core-table-recording-consent';

let rawClient: DynamoDBClient;
let documentClient: DynamoDBDocumentClient;
let repository: DynamoDbRecordingConsentRepository;

function buildConsent(overrides: Partial<RecordingConsent> = {}): RecordingConsent {
  return {
    id: 'consent-int-1',
    institutionId: 'institution-1',
    liveSessionId: 'live-int-1',
    participantUserId: 'participant-int-1',
    purposes: ['TRANSCRIPTION'],
    grantedAt: '2026-01-01T09:00:00.000Z',
    validFrom: '2026-01-01T09:00:00.000Z',
    validUntil: '2026-01-01T12:00:00.000Z',
    revokedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

async function putConsent(consent: RecordingConsent): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LIVE#${consent.liveSessionId}`,
        SK: `CONSENT#${consent.participantUserId}#${consent.grantedAt}`,
        ...consent,
      },
    }),
  );
}

beforeAll(async () => {
  rawClient = await launchDynamoDbLocal(PORT);
  await rawClient.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
  );

  documentClient = DynamoDBDocumentClient.from(rawClient);
  repository = new DynamoDbRecordingConsentRepository(documentClient, TABLE_NAME);
}, 30_000);

afterAll(async () => {
  await rawClient.send(new DeleteTableCommand({ TableName: TABLE_NAME })).catch(() => undefined);
  stopDynamoDbLocal(PORT);
});

describe('DynamoDbRecordingConsentRepository', () => {
  it('returns an existing consent with every domain field', async () => {
    const consent = buildConsent();
    await putConsent(consent);

    await expect(
      repository.findActiveConsent(
        'institution-1',
        'live-int-1',
        'participant-int-1',
        '2026-01-01T10:00:00.000Z',
      ),
    ).resolves.toEqual(consent);
  });

  it('returns null when the item does not exist', async () => {
    await expect(
      repository.findActiveConsent(
        'institution-1',
        'live-int-missing',
        'participant-int-missing',
        '2026-01-01T10:00:00.000Z',
      ),
    ).resolves.toBeNull();
  });

  it('returns null when the item belongs to another institution', async () => {
    await putConsent(
      buildConsent({
        id: 'consent-foreign',
        institutionId: 'institution-2',
        liveSessionId: 'live-int-foreign',
        participantUserId: 'participant-int-foreign',
      }),
    );

    await expect(
      repository.findActiveConsent(
        'institution-1',
        'live-int-foreign',
        'participant-int-foreign',
        '2026-01-01T10:00:00.000Z',
      ),
    ).resolves.toBeNull();
  });

  it('keeps two participants from the same live session isolated', async () => {
    const first = buildConsent({
      id: 'consent-participant-1',
      liveSessionId: 'live-int-shared',
      participantUserId: 'participant-int-a',
    });
    const second = buildConsent({
      id: 'consent-participant-2',
      liveSessionId: 'live-int-shared',
      participantUserId: 'participant-int-b',
      purposes: ['TRANSCRIPTION', 'EDUCATIONAL_GUIDANCE'],
    });
    await putConsent(first);
    await putConsent(second);

    const foundFirst = await repository.findActiveConsent(
      'institution-1',
      'live-int-shared',
      'participant-int-a',
      '2026-01-01T10:00:00.000Z',
    );
    const foundSecond = await repository.findActiveConsent(
      'institution-1',
      'live-int-shared',
      'participant-int-b',
      '2026-01-01T10:00:00.000Z',
    );

    expect(foundFirst?.id).toBe('consent-participant-1');
    expect(foundSecond?.id).toBe('consent-participant-2');
  });

  it('save persists a consent that findActiveConsent retrieves', async () => {
    const consent = buildConsent({
      id: 'consent-saved',
      liveSessionId: 'live-int-save',
      participantUserId: 'participant-int-save',
    });

    await repository.save(consent);

    await expect(
      repository.findActiveConsent(
        'institution-1',
        'live-int-save',
        'participant-int-save',
        '2026-01-01T10:00:00.000Z',
      ),
    ).resolves.toEqual(consent);
  });

  it('returns the latest active consent while preserving the revoked history item', async () => {
    const revoked = buildConsent({
      id: 'consent-history-revoked',
      liveSessionId: 'live-int-history',
      participantUserId: 'participant-int-history',
      grantedAt: '2026-01-01T09:00:00.000Z',
      revokedAt: '2026-01-01T10:00:00.000Z',
      status: 'REVOKED',
    });
    const active = buildConsent({
      id: 'consent-history-active',
      liveSessionId: 'live-int-history',
      participantUserId: 'participant-int-history',
      grantedAt: '2026-01-01T11:00:00.000Z',
      validFrom: '2026-01-01T11:00:00.000Z',
      validUntil: '2026-01-01T14:00:00.000Z',
    });
    await repository.save(revoked);
    await repository.save(active);

    const latest = await repository.findActiveConsent(
      'institution-1',
      'live-int-history',
      'participant-int-history',
      '2026-01-01T12:00:00.000Z',
    );
    const historical = await documentClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: 'LIVE#live-int-history',
          SK: 'CONSENT#participant-int-history#2026-01-01T09:00:00.000Z',
        },
      }),
    );

    expect(latest?.id).toBe('consent-history-active');
    expect(historical.Item?.['id']).toBe('consent-history-revoked');
    expect(historical.Item?.['status']).toBe('REVOKED');
  });
});
