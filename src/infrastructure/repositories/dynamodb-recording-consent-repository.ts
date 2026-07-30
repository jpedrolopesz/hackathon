import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { RecordingConsentRepository } from '@/application/ports/RecordingConsentRepository';
import type { RecordingConsent } from '@/domain/entities/RecordingConsent';

/**
 * PK=LIVE#{liveSessionId}, SK=CONSENT#{participantUserId}#{grantedAt} (ADR-012).
 * `grantedAt` preserva o histórico: revogar um consentimento e conceder outro não
 * sobrescreve o registro anterior. A leitura usa o prefixo do participante em uma
 * única Query descendente para obter o consentimento mais recente. `atInstant`
 * permanece na assinatura do port para o caso de uso avaliar a vigência, mas não
 * integra a chave nem filtra a leitura no repositório.
 */
export class DynamoDbRecordingConsentRepository implements RecordingConsentRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(consent: RecordingConsent): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `LIVE#${consent.liveSessionId}`,
          SK: `CONSENT#${consent.participantUserId}#${consent.grantedAt}`,
          ...consent,
        },
      }),
    );
  }

  async findActiveConsent(
    institutionId: string,
    liveSessionId: string,
    participantUserId: string,
    atInstant: string,
  ): Promise<RecordingConsent | null> {
    void atInstant;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `LIVE#${liveSessionId}`,
          ':prefix': `CONSENT#${participantUserId}#`,
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    if (!item || item['institutionId'] !== institutionId) {
      return null;
    }

    return toRecordingConsent(item);
  }
}

function toRecordingConsent(item: Record<string, unknown>): RecordingConsent {
  return {
    id: item['id'] as string,
    institutionId: item['institutionId'] as string,
    liveSessionId: item['liveSessionId'] as string,
    participantUserId: item['participantUserId'] as string,
    purposes: item['purposes'] as readonly string[],
    grantedAt: item['grantedAt'] as string,
    validFrom: item['validFrom'] as string,
    validUntil: item['validUntil'] as string,
    revokedAt: item['revokedAt'] as string | null,
    status: item['status'] as RecordingConsent['status'],
  };
}
