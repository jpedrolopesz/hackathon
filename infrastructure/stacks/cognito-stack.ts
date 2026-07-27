import { Duration, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

/**
 * Duas superfícies, dois app clients:
 * - painel web: cliente confidencial (tem secret) — o secret nunca sai do servidor
 *   Next.js, que atua como BFF.
 * - app iOS: cliente público (sem secret) — autentica via SRP direto no dispositivo.
 *
 * Nenhum grupo/role fica no Cognito: por decisão da Fase 1 (docs/fase-1-arquitetura.md),
 * role e institutionId vêm sempre do UserProfile no DynamoDB, nunca de um claim do token.
 *
 * Hosted UI vs. formulário de login customizado ainda não foi decidido (risco em aberto
 * na Fase 1) — por isso nenhum oAuth/callbackUrls é configurado aqui ainda.
 */
export class CognitoStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly panelClient: cognito.UserPoolClient;
  readonly mobileClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
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

    this.panelClient = this.userPool.addClient('PanelClient', {
      generateSecret: true,
      authFlows: { userSrp: true },
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
