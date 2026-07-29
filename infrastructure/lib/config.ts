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
  /** Throttle agregado da HTTP API; a autorização de negócio continua por usuário. */
  readonly httpApiThrottle: { readonly rateLimit: number; readonly burstLimit: number };
  /**
   * Teto absoluto da validade do cookie assinado de playback (GetRecordingPlaybackUseCase,
   * Fase 7) — a validade real é `duração da gravação + margem`, mas nunca passa
   * disto, mesmo para uma aula de muitas horas. Ver docs/fase-1-arquitetura.md, seção
   * 13 (ponto de revisão sobre TTL fixo vs. duração da gravação).
   */
  readonly playbackCookieMaxTtlMinutes: number;
  /** Teto do participant token; emissão usa duração agendada + margem. */
  readonly participantTokenMaxDurationMinutes: number;
  /**
   * Retenção de gravações no S3 (seção 14 do README — "política de retenção para
   * mensagens e gravações"). Produção nunca expira objetos automaticamente (só
   * transiciona para classes de armazenamento mais baratas) — decisão de produto,
   * não técnica: uma universidade normalmente quer manter aulas gravadas
   * indefinidamente, só economizando em storage "frio" com o tempo.
   */
  readonly recordingsRetention: {
    readonly transitionToInfrequentAccessAfterDays: number;
    readonly transitionToGlacierAfterDays: number;
    readonly expirationAfterDays?: number;
  };
  /** Retenção de mensagens de chat via TTL do DynamoDB (mesma exigência da seção 14).
   * Dias corridos desde `createdAt`. */
  readonly chatMessageRetentionDays: number;
}

const ENVIRONMENT_CONFIGS: Record<EnvironmentName, EnvironmentConfig> = {
  development: {
    envName: 'development',
    removalPolicy: RemovalPolicy.DESTROY,
    pointInTimeRecovery: false,
    logRetention: RetentionDays.ONE_WEEK,
    chatShardCount: 2,
    reactionRouteThrottle: { rateLimit: 10, burstLimit: 20 },
    httpApiThrottle: { rateLimit: 50, burstLimit: 100 },
    playbackCookieMaxTtlMinutes: 360,
    participantTokenMaxDurationMinutes: 360,
    recordingsRetention: {
      transitionToInfrequentAccessAfterDays: 30,
      transitionToGlacierAfterDays: 90,
      expirationAfterDays: 180,
    },
    chatMessageRetentionDays: 7,
  },
  staging: {
    envName: 'staging',
    removalPolicy: RemovalPolicy.DESTROY,
    pointInTimeRecovery: true,
    logRetention: RetentionDays.ONE_MONTH,
    chatShardCount: 4,
    reactionRouteThrottle: { rateLimit: 100, burstLimit: 200 },
    httpApiThrottle: { rateLimit: 250, burstLimit: 500 },
    playbackCookieMaxTtlMinutes: 360,
    participantTokenMaxDurationMinutes: 720,
    recordingsRetention: {
      transitionToInfrequentAccessAfterDays: 30,
      transitionToGlacierAfterDays: 90,
      expirationAfterDays: 365,
    },
    chatMessageRetentionDays: 30,
  },
  production: {
    envName: 'production',
    removalPolicy: RemovalPolicy.RETAIN,
    pointInTimeRecovery: true,
    logRetention: RetentionDays.SIX_MONTHS,
    chatShardCount: 16,
    reactionRouteThrottle: { rateLimit: 300, burstLimit: 600 },
    httpApiThrottle: { rateLimit: 1_000, burstLimit: 2_000 },
    playbackCookieMaxTtlMinutes: 720,
    participantTokenMaxDurationMinutes: 720,
    recordingsRetention: {
      transitionToInfrequentAccessAfterDays: 90,
      transitionToGlacierAfterDays: 365,
      // Sem expirationAfterDays: produção mantém gravações indefinidamente, só
      // migrando para storage mais barato com o tempo.
    },
    chatMessageRetentionDays: 180,
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

/**
 * Nome do EventBridge bus de eventos internos da aplicação — determinístico (não é um
 * token gerado pelo CDK), por isso `ApiStack` pode montar o mesmo valor sem precisar de
 * uma referência cross-stack ao construct `events.EventBus` de `EventBusStack`. Isso
 * importa: `ApiStack` já criou o bucket de gravações usado pela distribuição
 * CloudFront (behavior `/media/*` com Origin Access Control), e `IvsStack`/`EventBusStack`
 * dependem desse bucket — uma referência de volta de `ApiStack` para `EventBusStack`
 * fecharia um ciclo (Api -> EventBus -> Ivs -> Api). Usar o nome como string simples
 * quebra esse ciclo pela raiz.
 */
export function platformEventBusName(envName: EnvironmentName): string {
  return `platform-events-${envName}`;
}

export function applyPlatformTags(stack: Stack, tags: PlatformTags): void {
  Tags.of(stack).add('Project', tags.project);
  Tags.of(stack).add('Environment', tags.environment);
  Tags.of(stack).add('Institution', tags.institution);
  Tags.of(stack).add('ManagedBy', tags.managedBy);
  Tags.of(stack).add('CostCenter', tags.costCenter);
}
