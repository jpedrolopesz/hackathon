#!/usr/bin/env node
import { CfnOutput, App } from 'aws-cdk-lib';
import {
  applyPlatformTags,
  buildPlatformTags,
  getEnvironmentConfig,
  resolveEnvironmentName,
} from '../lib/config';
import { ApiStack } from '../stacks/api-stack';
import { CognitoStack } from '../stacks/cognito-stack';
import { DynamoDbStack } from '../stacks/dynamodb-stack';
import { EventBusStack } from '../stacks/event-bus-stack';
import { IvsStack } from '../stacks/ivs-stack';

const app = new App();

const envName = resolveEnvironmentName(app.node.tryGetContext('env'));
const config = getEnvironmentConfig(envName);
const institution = (app.node.tryGetContext('institution') as string | undefined) ?? 'unspecified';
const tags = buildPlatformTags(envName, institution);
// Ver nota em stacks/cognito-stack.ts: domínio real só existe depois do primeiro
// deploy. `undefined` no primeiro deploy (só localhost fica habilitado); passar
// `--context appDomain=<dominio-do-cfnoutput>` num redeploy subsequente habilita o
// domínio de produção também.
const appDomainName = app.node.tryGetContext('appDomain') as string | undefined;

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'],
};

const suffix = `-${envName}`;

const cognitoStack = new CognitoStack(app, `Cognito${suffix}`, {
  config,
  env,
  institution,
  ...(appDomainName !== undefined ? { appDomainName } : {}),
});

const dynamoDbStack = new DynamoDbStack(app, `DynamoDb${suffix}`, { config, env });

// `ApiStack` precisa vir antes de `IvsStack`/`EventBusStack`: possui o bucket de
// gravações e as chaves de assinatura do CloudFront, co-localizados com a
// distribuição que os usa (ver "ponto de revisão" em stacks/api-stack.ts sobre por
// que isso não pode ficar em uma stack separada com Origin Access Control).
const apiStack = new ApiStack(app, `Api${suffix}`, {
  config,
  env,
  table: dynamoDbStack.table,
  userPool: cognitoStack.userPool,
  panelClient: cognitoStack.panelClient,
  mobileClient: cognitoStack.mobileClient,
  userPoolDomain: cognitoStack.userPoolDomain,
});

// Ver nota em stacks/cognito-stack.ts — o domínio real só é conhecido depois deste
// primeiro deploy; usar este output para o `--context appDomain=...` do redeploy que
// habilita login em produção no Cognito.
new CfnOutput(apiStack, 'AppDistributionDomainName', {
  value: apiStack.appDistribution.distributionDomainName,
  description:
    'Domínio da distribuição CloudFront unificada — use com --context appDomain=<valor> ' +
    'num redeploy para habilitar as callback/logout URLs de produção no Cognito.',
});

const ivsStack = new IvsStack(app, `Ivs${suffix}`, {
  config,
  env,
  recordingsBucket: apiStack.recordingsBucket,
});

const eventBusStack = new EventBusStack(app, `EventBus${suffix}`, {
  config,
  env,
  table: dynamoDbStack.table,
  encoderConfigurationArn: ivsStack.encoderConfiguration.attrArn,
  storageConfigurationArn: ivsStack.storageConfiguration.attrArn,
});

for (const stack of [cognitoStack, dynamoDbStack, apiStack, ivsStack, eventBusStack]) {
  applyPlatformTags(stack, tags);
}
