import type { ParticipantCapability } from '@/domain/entities/LiveParticipant';

export interface CreateStageInput {
  readonly name: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface CreatedStage {
  readonly stageArn: string;
}

export interface CreateParticipantTokenInput {
  readonly stageArn: string;
  /** Identificador opaco (liveParticipantId) — nunca sub do Cognito, e-mail ou nome. */
  readonly userId: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly capabilities: readonly ParticipantCapability[];
  readonly durationMinutes: number;
}

export interface CreatedParticipantToken {
  readonly token: string;
  readonly ivsParticipantId: string;
  readonly expiresAt: string;
}

export interface DisconnectParticipantInput {
  readonly stageArn: string;
  readonly ivsParticipantId: string;
  readonly reason?: string;
}

export interface StartCompositionInput {
  readonly stageArn: string;
  readonly encoderConfigurationArn: string;
  readonly storageConfigurationArn: string;
  /** Idempotency token da própria chamada `StartComposition` (não confundir com o
   * `recordingId` do domínio) — evita compor duas vezes se o mesmo comando for
   * reenviado por retry do SDK. */
  readonly idempotencyToken: string;
  /** Sempre `{ Environment: envName }` — sem isso, `StopComposition`/`GetComposition`
   * falham com `AccessDenied` (a Condition de IAM exige a tag no recurso criado; ver
   * `infrastructure/stacks/event-bus-stack.ts` e docs/fase-1-arquitetura.md, seção 11). */
  readonly tags: Readonly<Record<string, string>>;
}

export interface CreatedComposition {
  readonly compositionArn: string;
  /** Prefixo do objeto S3 sob o qual a composição grava — presente desde a criação
   * quando o destino é S3 (confirmado no shape de `Composition.destinations[].detail.s3`). */
  readonly s3Prefix?: string;
}

/**
 * Adapter para a API de controle do IVS Real-Time. Toda chamada pode lançar
 * `ServiceUnavailableError` (throttling — as cotas de taxa são fixas e não
 * ajustáveis, ver docs/fase-1-arquitetura.md seção 9) depois que as tentativas
 * automáticas do SDK (backoff exponencial com jitter, já embutido) se esgotarem.
 */
export interface IvsRealTimeServicePort {
  createStage(input: CreateStageInput): Promise<CreatedStage>;
  deleteStage(stageArn: string): Promise<void>;
  createParticipantToken(input: CreateParticipantTokenInput): Promise<CreatedParticipantToken>;
  disconnectParticipant(input: DisconnectParticipantInput): Promise<void>;
  startComposition(input: StartCompositionInput): Promise<CreatedComposition>;
  stopComposition(compositionArn: string): Promise<void>;
}
