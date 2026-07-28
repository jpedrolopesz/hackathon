import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { StackProps, Stack } from 'aws-cdk-lib';
import { Tags } from 'aws-cdk-lib';

export type EnvironmentName = 'development' | 'staging' | 'production';

export interface EnvironmentConfig {
  readonly envName: EnvironmentName;
  readonly removalPolicy: RemovalPolicy;
  readonly pointInTimeRecovery: boolean;
  readonly logRetention: RetentionDays;
  /**
   * Número de shards da partição de chat (PK=LIVE#{liveId}#{shard}, shard =
   * hash(userId) % chatShardCount) — ver docs/fase-1-arquitetura.md seção 6/8 para a
   * justificativa do valor de produção (16).
   */
  readonly chatShardCount: number;
  /**
   * Throttle da rota `reaction.send` no próprio API Gateway WebSocket (não é um limite
   * por usuário — é agregado, para toda a API, nesta rota; ver docs/fase-1-
   * arquitetura.md, seção 10.4/10.7 para o porquê de reação não usar mais o rate
   * limiter em DynamoDB).
   */
  readonly reactionRouteThrottle: { readonly rateLimit: number; readonly burstLimit: number };
}

const ENVIRONMENT_CONFIGS: Record<EnvironmentName, EnvironmentConfig> = {
  development: {
    envName: 'development',
    removalPolicy: RemovalPolicy.DESTROY,
    pointInTimeRecovery: false,
    logRetention: RetentionDays.ONE_WEEK,
    chatShardCount: 2,
    reactionRouteThrottle: { rateLimit: 10, burstLimit: 20 },
  },
  staging: {
    envName: 'staging',
    removalPolicy: RemovalPolicy.DESTROY,
    pointInTimeRecovery: true,
    logRetention: RetentionDays.ONE_MONTH,
    chatShardCount: 4,
    reactionRouteThrottle: { rateLimit: 100, burstLimit: 200 },
  },
  production: {
    envName: 'production',
    removalPolicy: RemovalPolicy.RETAIN,
    pointInTimeRecovery: true,
    logRetention: RetentionDays.SIX_MONTHS,
    chatShardCount: 16,
    reactionRouteThrottle: { rateLimit: 300, burstLimit: 600 },
  },
};

export function resolveEnvironmentName(contextValue: unknown): EnvironmentName {
  if (
    contextValue === 'development' ||
    contextValue === 'staging' ||
    contextValue === 'production'
  ) {
    return contextValue;
  }
  return 'development';
}

export function getEnvironmentConfig(envName: EnvironmentName): EnvironmentConfig {
  return ENVIRONMENT_CONFIGS[envName];
}

export interface PlatformStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

export interface PlatformTags {
  readonly project: string;
  readonly environment: EnvironmentName;
  readonly institution: string;
  readonly managedBy: string;
  readonly costCenter: string;
}

export function buildPlatformTags(envName: EnvironmentName, institution: string): PlatformTags {
  return {
    project: 'live-classes-platform',
    environment: envName,
    institution,
    managedBy: 'aws-cdk',
    costCenter: `edu-platform-${envName}`,
  };
}

export function applyPlatformTags(stack: Stack, tags: PlatformTags): void {
  Tags.of(stack).add('Project', tags.project);
  Tags.of(stack).add('Environment', tags.environment);
  Tags.of(stack).add('Institution', tags.institution);
  Tags.of(stack).add('ManagedBy', tags.managedBy);
  Tags.of(stack).add('CostCenter', tags.costCenter);
}
