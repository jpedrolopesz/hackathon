import * as path from 'node:path';
import { Duration, Fn, Stack } from 'aws-cdk-lib';
import { AccessLogField, AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
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
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
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
  readonly cloudFrontSigningSecret: secretsmanager.ISecret;
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

    // Access log próprio (docs/fase-1-arquitetura.md, seção 10.1/10.8) com o mesmo
    // conjunto de campos do `defaultAccessLogFormat()` do CDK (montado aqui à mão só
    // porque esse helper é um método de instância e a stage ainda não existe neste
    // ponto): identidade de conexão, rota e status — nenhum campo com query string ou
    // corpo da mensagem. Isso é cinto e suspensório: mesmo o connectionToken (60s, uso
    // único) não deveria aparecer em log nenhum.
    //
    // Diferente de REST API (v1), HTTP/WebSocket API (v2) não usa a conta-a-conta
    // `cloudWatchRoleArn` — API Gateway v2 entrega os logs via o mecanismo gerenciado
    // de "Log Delivery" da AWS (confirmado na doc de logging de HTTP API: a lista de
    // permissões ali, `logs:CreateLogDelivery`/`PutResourcePolicy`/etc., é do
    // principal que FAZ O DEPLOY, não algo que este stack precisa provisionar).
    // Prerequisito operacional, não uma lacuna de código: quem faz `cdk deploy`
    // precisa dessas permissões na própria conta.
    const webSocketAccessLogGroup = new logs.LogGroup(this, 'RealtimeApiAccessLogs', {
      retention: props.config.logRetention,
      removalPolicy: props.config.removalPolicy,
    });
    const webSocketAccessLogFormat = new AccessLogFormat(
      [
        AccessLogField.contextIdentitySourceIp(),
        AccessLogField.contextIdentityCaller(),
        AccessLogField.contextIdentityUser(),
        `[${AccessLogField.contextRequestTime()}]`,
        `"${AccessLogField.contextEventType()} ${AccessLogField.contextRouteKey()} ${AccessLogField.contextConnectionId()}"`,
        AccessLogField.contextStatus(),
        AccessLogField.contextRequestId(),
      ].join(' '),
    );

    this.webSocketStage = new apigwv2.WebSocketStage(this, 'RealtimeApiStage', {
      webSocketApi: this.webSocketApi,
      stageName: props.config.envName,
      autoDeploy: true,
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(webSocketAccessLogGroup),
        format: webSocketAccessLogFormat,
      },
    });

    // `dataTraceEnabled: false` explícito — logging de execução com trace de dados
    // registra o payload inteiro da requisição (incluindo query string), e nunca deve
    // ser ligado aqui.
    const webSocketCfnStage = this.webSocketStage.node.defaultChild as apigwv2.CfnStage;
    webSocketCfnStage.defaultRouteSettings = { dataTraceEnabled: false };

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
        CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: props.cloudFrontSigningSecret.secretArn,
        EVENTBRIDGE_BUS_NAME: props.appEventBus.eventBusName,
        WEBSOCKET_API_ENDPOINT: this.webSocketStage.callbackUrl,
        LOG_LEVEL: props.config.envName === 'production' ? 'info' : 'debug',
        CORS_ALLOWED_ORIGINS: '*',
        CHAT_SHARD_COUNT: String(props.config.chatShardCount),
      },
    });

    props.table.grantReadWriteData(nextServerFunction);
    this.webSocketStage.grantManagementApiAccess(nextServerFunction);
    // Assinar URLs de playback do CloudFront (GetRecordingPlaybackUseCase, Fase 7)
    // precisa ler a chave privada em runtime — nunca em build time (ver
    // infrastructure/stacks/storage-stack.ts).
    props.cloudFrontSigningSecret.grantRead(nextServerFunction);

    // Confirmado na Service Authorization Reference (list_amazoninteractivevideoservice):
    // todas estas ações exigem resource type "stage" — Resource "*" da versão anterior
    // estava mais permissivo do que a API exige. Stage é criado dinamicamente por live
    // (não em CDK), então o Resource é um wildcard `stage/*`, mas a Condition por tag
    // `Environment` impede a Lambda desta stack de operar sobre uma stage de outro
    // ambiente mesmo que o ARN vaze (ex.: logs, erro, engenharia social) — isolamento
    // real entre development/staging/production, não só por convenção de nomes.
    const stageResourceArn = `arn:${this.partition}:ivs:${this.region}:${this.account}:stage/*`;

    nextServerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsCreateStage',
        actions: ['ivs:CreateStage'],
        resources: [stageResourceArn],
        // RequestTag (não ResourceTag): a stage ainda não existe no momento da chamada.
        // Força toda stage criada por esta Lambda a nascer tagueada com o ambiente —
        // é o que torna a Condition das outras ações (abaixo) efetiva.
        conditions: {
          StringEquals: { 'aws:RequestTag/Environment': props.config.envName },
        },
      }),
    );

    nextServerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'IvsStageOperations',
        actions: [
          'ivs:GetStage',
          'ivs:UpdateStage',
          'ivs:DeleteStage',
          'ivs:CreateParticipantToken',
          'ivs:DisconnectParticipant',
        ],
        resources: [stageResourceArn],
        conditions: {
          StringEquals: { 'aws:ResourceTag/Environment': props.config.envName },
        },
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

    // Lambda authorizer de REQUEST na rota $connect — único mecanismo de JWT para
    // WebSocket (docs/fase-1-arquitetura.md, seção 10.1; JWT authorizer nativo só
    // existe para HTTP API). Revisão de segurança pós-Fase-6: não reverifica o access
    // token do Cognito (que nunca vai na URL) — consome o connectionToken de uso único
    // emitido por /join e resolve role/institutionId via UserProfile. Não precisa mais
    // do User Pool/Client do Cognito.
    const connectAuthorizerHandler = new lambdaNodejs.NodejsFunction(
      this,
      'ConnectAuthorizerFunction',
      {
        entry: path.join(
          __dirname,
          '../../src/infrastructure/lambda-handlers/websocket/authorizer.ts',
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        logRetention: props.config.logRetention,
        timeout: Duration.seconds(10),
        environment: {
          DYNAMODB_TABLE_NAME: props.table.tableName,
        },
      },
    );

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
        WEBSOCKET_API_ENDPOINT: this.webSocketStage.callbackUrl,
      },
    });

    // O authorizer lê UserProfile e CONSOME o connectionToken (UpdateItem condicional
    // que marca o ticket como usado) — precisa de escrita na tabela, mas nunca chama
    // PostToConnection, por isso fica de fora do grant de management API (mesmo
    // raciocínio de escopo mínimo já aplicado ao IAM do IVS acima).
    props.table.grantReadWriteData(connectAuthorizerHandler);

    for (const handler of [connectHandler, disconnectHandler, defaultHandler]) {
      props.table.grantReadWriteData(handler);
      this.webSocketStage.grantManagementApiAccess(handler);
    }

    this.webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
      // identitySource explícito: o construtor `WebSocket` do browser não permite
      // headers customizados, então o connectionToken de uso único (emitido por
      // /join, nunca o access token do Cognito — docs/fase-1-arquitetura.md, seção
      // 10.1) vai na query string, não no header Authorization padrão.
      authorizer: new WebSocketLambdaAuthorizer('ConnectAuthorizer', connectAuthorizerHandler, {
        identitySource: ['route.request.querystring.ticket'],
      }),
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
      // `ping`: heartbeat de aplicação — o WebSocket API Gateway fecha conexões
      // idle após 10min, não ajustável, e não expõe frames de ping/pong nativos
      // (docs/fase-1-arquitetura.md, seção 10.8). `sync.resume`: retomada de estado
      // após reconexão (conexão de 2h também é teto rígido — mesma seção).
      'ping',
      'sync.resume',
    ];

    for (const routeKey of namedRoutes) {
      this.webSocketApi.addRoute(routeKey, {
        integration: new WebSocketLambdaIntegration(`${routeKey}Integration`, defaultHandler),
      });
    }

    // Reação não usa mais o rate limiter em DynamoDB (revisão de ponto de revisão —
    // cada reação era uma escrita, o oposto do que a Fase 1 tinha decidido). A
    // frequência agora é limitada aqui, no próprio API Gateway — mas é um limite
    // AGREGADO da rota inteira, não por aluno (docs/fase-1-arquitetura.md, seção
    // 10.7): protege o backend de um pico, mas não impede sozinho um usuário
    // individual de consumir mais do que a parte que lhe cabia do orçamento.
    webSocketCfnStage.routeSettings = {
      'reaction.send': {
        throttlingRateLimit: props.config.reactionRouteThrottle.rateLimit,
        throttlingBurstLimit: props.config.reactionRouteThrottle.burstLimit,
      },
    };
  }
}
