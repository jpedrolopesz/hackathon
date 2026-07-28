import {
  assertSameInstitution,
  RESOURCE_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
} from '@/application/authorization/guards';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import type { CloudFrontSigningServicePort } from '@/application/ports/CloudFrontSigningServicePort';
import type { EnrollmentRepository } from '@/application/ports/EnrollmentRepository';
import type { LiveSessionRepository } from '@/application/ports/LiveSessionRepository';
import type { RecordingRepository } from '@/application/ports/RecordingRepository';
import { ConflictError } from '@/domain/errors/ConflictError';
import { ForbiddenError } from '@/domain/errors/ForbiddenError';
import { NotFoundError } from '@/domain/errors/NotFoundError';

export interface GetRecordingPlaybackInput {
  readonly recordingId: string;
}

export interface RecordingPlaybackResult {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

// TTL curto de propósito (seção 5 do README/docs — "URL/cookie assinado, TTL curto")
// — não é a duração da sessão de estudo do aluno, é a janela de validade do link em
// si; o player reabre uma URL nova ao expirar, não precisa reautenticar a sessão toda.
const PLAYBACK_URL_TTL_MINUTES = 15;

/**
 * `GET /recordings/{id}/playback` (seção 7 do README). Só gera URL assinada se
 * `status === 'READY'` e `visibility === 'PUBLISHED'` — do contrário nem "ainda
 * processando" nem "escondida pelo professor" deveriam vazar a existência de um
 * manifesto (docs/fase-1-arquitetura.md, seção 5). Matrícula/dono de turma: mesma
 * checagem de `JoinLiveUseCase`, porque assistir ao replay exige o mesmo vínculo com
 * a turma que assistir ao vivo exigiria.
 */
export class GetRecordingPlaybackUseCase {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly cloudFrontSigningService: CloudFrontSigningServicePort,
    private readonly cloudFrontDomainName: string,
  ) {}

  async execute(
    context: AuthenticatedRequestContext,
    input: GetRecordingPlaybackInput,
  ): Promise<RecordingPlaybackResult> {
    const recording = await this.recordingRepository.findById(input.recordingId);
    if (!recording) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `Recording ${input.recordingId} not found`,
      );
    }
    assertSameInstitution(context, recording.institutionId);

    const live = await this.liveSessionRepository.findById(recording.liveId);
    if (!live) {
      throw new NotFoundError(
        RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
        RESOURCE_NOT_FOUND_CODE,
        `LiveSession ${recording.liveId} not found for recording ${input.recordingId}`,
      );
    }

    if (context.role === 'ALUNO') {
      const enrollment = await this.enrollmentRepository.find(context.userId, live.classId);
      if (!enrollment || enrollment.status !== 'ACTIVE') {
        throw new NotFoundError(
          RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
          RESOURCE_NOT_FOUND_CODE,
          `Student ${context.userId} is not (actively) enrolled in class ${live.classId}`,
        );
      }
    } else if (context.role === 'PROFESSOR' && live.teacherId !== context.userId) {
      throw new ForbiddenError(
        'Você não tem permissão para assistir a esta gravação.',
        'CLASS_NOT_OWNED',
        `Professor ${context.userId} does not own class ${live.classId}`,
      );
    }

    if (recording.status !== 'READY' || recording.visibility !== 'PUBLISHED') {
      throw new ConflictError(
        'Esta gravação ainda não está disponível.',
        'RECORDING_NOT_AVAILABLE',
        `Recording ${input.recordingId} has status ${recording.status}/visibility ${recording.visibility}`,
      );
    }
    if (!recording.cloudFrontPath) {
      throw new ConflictError(
        'Esta gravação ainda não está disponível.',
        'RECORDING_NOT_AVAILABLE',
        `Recording ${input.recordingId} is READY but has no cloudFrontPath`,
      );
    }

    const expiresAt = new Date(Date.now() + PLAYBACK_URL_TTL_MINUTES * 60_000);
    const playbackUrl = await this.cloudFrontSigningService.signUrl({
      url: `https://${this.cloudFrontDomainName}/${recording.cloudFrontPath}`,
      expiresAt,
    });

    return { playbackUrl, expiresAt: expiresAt.toISOString() };
  }
}
