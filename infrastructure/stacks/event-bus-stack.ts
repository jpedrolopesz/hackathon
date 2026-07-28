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
        // Necessário para `tags: { Environment }` em StartComposition — sem isso,
        // GetComposition/StopComposition falham com AccessDenied (Condition de IAM
        // abaixo).
        APP_ENV: props.config.envName,
      },
    });

    // Confirmado na Service Authorization Reference: StartComposition exige DOIS
    // recursos obrigatórios ao mesmo tempo — stage E encoder-configuration (não é só
    // um "OU" entre eles). StopComposition/GetComposition exigem "composition", não
    // "stage" — assimetria real, um único statement genérico para "ações de
    // composição" teria falhado em runtime contra StopComposition/GetComposition.
    // `ivs:ListCompositions` removido: não estava confirmado na tabela e nenhum fluxo
    // documentado usa (o status é consultado via GetComposition, não List) — least
    // privilege por não conceder o que não é usado, não só por escopo de recurso.
    const stageResourceArn = `arn:${this.partition}:ivs:${this.region}:${this.account}:stage/*`;
    const compositionResourceArn = `arn:${this.partition}:ivs:${this.region}:${this.account}:composition/*`;

    this.ivsEventConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsStartComposition',
        actions: ['ivs:StartComposition'],
        // Encoder/Storage-Configuration são recursos estáticos desta stack (criados
        // uma vez, não por live) — ARN concreto, não wildcard, como pedido.
        resources: [stageResourceArn, props.encoderConfigurationArn, props.storageConfigurationArn],
        conditions: {
          StringEquals: {
            // A stage (e as configs, já tagueadas pelo CDK) precisam já pertencer a
            // este ambiente...
            'aws:ResourceTag/Environment': props.config.envName,
            // ...e a composição criada por esta chamada precisa nascer tagueada com o
            // mesmo ambiente, para a Condition de GetComposition/StopComposition
            // (abaixo) funcionar. Depende de Fase 7 passar `tags: { Environment }` na
            // chamada real de StartComposition — sem isso, GetComposition/
            // StopComposition falham com AccessDenied (fail-safe: melhor falhar alto
            // e cedo em teste do que silenciosamente aceitar composições sem tag).
            'aws:RequestTag/Environment': props.config.envName,
          },
        },
      }),
    );

    this.ivsEventConsumer.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsCompositionLifecycle',
        actions: ['ivs:StopComposition', 'ivs:GetComposition'],
        resources: [compositionResourceArn],
        conditions: {
          StringEquals: { 'aws:ResourceTag/Environment': props.config.envName },
        },
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
