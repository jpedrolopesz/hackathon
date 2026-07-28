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
  /**
   * Domínio a partir do qual a URL/cookie de playback devem ser construídos — o
   * `Host` da requisição recebida (quem chama este use-case, a rota HTTP ainda não
   * implementada da Fase 8, resolve isso do próprio request, nunca de uma env var
   * fixa). Deliberado: injetar o domínio da distribuição CloudFront via variável de
   * ambiente na Lambda criaria uma dependência circular real no CloudFormation
   * (Lambda -> Distribution -> HttpApi -> Lambda, já que o painel/API E o playback
   * são servidos pela MESMA distribuição — ver infrastructure/stacks/api-stack.ts).
   * Passar por chamada também é mais correto: funciona com o domínio default do
   * CloudFront ou com um domínio customizado futuro, sem precisar saber qual em
   * build/deploy time.
   */
  readonly appDomainName: string;
}

export interface RecordingPlaybackCookies {
  readonly policy: string;
  readonly signature: string;
  readonly keyPairId: string;
}

export interface RecordingPlaybackResult {
  /** URL do manifesto HLS — SEM assinatura própria; a autorização é toda pelos
   * cookies (ver `cookies` abaixo), que também cobrem os segmentos. */
  readonly manifestUrl: string;
  readonly cookies: RecordingPlaybackCookies;
  /**
   * `Path` a usar no `Set-Cookie` da resposta HTTP (fora do escopo deste use-case —
   * é o handler HTTP, ainda não implementado, Fase 8, quem grava o cookie de
   * verdade). Escopado ao prefixo desta gravação especificamente — NUNCA ao domínio
   * inteiro, senão um aluno autorizado a uma aula assistiria a todas (o mesmo nome
   * de cookie seria reenviado para qualquer outra gravação).
   */
  readonly cookiePath: string;
  readonly expiresAt: string;
}

// Piso de segurança para gravações muito curtas (ou sem `durationSeconds` ainda
// registrado por algum motivo) — nunca emite um cookie mais curto que isto. Maior
// que a margem sozinha (abaixo), de propósito: para uma gravação de poucos minutos,
// é o piso que domina, não a margem.
const MIN_PLAYBACK_TTL_MINUTES = 15;
// Folga sobre a duração real: tempo de carregamento, pausas, retrocesso do aluno.
const PLAYBACK_TTL_MARGIN_MINUTES = 10;
// Teto absoluto — mesmo uma aula de muitas horas não deveria emitir um cookie válido
// por dias; configurável por ambiente (produção pode querer mais folga que dev).
const DEFAULT_MAX_PLAYBACK_TTL_MINUTES = 360;

/**
 * `GET /recordings/{id}/playback` (seção 7 do README).
 *
 * **Ponto de revisão crítico:** um HLS é um manifesto `.m3u8` MAIS N segmentos
 * (`.ts`/`.m4s`) em URLs próprias — uma URL assinada única (a versão anterior deste
 * use-case) só autoriza o manifesto; todo segmento seguinte bate no
 * `trustedKeyGroups` do CloudFront sem assinatura e recebe 403 (o replay carrega o
 * manifesto e trava — nunca toca). Corrigido para cookies assinados com policy
 * customizada, `Resource` em wildcard cobrindo o PREFIXO desta gravação
 * especificamente (`https://{domain}/media/{s3Prefix}/*` — o `/media` é o path do
 * behavior no CloudFront, ver nota abaixo; o `Resource` da policy tem que bater com a
 * URL que o NAVEGADOR pede, não com a chave real no S3) — nunca o domínio inteiro, que
 * deixaria um aluno autorizado a uma aula assistir a todas (mesmo nome de cookie,
 * qualquer prefixo).
 *
 * **TTL não é mais fixo.** Uma gravação de 2h com um cookie de 15min expira no meio
 * do replay. A validade agora é `duração da gravação + margem`, com piso e teto.
 *
 * **`HIDDEN` tem uma exceção deliberada:** o professor dono da turma (ou ADMIN)
 * ainda pode assistir uma gravação oculta — é uma ação de moderação/visibilidade
 * para a turma, não uma proibição do próprio autor rever o conteúdo. Só bloqueia
 * `ALUNO` (e professor de outra turma, que já cai no `assertClassOwner`-equivalente
 * antes disso).
 *
 * **Playback é servido sob `/media/*` da MESMA distribuição CloudFront do
 * painel/API** (`infrastructure/stacks/api-stack.ts`) — não uma distribuição
 * separada. Ponto de revisão: um cookie assinado do CloudFront é setado no domínio
 * de quem o emite; com duas distribuições (dois domínios `*.cloudfront.net`
 * diferentes), o cookie seria de terceiros para o navegador do aluno (Safari
 * bloqueia por padrão, Chrome também) — passaria num teste servidor-a-servidor e
 * falharia no navegador real. Unificado sob o mesmo domínio, o cookie é first-party.
 */
export class GetRecordingPlaybackUseCase {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly liveSessionRepository: LiveSessionRepository,
    private readonly enrollmentRepository: EnrollmentRepository,
    private readonly cloudFrontSigningService: CloudFrontSigningServicePort,
    private readonly maxTtlMinutes: number = DEFAULT_MAX_PLAYBACK_TTL_MINUTES,
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

    const isOwningProfessor = context.role === 'PROFESSOR' && live.teacherId === context.userId;

    if (context.role === 'ALUNO') {
      const enrollment = await this.enrollmentRepository.find(context.userId, live.classId);
      if (!enrollment || enrollment.status !== 'ACTIVE') {
        throw new NotFoundError(
          RESOURCE_NOT_FOUND_PUBLIC_MESSAGE,
          RESOURCE_NOT_FOUND_CODE,
          `Student ${context.userId} is not (actively) enrolled in class ${live.classId}`,
        );
      }
    } else if (context.role === 'PROFESSOR' && !isOwningProfessor) {
      throw new ForbiddenError(
        'Você não tem permissão para assistir a esta gravação.',
        'CLASS_NOT_OWNED',
        `Professor ${context.userId} does not own class ${live.classId}`,
      );
    }

    if (recording.status === 'HIDDEN') {
      if (!isOwningProfessor && context.role !== 'ADMIN') {
        throw new ConflictError(
          'Esta gravação ainda não está disponível.',
          'RECORDING_NOT_AVAILABLE',
          `Recording ${input.recordingId} is HIDDEN and requester is not the owning professor/admin`,
        );
      }
    } else if (recording.status !== 'READY' || recording.visibility !== 'PUBLISHED') {
      throw new ConflictError(
        'Esta gravação ainda não está disponível.',
        'RECORDING_NOT_AVAILABLE',
        `Recording ${input.recordingId} has status ${recording.status}/visibility ${recording.visibility}`,
      );
    }
    if (!recording.cloudFrontPath || !recording.s3Prefix) {
      throw new ConflictError(
        'Esta gravação ainda não está disponível.',
        'RECORDING_NOT_AVAILABLE',
        `Recording ${input.recordingId} is missing cloudFrontPath/s3Prefix`,
      );
    }

    const ttlMinutes = Math.min(
      Math.max(
        (recording.durationSeconds ?? 0) / 60 + PLAYBACK_TTL_MARGIN_MINUTES,
        MIN_PLAYBACK_TTL_MINUTES,
      ),
      this.maxTtlMinutes,
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

    const cookies = await this.cloudFrontSigningService.signCookiesForPrefix({
      resourceUrlPattern: `https://${input.appDomainName}/media/${recording.s3Prefix}/*`,
      expiresAt,
    });

    return {
      manifestUrl: `https://${input.appDomainName}/media/${recording.cloudFrontPath}`,
      cookies,
      cookiePath: `/media/${recording.s3Prefix}/`,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
