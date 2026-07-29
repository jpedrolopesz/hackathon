import 'server-only';
import {
  CreateParticipantTokenCommand,
  CreateStageCommand,
  DeleteStageCommand,
  DisconnectParticipantCommand,
  IVSRealTimeClient,
  StartCompositionCommand,
  StopCompositionCommand,
} from '@aws-sdk/client-ivs-realtime';
import type { IVSRealTimeClientConfig } from '@aws-sdk/client-ivs-realtime';
import { ServiceUnavailableError } from '@/domain/errors/ServiceUnavailableError';
import type {
  CreatedComposition,
  CreatedParticipantToken,
  CreatedStage,
  CreateParticipantTokenInput,
  CreateStageInput,
  DisconnectParticipantInput,
  IvsRealTimeServicePort,
  StartCompositionInput,
} from '@/application/ports/IvsRealTimeServicePort';
import { emitMetric } from '@/shared/observability/structured-log';

// Cotas de taxa do IVS Real-Time são fixas, não ajustáveis (5 TPS para
// CreateStage/DeleteStage/DisconnectParticipant/GetStage/StartComposition/
// StopComposition/GetComposition; 50 TPS para CreateParticipantToken — verificado em
// RealTimeUserGuide/service-quotas.html). maxAttempts alto (padrão do SDK é 3) porque,
// com 40 professores iniciando aula na mesma hora cheia, um único CreateStage pode
// precisar de várias tentativas. O backoff entre tentativas já é exponencial COM
// jitter completo por padrão no SDK — confirmado no código-fonte de @smithy/core:
// `Math.random() * 2 ** attempts * delayBase`, o algoritmo "full jitter" recomendado
// pela própria AWS. Não reimplementado aqui de propósito: reinventar isso valeria
// menos que configurar o que o SDK já faz corretamente.
const MAX_ATTEMPTS = 8;

export class IvsRealTimeService implements IvsRealTimeServicePort {
  private readonly client: IVSRealTimeClient;

  constructor(config: IVSRealTimeClientConfig = {}) {
    this.client = new IVSRealTimeClient({ maxAttempts: MAX_ATTEMPTS, ...config });
  }

  async createStage(input: CreateStageInput): Promise<CreatedStage> {
    const response = await this.run('CreateStage', () =>
      this.client.send(new CreateStageCommand({ name: input.name, tags: { ...input.tags } })),
    );

    const stageArn = response.stage?.arn;
    if (!stageArn) {
      throw new Error('CreateStage não retornou stage.arn.');
    }

    return { stageArn };
  }

  async deleteStage(stageArn: string): Promise<void> {
    await this.run('DeleteStage', () =>
      this.client.send(new DeleteStageCommand({ arn: stageArn })),
    );
  }

  async createParticipantToken(
    input: CreateParticipantTokenInput,
  ): Promise<CreatedParticipantToken> {
    const response = await this.run('CreateParticipantToken', () =>
      this.client.send(
        new CreateParticipantTokenCommand({
          stageArn: input.stageArn,
          userId: input.userId,
          attributes: { ...input.attributes },
          capabilities: [...input.capabilities],
          duration: input.durationMinutes,
        }),
      ),
    );

    const participantToken = response.participantToken;
    if (
      !participantToken?.token ||
      !participantToken.participantId ||
      !participantToken.expirationTime
    ) {
      throw new Error('CreateParticipantToken não retornou os campos esperados.');
    }

    return {
      token: participantToken.token,
      ivsParticipantId: participantToken.participantId,
      expiresAt: participantToken.expirationTime.toISOString(),
    };
  }

  async disconnectParticipant(input: DisconnectParticipantInput): Promise<void> {
    await this.run('DisconnectParticipant', () =>
      this.client.send(
        new DisconnectParticipantCommand({
          stageArn: input.stageArn,
          participantId: input.ivsParticipantId,
          reason: input.reason,
        }),
      ),
    );
  }

  async startComposition(input: StartCompositionInput): Promise<CreatedComposition> {
    const response = await this.run('StartComposition', () =>
      this.client.send(
        new StartCompositionCommand({
          stageArn: input.stageArn,
          idempotencyToken: input.idempotencyToken,
          // Sempre com tags — sem isso, StopComposition/GetComposition falham com
          // AccessDenied (a Condition de IAM em infrastructure/stacks/event-bus-stack.ts
          // exige a tag no recurso criado; fail-safe deliberado, docs/fase-1-
          // arquitetura.md seção 11).
          tags: { ...input.tags },
          destinations: [
            {
              s3: {
                storageConfigurationArn: input.storageConfigurationArn,
                encoderConfigurationArns: [input.encoderConfigurationArn],
              },
            },
          ],
        }),
      ),
    );

    const compositionArn = response.composition?.arn;
    if (!compositionArn) {
      throw new Error('StartComposition não retornou composition.arn.');
    }

    const s3Prefix = response.composition?.destinations?.[0]?.detail?.s3?.recordingPrefix;

    return { compositionArn, ...(s3Prefix !== undefined ? { s3Prefix } : {}) };
  }

  async stopComposition(compositionArn: string): Promise<void> {
    await this.run('StopComposition', () =>
      this.client.send(new StopCompositionCommand({ arn: compositionArn })),
    );
  }

  /**
   * Traduz `ThrottlingException` (depois que as tentativas automáticas do SDK se
   * esgotarem) para o erro de domínio — nunca deixa a exceção crua do AWS SDK vazar
   * para a camada de aplicação/casos de uso.
   */
  private async run<T>(actionName: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      emitMetric('IvsOperationFailures', 1, 'Count', { Operation: actionName });
      if (isThrottlingException(error)) {
        emitMetric('IvsThrottles', 1, 'Count', { Operation: actionName });
        throw new ServiceUnavailableError(
          'O serviço está temporariamente sobrecarregado. Tente novamente em instantes.',
          'SERVICE_UNAVAILABLE',
          `IVS ThrottlingException on ${actionName} after SDK retries exhausted: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw error;
    }
  }
}

function isThrottlingException(error: unknown): boolean {
  return error instanceof Error && error.name === 'ThrottlingException';
}
