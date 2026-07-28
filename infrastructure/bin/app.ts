#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
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
import { StorageStack } from '../stacks/storage-stack';

const app = new App();

const envName = resolveEnvironmentName(app.node.tryGetContext('env'));
const config = getEnvironmentConfig(envName);
const institution = (app.node.tryGetContext('institution') as string | undefined) ?? 'unspecified';
const tags = buildPlatformTags(envName, institution);

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'],
};

const suffix = `-${envName}`;

const cognitoStack = new CognitoStack(app, `Cognito${suffix}`, { config, env });

const dynamoDbStack = new DynamoDbStack(app, `DynamoDb${suffix}`, { config, env });

const storageStack = new StorageStack(app, `Storage${suffix}`, { config, env });

const ivsStack = new IvsStack(app, `Ivs${suffix}`, {
  config,
  env,
  recordingsBucket: storageStack.recordingsBucket,
});

const eventBusStack = new EventBusStack(app, `EventBus${suffix}`, {
  config,
  env,
  table: dynamoDbStack.table,
  encoderConfigurationArn: ivsStack.encoderConfiguration.attrArn,
  storageConfigurationArn: ivsStack.storageConfiguration.attrArn,
});

const apiStack = new ApiStack(app, `Api${suffix}`, {
  config,
  env,
  table: dynamoDbStack.table,
  userPool: cognitoStack.userPool,
  panelClient: cognitoStack.panelClient,
  appEventBus: eventBusStack.appEventBus,
  recordingsBucket: storageStack.recordingsBucket,
  mediaDistributionDomainName: storageStack.mediaDistribution.distributionDomainName,
  cloudFrontPublicKeyId: storageStack.signingPublicKey.publicKeyId,
  cloudFrontSigningSecret: storageStack.signingPrivateKeySecret,
});

for (const stack of [
  cognitoStack,
  dynamoDbStack,
  storageStack,
  ivsStack,
  eventBusStack,
  apiStack,
]) {
  applyPlatformTags(stack, tags);
}
