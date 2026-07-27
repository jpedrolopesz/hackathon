import * as path from 'node:path';
import { Duration, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

export interface EventBusStackProps extends PlatformStackProps {
  readonly table: dynamodb.ITable;
  readonly encoderConfigurationArn: string;
  readonly storageConfigurationArn: string;
}

/**
 * Amazon IVS não publica no bus customizado da conta — os três `detail-type` de
 * interesse chegam sempre no event bus DEFAULT da conta (verificado na doc oficial,
 * ver docs/fase-1-arquitetura.md seção 5). Por isso as regras abaixo são criadas no
 * bus default, não no `appEventBus` (que existe só para eventos internos que a própria
 * aplicação venha a emitir, ex. notificações entre módulos — nada usa isso ainda).
 *
 * O nome do evento nunca é o detail-type: fica em `detail.event_name`. Padrão exato
 * verificado na doc `aws.ivs`.
 */
export class EventBusStack extends Stack {
  readonly appEventBus: events.EventBus;
  readonly ivsEventConsumer: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: EventBusStackProps) {
    super(scope, id, props);

    this.appEventBus = new events.EventBus(this, 'AppEventBus', {
      eventBusName: `platform-events-${props.config.envName}`,
    });

    const deadLetterQueue = new sqs.Queue(this, 'IvsEventConsumerDlq', {
      retentionPeriod: Duration.days(14),
    });

    this.ivsEventConsumer = new lambdaNodejs.NodejsFunction(this, 'IvsEventConsumerFunction', {
      entry: path.join(
        __dirname,
        '../../src/infrastructure/lambda-handlers/events/ivs-event-consumer.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      logRetention: props.config.logRetention,
      timeout: Duration.seconds(30),
      environment: {
        DYNAMODB_TABLE_NAME: props.table.tableName,
        IVS_ENCODER_CONFIGURATION_ARN: props.encoderConfigurationArn,
        IVS_STORAGE_CONFIGURATION_ARN: props.storageConfigurationArn,
      },
    });

    // Least privilege por conjunto de ações. Resource '*' mantido deliberadamente: a
    // política de exemplo oficial da AWS usa "*" para estas ações mesmo StartComposition
    // exigindo stageArn obrigatório — não consegui confirmar na Service Authorization
    // Reference (renderizada por JS, bloqueou todas as tentativas de acesso) se alguma
    // delas aceita Resource escopado. Reavaliar manualmente antes de apertar isso (ver
    // docs/fase-1-arquitetura.md, seção 8).
    this.ivsEventConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsCompositionControlPlane',
        actions: [
          'ivs:StartComposition',
          'ivs:StopComposition',
          'ivs:GetComposition',
          'ivs:ListCompositions',
        ],
        resources: ['*'],
      }),
    );

    // Sem isolamento fino por prefixo de PK aqui: no single-table design desta
    // plataforma, LiveSession/Recording ficam sob PKs diferentes (CLASS#/COURSE#) e
    // dynamodb:LeadingKeys só restringe por partition key, não por tipo de entidade.
    // Least privilege aplicado por AÇÃO (sem DeleteTable/UpdateTable/dynamodb:*).
    props.table.grantReadWriteData(this.ivsEventConsumer);

    const deadLetterQueueTarget = new targets.LambdaFunction(this.ivsEventConsumer, {
      deadLetterQueue,
      retryAttempts: 2,
    });

    new events.Rule(this, 'IvsStageUpdateRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Stage Update'],
        detail: {
          event_name: ['Participant Published', 'Participant Unpublished'],
        },
      },
      targets: [deadLetterQueueTarget],
    });

    new events.Rule(this, 'IvsCompositionStateChangeRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Composition State Change'],
        detail: {
          event_name: [
            'Session Start',
            'Session End',
            'Session Failure',
            'Destination Start',
            'Destination End',
            'Destination Failure',
            'Destination Reconnecting',
          ],
        },
      },
      targets: [deadLetterQueueTarget],
    });

    new events.Rule(this, 'IvsParticipantRecordingStateChangeRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Participant Recording State Change'],
        detail: {
          event_name: [
            'Recording Start',
            'Recording End',
            'Recording Start Failure',
            'Recording End Failure',
          ],
        },
      },
      targets: [deadLetterQueueTarget],
    });
  }
}
