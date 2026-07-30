import * as path from 'node:path';
import { Duration, Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { AccessLogField, AccessLogFormat, CfnAccount } from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import {
  HttpUserPoolAuthorizer,
  WebSocketLambdaAuthorizer,
} from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {
  HttpLambdaIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { platformEventBusName } from '../lib/config';
import type { PlatformStackProps } from '../lib/config';

export interface ApiStackProps extends PlatformStackProps {
  readonly table: dynamodb.ITable;
  readonly userPool: cognito.IUserPool;
  readonly panelClient: cognito.IUserPoolClient;
  readonly mobileClient: cognito.IUserPoolClient;
  // Precisa ser o tipo concreto (não `IUserPoolDomain`): `baseUrl()` só existe na
  // classe `UserPoolDomain`, não na interface — o domínio é sempre construído em
  // `CognitoStack`, então não há necessidade de importar por ARN aqui.
  readonly userPoolDomain: cognito.UserPoolDomain;
  readonly appDomainName?: string;
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
 *
 * **Ponto de revisão — bucket de gravações e chaves de assinatura do CloudFront vivem
 * aqui, não em uma `StorageStack` separada.** Tentativa anterior: bucket em uma stack,
 * distribuição CloudFront em outra. `S3BucketOrigin.withOriginAccessControl()` (usado
 * no behavior `/media/*` abaixo) adiciona automaticamente uma bucket policy que
 * restringe o acesso ao ARN desta distribuição específica — essa policy fica anexada
 * ao BUCKET, então a stack DONA DO BUCKET passa a depender da stack dona da
 * distribuição (para conhecer o ARN dela). Como a distribuição também depende do
 * bucket (como origin) e das chaves de assinatura, ter bucket/chaves em uma stack e a
 * distribuição em outra fecha um ciclo real de CloudFormation
 * (`«DependencyCycle»` no `cdk synth`) — não um erro de código, uma restrição
 * estrutural do próprio OAC. Único jeito correto de resolver: bucket, chaves de
 * assinatura e distribuição na MESMA stack. `IvsStack` (que também precisa do bucket,
 * para a `StorageConfiguration`) referencia `ApiStack.recordingsBucket` sem problema —
 * IVS ajusta a policy do bucket via seu próprio control plane em runtime, não via
 * CloudFormation, então essa referência é unidirecional (Ivs -> Api), nunca um ciclo.
 */
export class ApiStack extends Stack {
  readonly httpApi: apigwv2.HttpApi;
  readonly webSocketApi: apigwv2.WebSocketApi;
  readonly webSocketStage: apigwv2.WebSocketStage;
  readonly appDistribution: cloudfront.Distribution;
  readonly recordingsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Política de retenção (seção 14 do README) — transições de classe de
    // armazenamento sempre; expiração automática só onde o ambiente definir um prazo
    // (produção não define — mantém gravações indefinidamente, só fica mais barato
    // com o tempo). Valores por ambiente em infrastructure/lib/config.ts, nunca
    // fixos aqui.
    //
    // Ponto de revisão — classe de Glacier: `GLACIER` (Flexible Retrieval) exige
    // restore (minutos a horas) antes que o objeto volte a ficar legível; o
    // CloudFront não consegue servir um objeto arquivado sem esse passo manual
    // prévio. Usar isso quebraria o replay de qualquer gravação além do limiar,
    // silenciosamente, meses depois. Corrigido para `GLACIER_INSTANT_RETRIEVAL`
    // (confirmado no doc da própria CDK: "can be accessed in a few milliseconds"),
    // que o CloudFront serve normalmente, sem restore. Mínimo de cobrança de 90 dias
    // (Standard-IA: 30 dias) — os limiares por ambiente já respeitam isso (nunca
    // abaixo de 90 dias para a transição de Glacier).
    //
    // Objetos < 128 KB: desde set/2024 esse é o comportamento DEFAULT do S3 para
    // TODAS as classes de destino (antes, só IA/Intelligent-Tiering eram afetadas;
    // Glacier aceitava objetos pequenos por padrão) — um objeto abaixo de 128 KB
    // simplesmente não transiciona, fica em Standard para sempre, a menos que a regra
    // inclua um filtro `ObjectSizeGreaterThan` customizado (não configurado aqui, de
    // propósito). Efeito real nesta modelagem: o manifesto `.m3u8` (poucos KB) nunca
    // transiciona — aceitável, é pequeno e está no caminho crítico de toda reprodução,
    // não há ganho em resfriar algo tão pequeno e tão acessado. Os segmentos HLS, que
    // concentram o volume real de bytes armazenados, ficam bem acima do limiar com o
    // encoder configurado em `ivs-stack.ts` (2.5 Mbps): mesmo um segmento de 1s já
    // passa de 300 KB. A regra não fica parcialmente inerte para o que importa
    // (volume de armazenamento); só o manifesto, negligenciável, permanece em Standard.
    const retention = props.config.recordingsRetention;
    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: props.config.removalPolicy,
      autoDeleteObjects: props.config.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          id: 'recordings-retention',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(retention.transitionToInfrequentAccessAfterDays),
            },
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: Duration.days(retention.transitionToGlacierAfterDays),
            },
          ],
          ...(retention.expirationAfterDays !== undefined
            ? { expiration: Duration.days(retention.expirationAfterDays) }
            : {}),
        },
      ],
    });

    // A chave pública usada pelo CloudFront (PublicKey/KeyGroup) vem de um SSM
    // Parameter por ambiente — não é secreta, mas também não fica hardcoded:
    // `valueForStringParameter` gera uma dynamic reference resolvida pelo
    // CloudFormation no deploy, então o parâmetro pode ser criado depois deste
    // `cdk synth`, antes do deploy real. A chave PRIVADA correspondente nunca entra no
    // CDK: fica em um Secret do Secrets Manager criado vazio aqui e populado
    // manualmente fora do CDK; a aplicação lê o ARN em runtime (ver
    // CLOUDFRONT_PRIVATE_KEY_SECRET_ARN em src/shared/config/env.ts).
    const signingPublicKeyPem = ssm.StringParameter.valueForStringParameter(
      this,
      `/platform/${props.config.envName}/cloudfront/signing-public-key`,
    );

    const signingPublicKey = new cloudfront.PublicKey(this, 'PlaybackSigningPublicKey', {
      encodedKey: signingPublicKeyPem,
    });

    const signingPrivateKeySecret = new secretsmanager.Secret(
      this,
      'CloudFrontSigningPrivateKey',
      {
        description:
          'Chave privada (PEM) usada para assinar URLs/cookies do CloudFront de playback. ' +
          'Populada manualmente fora do CDK; nunca gerada ou lida pelo CloudFormation.',
        removalPolicy: props.config.removalPolicy,
      },
    );

    // Cookie de sessão do painel (OAuth BFF, Fase 8) — chave gerada pelo PRÓPRIO
    // Secrets Manager (`generateSecretString`, sem `secretStringTemplate`: é uma
    // string opaca, não um JSON com campos nomeados). Nunca aparece em texto claro no
    // CloudFormation nem é escolhida por nós — mesma filosofia da chave privada do
    // CloudFront, acima.
    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      description:
        'Chave para assinar/criptografar o cookie de sessão do painel (tokens do ' +
        'Cognito). Gerada automaticamente pelo Secrets Manager; nunca lida em build time.',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
      removalPolicy: props.config.removalPolicy,
    });

    this.webSocketApi = new apigwv2.WebSocketApi(this, 'RealtimeApi');

    // Access log próprio (docs/fase-1-arquitetura.md, seção 10.1/10.8) com o mesmo
    // conjunto de campos do `defaultAccessLogFormat()` do CDK (montado aqui à mão só
    // porque esse helper é um método de instância e a stage ainda não existe neste
    // ponto): identidade de conexão, rota e status — nenhum campo com query string ou
    // corpo da mensagem. Isso é cinto e suspensório: mesmo o connectionToken (60s, uso
    // único) não deveria aparecer em log nenhum.
    //
    // A configuração regional `cloudWatchRoleArn` do API Gateway é requisito real
    // também para access logging da WebSocket API v2. O primeiro deploy contra uma
    // conta nova falhou ao criar a Stage enquanto este valor estava ausente, embora o
    // synth aceitasse o template. A configuração é singleton por conta/região; fica
    // na mesma stack que a Stage e a dependência explícita evita a corrida entre os
    // dois resources durante o primeiro deploy.
    const apiGatewayCloudWatchRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonAPIGatewayPushToCloudWatchLogs',
        ),
      ],
    });
    const apiGatewayAccount = new CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn,
    });

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
    webSocketCfnStage.addResourceDependency(apiGatewayAccount);

    const nextServerFunction = new lambda.Function(this, 'NextServerFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../.open-next/server-functions/default'),
      ),
      memorySize: 1024,
      timeout: Duration.seconds(29),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: props.config.logRetention,
      environment: {
        NODE_ENV: 'production',
        APP_ENV: props.config.envName,
        ...(props.appDomainName !== undefined
          ? { APP_PUBLIC_ORIGIN: `https://${props.appDomainName}` }
          : {}),
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.panelClient.userPoolClientId,
        // Emissor real dos tokens (id_token/access_token) — formato fixo da AWS,
        // confirmado na doc de verificação de token do Cognito. Usado por
        // `aws-jwt-verify` (CognitoJwtVerifier) tanto no proxy quanto nas rotas
        // `/api/v1/*` para validar assinatura/expiração antes de confiar em qualquer
        // claim.
        COGNITO_ISSUER_URL: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
        COGNITO_HOSTED_UI_DOMAIN: props.userPoolDomain.baseUrl(),
        // Client secret NUNCA em env var/CloudFormation: lido em runtime via
        // `cognito-idp:DescribeUserPoolClient` (mesma filosofia da chave privada do
        // CloudFront — nunca um valor estático baked em deploy time). Ver IAM grant
        // abaixo (`CognitoDescribeUserPoolClient`).
        SESSION_SECRET_ARN: sessionSecret.secretArn,
        DYNAMODB_TABLE_NAME: props.table.tableName,
        S3_RECORDINGS_BUCKET_NAME: this.recordingsBucket.bucketName,
        CLOUDFRONT_KEY_PAIR_ID: signingPublicKey.publicKeyId,
        CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: signingPrivateKeySecret.secretArn,
        // Nome determinístico (ver `platformEventBusName`) — não uma referência ao
        // construct `events.EventBus` de `EventBusStack`. `EventBusStack` depende de
        // `IvsStack`, que depende de `ApiStack.recordingsBucket`; se `ApiStack`
        // também dependesse do construct do bus, o ciclo Api -> EventBus -> Ivs -> Api
        // fecharia. Ver docs/fase-1-arquitetura.md.
        EVENTBRIDGE_BUS_NAME: platformEventBusName(props.config.envName),
        WEBSOCKET_API_ENDPOINT: this.webSocketStage.callbackUrl,
        // URL wss:// que o NAVEGADOR usa para conectar — formato documentado da
        // AWS para WebSocket API (`wss://{apiId}.execute-api.{region}.amazonaws.com/{stage}`).
        // Diferente de WEBSOCKET_API_ENDPOINT (a URL https de management API,
        // usada só server-side).
        WEBSOCKET_CLIENT_URL: `wss://${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/${props.config.envName}`,
        LOG_LEVEL: props.config.envName === 'production' ? 'info' : 'debug',
        CORS_ALLOWED_ORIGINS:
          props.config.envName === 'development'
            ? 'http://localhost:3000'
            : props.appDomainName !== undefined
              ? `https://${props.appDomainName}`
              : '',
        CHAT_SHARD_COUNT: String(props.config.chatShardCount),
        PLAYBACK_COOKIE_MAX_TTL_MINUTES: String(props.config.playbackCookieMaxTtlMinutes),
        IVS_PARTICIPANT_TOKEN_MAX_DURATION_MINUTES: String(
          props.config.participantTokenMaxDurationMinutes,
        ),
      },
    });
    // Sem CLOUDFRONT_DOMAIN_NAME aqui de propósito — ver nota "ponto de revisão"
    // abaixo, perto de `appDistribution`: injetar o domínio da própria distribuição
    // que serve esta Lambda criaria uma dependência circular real no CloudFormation
    // (Lambda -> Distribution -> HttpApi -> Lambda). `GetRecordingPlaybackUseCase`
    // recebe o domínio por chamada (`appDomainName`), lido do `Host` da requisição
    // recebida — correto independente de custom domain, e resolve o ciclo pela raiz.

    props.table.grantReadWriteData(nextServerFunction);
    this.webSocketStage.grantManagementApiAccess(nextServerFunction);
    // Assinar URLs de playback do CloudFront (GetRecordingPlaybackUseCase, Fase 7)
    // precisa ler a chave privada em runtime — nunca em build time.
    signingPrivateKeySecret.grantRead(nextServerFunction);

    // Troca do `code` do OAuth por tokens (app/api/auth/callback) precisa autenticar
    // com o Cognito como client confidencial — a única forma de ler o secret sem
    // colocá-lo em CloudFormation/env var é buscá-lo em runtime. O serviço Cognito
    // Identity Provider só define ARN a nível de USER POOL (não existe ARN nem
    // condition key IAM por app client) — portanto não é possível escopar esta
    // action ao client específico na policy. O menor escopo suportado pela AWS é o
    // pool; em runtime, o código chama apenas o COGNITO_CLIENT_ID fixo desta stack.
    nextServerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'CognitoDescribePanelClient',
        actions: ['cognito-idp:DescribeUserPoolClient'],
        resources: [props.userPool.userPoolArn],
      }),
    );
    sessionSecret.grantRead(nextServerFunction);

    new cloudwatch.Alarm(this, 'NextServerErrorsAlarm', {
      metric: nextServerFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'NextServerThrottlesAlarm', {
      metric: nextServerFunction.metricThrottles(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'DynamoDbReadThrottlesAlarm', {
      metric: props.table.metric('ReadThrottleEvents', { statistic: 'sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'DynamoDbWriteThrottlesAlarm', {
      metric: props.table.metric('WriteThrottleEvents', { statistic: 'sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

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
        // Quando `CreateStage` recebe `tags`, o IVS também autoriza implicitamente
        // `TagResource` na mesma requisição. Sem ambas, a criação falha atomicamente.
        actions: ['ivs:CreateStage', 'ivs:TagResource'],
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

    const nextServerIntegration = new HttpLambdaIntegration(
      'NextServerIntegration',
      nextServerFunction,
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      defaultIntegration: nextServerIntegration,
      corsPreflight: {
        allowOrigins:
          props.config.envName === 'development'
            ? ['http://localhost:3000']
            : props.appDomainName !== undefined
              ? [`https://${props.appDomainName}`]
              : [],
        allowHeaders: [
          'authorization',
          'content-type',
          'idempotency-key',
          'x-correlation-id',
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        maxAge: Duration.hours(1),
      },
    });
    const httpCfnStage = this.httpApi.defaultStage?.node.defaultChild as
      | apigwv2.CfnStage
      | undefined;
    if (httpCfnStage) {
      httpCfnStage.defaultRouteSettings = {
        detailedMetricsEnabled: true,
        throttlingRateLimit: props.config.httpApiThrottle.rateLimit,
        throttlingBurstLimit: props.config.httpApiThrottle.burstLimit,
      };
    }

    // Ponto de revisão (Fase 8): JWT authorizer só em `/api/v1/*` — nunca no
    // `defaultIntegration`/`{proxy+}` acima, que serve as PÁGINAS do painel. Um
    // authorizer no catch-all bloquearia toda página HTML antes mesmo do middleware
    // (proxy.ts) do Next rodar, já que o painel autentica por SESSÃO DE COOKIE, não
    // por Bearer JWT — as duas superfícies (`/api/v1/*` para o app iOS/clientes
    // externos, cookie de sessão para o navegador do painel) coexistem por terem
    // authorizers em ROTAS diferentes da mesma HttpApi, nunca no nível da API inteira.
    // `HttpUserPoolAuthorizer` aceita tokens de QUALQUER client do pool listado aqui —
    // painel (server-to-server, agindo em nome do professor autenticado por cookie) e
    // o futuro app iOS (Bearer direto do dispositivo), mesmo contrato para os dois.
    this.httpApi.addRoutes({
      path: '/api/v1/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: nextServerIntegration,
      authorizer: new HttpUserPoolAuthorizer('ApiV1JwtAuthorizer', props.userPool, {
        userPoolClients: [props.panelClient, props.mobileClient],
      }),
    });

    // Ponto de revisão: playback de HLS assinado por cookie do CloudFront exige que
    // o cookie seja first-party — setado no MESMO domínio de onde o player faz as
    // requisições. Antes, o bucket de gravações era servido por uma distribuição
    // CloudFront própria (`StorageStack.mediaDistribution`), com um domínio
    // `*.cloudfront.net` diferente do domínio do painel — o cookie seria de
    // terceiros (Safari bloqueia por padrão, Chrome também). Corrigido: o bucket é
    // servido sob esta MESMA distribuição, via behavior de path (`media/*`), então o
    // cookie é first-party para quem acessa o painel.
    const keyGroup = new cloudfront.KeyGroup(this, 'PlaybackKeyGroup', {
      items: [signingPublicKey],
    });

    // `media/*` chega ao S3 com o prefixo "media/" ainda no caminho — mas as chaves
    // reais no bucket (definidas pelo IVS na composição, não por nós) não têm esse
    // prefixo. Uma CloudFront Function (edge, JS, sub-milissegundo, sem custo de
    // Lambda@Edge) remove o prefixo antes de encaminhar ao S3 — é o mecanismo nativo
    // do CloudFront para isso; não existe opção declarativa equivalente em
    // `additionalBehaviors`/`originPath` (`originPath` faz o oposto: acrescenta um
    // prefixo fixo, não remove um variável vindo do viewer).
    const stripMediaPrefixFunction = new cloudfront.Function(this, 'StripMediaPrefixFunction', {
      comment: `Remove o prefixo /media antes de encaminhar ao S3 (${props.config.envName})`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = request.uri.replace(/^\\/media/, '');
  return request;
}
`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // Ponto de revisão (Fase 8) — assets estáticos do OpenNext. Escopo MÍNIMO
    // deliberado: só `_next/static/*` (JS/CSS com hash de conteúdo no nome — o que
    // quebra o painel de verdade se servido pela Lambda em vez de um CDN estático).
    // Deixados de fora, registrados, não esquecidos: otimização de imagem
    // (`_next/image*`, precisaria da função `image-optimization-function` do
    // OpenNext), fila de revalidação ISR (SQS + `revalidation-function` — esta app
    // não usa `revalidate`/ISR ainda, nenhuma página estática o suficiente para
    // precisar) e o warmer (mantém a Lambda quente — otimização de latência, não
    // corretude). `favicon.ico`/`*.svg`/`BUILD_ID` do scaffold do create-next-app
    // também ficam de fora: caem no `defaultBehavior` (Lambda) e não impedem o painel
    // de carregar — só os chunks versionados de `_next/static` são o caminho crítico.
    const staticAssetsBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: props.config.removalPolicy,
      autoDeleteObjects: props.config.removalPolicy === RemovalPolicy.DESTROY,
    });

    // Conteúdo do bundle (`.open-next/assets/_next/static`) sincronizado no PRÓPRIO
    // `cdk deploy` — não é um passo manual à parte. `cacheControl` longo + `immutable`
    // é seguro aqui porque cada arquivo tem hash de conteúdo no nome (webpack/Next):
    // um deploy novo nunca reescreve um arquivo existente sob o mesmo nome, sempre
    // cria nomes novos — não há risco de servir uma versão velha em cache.
    new s3deploy.BucketDeployment(this, 'DeployStaticAssets', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../.open-next/assets/_next/static')),
      ],
      destinationBucket: staticAssetsBucket,
      destinationKeyPrefix: '_next/static',
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: true,
    });

    this.appDistribution = new cloudfront.Distribution(this, 'AppDistribution', {
      comment: `Painel web + /api/v1 + playback de gravações (${props.config.envName})`,
      defaultBehavior: {
        origin: new origins.HttpOrigin(Fn.select(2, Fn.split('/', this.httpApi.apiEndpoint)), {
          // O HttpApi substitui `Host` pelo domínio execute-api. Sem preservar o host
          // público, o Next rejeita toda Server Action porque compara `Origin` com
          // `X-Forwarded-Host` como proteção CSRF.
          ...(props.appDomainName !== undefined
            ? { customHeaders: { 'X-Forwarded-Host': props.appDomainName } }
            : {}),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        '_next/static/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(staticAssetsBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'media/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.recordingsBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // Só este behavior exige cookie assinado — o resto do painel (defaultBehavior,
          // acima) não precisa de assinatura nenhuma.
          trustedKeyGroups: [keyGroup],
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [
            { function: stripMediaPrefixFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          ],
        },
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
        tracing: lambda.Tracing.ACTIVE,
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
      tracing: lambda.Tracing.ACTIVE,
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
      tracing: lambda.Tracing.ACTIVE,
      environment: { DYNAMODB_TABLE_NAME: props.table.tableName },
    });

    const defaultHandler = new lambdaNodejs.NodejsFunction(this, 'DefaultRouteFunction', {
      entry: path.join(__dirname, '../../src/infrastructure/lambda-handlers/websocket/default.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      logRetention: props.config.logRetention,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        DYNAMODB_TABLE_NAME: props.table.tableName,
        CHAT_SHARD_COUNT: String(props.config.chatShardCount),
        WEBSOCKET_API_ENDPOINT: this.webSocketStage.callbackUrl,
        CHAT_MESSAGE_RETENTION_DAYS: String(props.config.chatMessageRetentionDays),
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
    const reactionRoute = this.webSocketApi.addRoute('reaction.send', {
      integration: new WebSocketLambdaIntegration(
        'reaction.sendIntegration',
        defaultHandler,
      ),
    });

    // Reação não usa mais o rate limiter em DynamoDB (revisão de ponto de revisão —
    // cada reação era uma escrita, o oposto do que a Fase 1 tinha decidido). A
    // frequência agora é limitada aqui, no próprio API Gateway — mas é um limite
    // AGREGADO da rota inteira, não por aluno (docs/fase-1-arquitetura.md, seção
    // 10.7): protege o backend de um pico, mas não impede sozinho um usuário
    // individual de consumir mais do que a parte que lhe cabia do orçamento.
    // `CfnStage.routeSettings` é tipado pelo CDK como um mapa de
    // `RouteSettingsProperty`, mas o serializer da versão atual não converte os
    // campos internos desse mapa para PascalCase. O synth anterior gerou
    // `throttlingBurstLimit`/`throttlingRateLimit`, que o provider real do API
    // Gateway rejeitou embora CloudFormation/CDK aceitassem o template. O override
    // explícito preserva os nomes exatos exigidos pelo resource provider.
    webSocketCfnStage.addOverride('Properties.RouteSettings', {
      'reaction.send': {
        ThrottlingRateLimit: props.config.reactionRouteThrottle.rateLimit,
        ThrottlingBurstLimit: props.config.reactionRouteThrottle.burstLimit,
      },
    });
    webSocketCfnStage.addResourceDependency(
      reactionRoute.node.defaultChild as apigwv2.CfnRoute,
    );
  }
}
