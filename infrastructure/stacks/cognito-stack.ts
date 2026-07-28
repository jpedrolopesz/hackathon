import { Duration, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

export interface CognitoStackProps extends PlatformStackProps {
  /** Só para compor o prefixo do domínio Hosted UI (namespace global do Cognito entre
   * TODAS as contas AWS) — não usado para mais nada nesta stack. */
  readonly institution: string;
  /**
   * Domínio da distribuição CloudFront unificada (`ApiStack.appDistribution`), só
   * para compor `callbackUrls`/`logoutUrls` do painel — ver nota abaixo sobre por que
   * isso é um CONTEXT VALUE (string simples), nunca uma referência de construct.
   */
  readonly appDomainName?: string;
}

/**
 * Duas superfícies, dois app clients:
 * - painel web: cliente confidencial (tem secret) — o secret nunca sai do servidor
 *   Next.js, que atua como BFF.
 * - app iOS: cliente público (sem secret) — autentica via SRP direto no dispositivo,
 *   sem Hosted UI/OAuth (ver nota abaixo).
 *
 * Nenhum grupo/role fica no Cognito: por decisão da Fase 1 (docs/fase-1-arquitetura.md),
 * role e institutionId vêm sempre do UserProfile no DynamoDB, nunca de um claim do token.
 *
 * **Ponto de revisão (Fase 8) — Hosted UI + Authorization Code, decidido.** O painel
 * web é um BFF: o cliente confidencial (com secret) troca o `code` por tokens no
 * SERVIDOR Next.js (`app/api/auth/callback`), nunca no navegador — sem SRP no
 * browser, sem tela de login própria.
 *
 * **`appDomainName` é um CONTEXT VALUE (string), nunca `apiStack.appDistribution.distributionDomainName`.**
 * `ApiStack` já depende de `CognitoStack` (precisa do `userPool`/`panelClient` para a
 * env var da Lambda) — se `CognitoStack` também referenciasse de volta
 * `ApiStack.appDistribution` como CONSTRUCT, fecharia um ciclo real de
 * CloudFormation (mesma classe de bug corrigida na revisão pós-Fase-7 entre
 * `StorageStack`/`ApiStack` — ver docs/fase-1-arquitetura.md). O domínio de uma
 * distribuição CloudFront só existe DEPOIS que ela é criada, então não há como
 * conhecê-lo no primeiro deploy de qualquer forma. Fluxo operacional (documentado,
 * não mágico): (1) primeiro deploy sem `--context appDomain=...` — só
 * `http://localhost:3000/...` fica configurado, suficiente para desenvolvimento; (2)
 * ler o domínio gerado no `CfnOutput` de `ApiStack`; (3) redeploy com
 * `--context appDomain=<dominio>` — o app client passa a aceitar login em produção
 * também. `UserPoolClient.callbackUrls` é uma lista estática assinada no próprio
 * client (não um recurso separado), então isto é 100% declarativo — sem Custom
 * Resource, sem chamada imperativa de SDK, sem risco de sobrescrever configuração por
 * um `UpdateUserPoolClient` parcial.
 *
 * O cliente MOBILE continua sem OAuth: um app iOS nativo autentica via SRP direto
 * (Amplify/SDK do Cognito), sem redirect de navegador — não precisa de Hosted UI.
 */
export class CognitoStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly panelClient: cognito.UserPoolClient;
  readonly mobileClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: props.config.removalPolicy,
    });

    // Prefixo do domínio Hosted UI é um namespace GLOBAL do Cognito (entre todas as
    // contas AWS, não só a nossa) — por isso leva instituição+ambiente, não só
    // "live-classes": reduz a chance de colisão. Se ainda assim colidir, o deploy
    // falha alto e cedo (erro do Cognito), nunca silenciosamente.
    this.userPoolDomain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: {
        domainPrefix: `${props.institution}-${props.config.envName}-live-classes`,
      },
    });

    const callbackUrls = [
      'http://localhost:3000/api/auth/callback',
      ...(props.appDomainName !== undefined
        ? [`https://${props.appDomainName}/api/auth/callback`]
        : []),
    ];
    const logoutUrls = [
      'http://localhost:3000/login',
      ...(props.appDomainName !== undefined ? [`https://${props.appDomainName}/login`] : []),
    ];

    this.panelClient = this.userPool.addClient('PanelClient', {
      generateSecret: true,
      authFlows: { userSrp: true },
      // Authorization Code (nunca Implicit — o client É confidencial, tem secret;
      // Implicit existe para clients que não conseguem guardar segredo nenhum).
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls,
        logoutUrls,
      },
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      preventUserExistenceErrors: true,
    });

    this.mobileClient = this.userPool.addClient('MobileClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      preventUserExistenceErrors: true,
    });
  }
}
