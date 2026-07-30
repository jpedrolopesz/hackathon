import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import type {
  LanguageCode,
  TranscribeClientConfig,
} from '@aws-sdk/client-transcribe';
import type {
  CompletedTranscription,
  StartTranscriptionInput,
  TranscriptionService,
} from '@/application/ports/TranscriptionService';
import { ServiceUnavailableError } from '@/domain/errors/ServiceUnavailableError';
import { parseTranscriptionOutput } from '@/infrastructure/aws/transcribe/parse-transcription-output';

const MAX_ATTEMPTS = 8;

export class TranscribeTranscriptionService
  implements TranscriptionService
{
  private readonly client: TranscribeClient;

  constructor(config: TranscribeClientConfig = {}) {
    this.client = new TranscribeClient({
      maxAttempts: MAX_ATTEMPTS,
      ...config,
    });
  }

  async startTranscription(input: StartTranscriptionInput): Promise<void> {
    try {
      await this.client.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: input.jobName,
          LanguageCode: input.languageCode as LanguageCode,
          Media: { MediaFileUri: input.mediaUri },
          Settings: {
            ShowSpeakerLabels: true,
            MaxSpeakerLabels: input.maxSpeakerLabels,
          },
          // Sem OutputBucketName: o bucket gerenciado devolve uma URL HTTPS
          // pré-assinada e elimina a necessidade do SDK de S3 neste adapter.
        }),
      );
    } catch (error) {
      // O nome determinístico torna um ConflictException sinal de reprocessamento
      // idempotente: o job já existe e não precisa ser iniciado novamente.
      if (hasErrorName(error, 'ConflictException')) {
        return;
      }
      throwTranslatedAwsError(error, 'StartTranscriptionJob');
    }
  }

  async fetchTranscription(
    jobName: string,
  ): Promise<CompletedTranscription> {
    let response;
    try {
      response = await this.client.send(
        new GetTranscriptionJobCommand({
          TranscriptionJobName: jobName,
        }),
      );
    } catch (error) {
      if (hasErrorName(error, 'NotFoundException')) {
        return {
          state: 'FAILED',
          segments: [],
          failureReason: `O job de transcrição ${jobName} não foi encontrado.`,
        };
      }
      throwTranslatedAwsError(error, 'GetTranscriptionJob');
    }

    const job = response.TranscriptionJob;
    // Job inexistente vira FAILED via NotFoundException; sucesso sem job é anomalia do serviço.
    if (job === undefined) {
      throw new ServiceUnavailableError(
        'O Amazon Transcribe devolveu uma resposta inesperada.',
        'SERVICE_UNAVAILABLE',
        `GetTranscriptionJob returned no TranscriptionJob for ${jobName}.`,
      );
    }

    const status = job.TranscriptionJobStatus;

    if (status === 'QUEUED' || status === 'IN_PROGRESS') {
      return { state: 'IN_PROGRESS', segments: [] };
    }

    if (status === 'FAILED') {
      return {
        state: 'FAILED',
        segments: [],
        failureReason:
          job.FailureReason ??
          'O Amazon Transcribe não informou o motivo da falha.',
      };
    }

    if (status !== 'COMPLETED' || !job.Transcript?.TranscriptFileUri) {
      throw new ServiceUnavailableError(
        'A resposta da transcrição está temporariamente indisponível.',
        'SERVICE_UNAVAILABLE',
        `GetTranscriptionJob returned an incomplete response for ${jobName}.`,
      );
    }

    const payload = await fetchTranscriptPayload(
      job.Transcript.TranscriptFileUri,
    );
    return {
      state: 'COMPLETED',
      segments: parseTranscriptionOutput(payload),
    };
  }
}

async function fetchTranscriptPayload(uri: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(uri);
  } catch (error) {
    throw new ServiceUnavailableError(
      'O arquivo de transcrição está temporariamente indisponível.',
      'SERVICE_UNAVAILABLE',
      `Transcript output request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    throw new ServiceUnavailableError(
      'O arquivo de transcrição está temporariamente indisponível.',
      'SERVICE_UNAVAILABLE',
      `Transcript output request returned HTTP ${response.status}.`,
    );
  }

  return response.json();
}

function hasErrorName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

function throwTranslatedAwsError(error: unknown, action: string): never {
  if (
    error instanceof Error &&
    [
      'ThrottlingException',
      'TooManyRequestsException',
      'ServiceUnavailableException',
      'InternalFailure',
    ].includes(error.name)
  ) {
    throw new ServiceUnavailableError(
      'O serviço de transcrição está temporariamente indisponível.',
      'SERVICE_UNAVAILABLE',
      `Amazon Transcribe ${error.name} on ${action} after SDK retries: ${error.message}`,
    );
  }

  throw error;
}
