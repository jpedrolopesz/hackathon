import * as path from 'node:path';
import { Duration, Fn, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import {
  HttpLambdaIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

export interface ApiStackProps extends PlatformStackProps {
  readonly table: dynamodb.ITable;
  readonly userPool: cognito.IUserPool;
  readonly panelClient: cognito.IUserPoolClient;
  readonly appEventBus: events.IEventBus;
  readonly recordingsBucket: s3.IBucket;
  readonly mediaDistributionDomainName: string;
  readonly cloudFrontPublicKeyId: string;
  readonly cloudFrontSigningSecretArn: string;
}

/**
 * Três superfícies de compute, uma HTTP API e uma WebSocket API — desenho aprovado na
 * Fase 1 (docs/fase-1-arquitetura.md).
 *
 * A função "next-server" referencia o bundle real gerado por `open-next build`
 * (`.open-next/server-functions/default`, formato `aws-lambda`/`aws-apigw-v2`
 * confirmado em `.open-next/open-next.output.json`). Escopo reduzido deliberadamente:
 * apenas o server function principal está implantado aqui. Otimização de imagem, fila
 * de revalidação ISR, warmer e o bucket/CloudFront de assets estáticos do OpenNext
 * ficam fora desta fase — não são necessários enquanto o painel não tiver páginas além
 * do scaffold do create-next-app, e serão adicionados na Fase 8 quando existirem.
 */
export class ApiStack extends Stack {
  readonly httpApi: apigwv2.HttpApi;
  readonly webSocketApi: apigwv2.WebSocketApi;
  readonly webSocketStage: apigwv2.WebSocketStage;
  readonly appDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.webSocketApi = new apigwv2.WebSocketApi(this, 'RealtimeApi');

    this.webSocketStage = new apigwv2.WebSocketStage(this, 'RealtimeApiStage', {
      webSocketApi: this.webSocketApi,
      stageName: props.config.envName,
      autoDeploy: true,
    });

    const nextServerFunction = new lambda.Function(this, 'NextServerFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../.open-next/server-functions/default'),
      ),
      memorySize: 1024,
      timeout: Duration.seconds(29),
      logRetention: props.config.logRetention,
      environment: {
        NODE_ENV: 'production',
        APP_ENV: props.config.envName,
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.panelClient.userPoolClientId,
        DYNAMODB_TABLE_NAME: props.table.tableName,
        S3_RECORDINGS_BUCKET_NAME: props.recordingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.mediaDistributionDomainName,
        CLOUDFRONT_KEY_PAIR_ID: props.cloudFrontPublicKeyId,
        CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: props.cloudFrontSigningSecretArn,
        EVENTBRIDGE_BUS_NAME: props.appEventBus.eventBusName,
        WEBSOCKET_API_ENDPOINT: this.webSocketStage.callbackUrl,
        LOG_LEVEL: props.config.envName === 'production' ? 'info' : 'debug',
        CORS_ALLOWED_ORIGINS: '*',
        CHAT_SHARD_COUNT: String(props.config.chatShardCount),
      },
    });

    props.table.grantReadWriteData(nextServerFunction);
    this.webSocketStage.grantManagementApiAccess(nextServerFunction);

    // Least privilege por conjunto de ações. Resource '*' mantido deliberadamente: a
    // política de exemplo oficial da AWS (getting-started-iam-permissions.html) usa
    // "*" para todas estas ações, mesmo as que exigem stageArn como parâmetro
    // obrigatório — não encontrei confirmação (a Service Authorization Reference é
    // renderizada por JS e bloqueou todas as tentativas de acesso) de que alguma delas
    // aceite Resource escopado a uma ARN de stage. Reavaliar manualmente antes de
    // apertar isso (ver docs/fase-1-arquitetura.md, seção 8).
    nextServerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsStageControlPlane',
        actions: [
          'ivs:CreateStage',
          'ivs:GetStage',
          'ivs:UpdateStage',
          'ivs:DeleteStage',
          'ivs:CreateParticipantToken',
          'ivs:DisconnectParticipant',
        ],
        resources: ['*'],
      }),
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      defaultIntegration: new HttpLambdaIntegration('NextServerIntegration', nextServerFunction),
    });

    this.appDistribution = new cloudfront.Distribution(this, 'AppDistribution', {
      comment: `Painel web + /api/v1 (${props.config.envName})`,
      defaultBehavior: {
        origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', this.httpApi.apiEndpoint))),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
    });

    const connectHandler = new lambdaNodejs.NodejsFunction(this, 'ConnectFunction', {
      entry: path.join(__dirname, '../../src/infrastructure/lambda-handlers/websocket/connect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      logRetention: props.config.logRetention,
      timeout: Duration.seconds(10),
      environment: { DYNAMODB_TABLE_NAME: props.table.tableName },
    });

    const disconnectHandler = new lambdaNodejs.NodejsFunction(this, 'DisconnectFunction', {
      entry: path.join(
        __dirname,
        '../../src/infrastructure/lambda-handlers/websocket/disconnect.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      logRetention: props.config.logRetention,
      timeout: Duration.seconds(10),
      environment: { DYNAMODB_TABLE_NAME: props.table.tableName },
    });

    const defaultHandler = new lambdaNodejs.NodejsFunction(this, 'DefaultRouteFunction', {
      entry: path.join(__dirname, '../../src/infrastructure/lambda-handlers/websocket/default.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      logRetention: props.config.logRetention,
      timeout: Duration.seconds(10),
      environment: {
        DYNAMODB_TABLE_NAME: props.table.tableName,
        CHAT_SHARD_COUNT: String(props.config.chatShardCount),
      },
    });

    for (const handler of [connectHandler, disconnectHandler, defaultHandler]) {
      props.table.grantReadWriteData(handler);
      this.webSocketStage.grantManagementApiAccess(handler);
    }

    this.webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
    });
    this.webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
    });

    const defaultIntegration = new WebSocketLambdaIntegration('DefaultIntegration', defaultHandler);
    this.webSocketApi.addRoute('$default', { integration: defaultIntegration });

    // Rotas nomeadas da seção 8 do README — despacham para o mesmo handler "$default";
    // o roteamento por routeKey só evita que a Lambda precise inspecionar o body para
    // saber qual ação foi chamada.
    const namedRoutes = [
      'live.join',
      'live.leave',
      'chat.send',
      'chat.delete',
      'reaction.send',
      'question.send',
      'question.answer',
      'question.highlight',
      'poll.create',
      'poll.vote',
      'poll.close',
      'participant.raiseHand',
      'participant.lowerHand',
      'participant.promote',
      'participant.demote',
    ];

    for (const routeKey of namedRoutes) {
      this.webSocketApi.addRoute(routeKey, {
        integration: new WebSocketLambdaIntegration(`${routeKey}Integration`, defaultHandler),
      });
    }
  }
}
