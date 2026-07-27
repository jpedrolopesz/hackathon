import { Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

/**
 * Tabela única (single-table design) — decisão justificada em
 * docs/fase-1-arquitetura.md a partir dos doze padrões de acesso da seção 9 do README.
 *
 * Três GSIs cobrem os padrões que a chave primária (PK/SK) não resolve sozinha:
 * - GSI1: consultas "por dono" (ex.: turmas de um professor).
 * - GSI2: busca por id plano (LiveSession por liveId, Recording por recordingId,
 *   WebSocketConnection por connectionId).
 * - GSI3: esparso — só existe entrada enquanto o participante tem capability PUBLISH
 *   (apresentadores ativos de uma live).
 */
export class DynamoDbStack extends Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, 'CoreTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.config.pointInTimeRecovery,
      },
      timeToLiveAttribute: 'ttl',
      removalPolicy: props.config.removalPolicy,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
    });
  }
}
