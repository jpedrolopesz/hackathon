'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Stage,
  LocalStageStream,
  SubscribeType,
  StageEvents,
  type StageStrategy,
} from 'amazon-ivs-web-broadcast';
import type { RealtimeEnvelope } from '@/web/realtime/use-live-connection';
import { useLiveConnection } from '@/web/realtime/use-live-connection';

interface JoinResponseData {
  readonly ivs: { readonly participantToken: string; readonly expiresAt: string };
  readonly realtime: { readonly connectionToken: string };
}

// Margem para renovar ANTES da expiração real — nunca esperar o token expirar de
// fato (a publicação cairia por alguns segundos até a troca completar). Folga de
// 10min é generosa frente aos 180min de validade (RefreshParticipantTokenUseCase).
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

type Phase = 'loading' | 'preview' | 'live' | 'error';

export function StudioClient({
  liveId,
  websocketUrl,
}: {
  liveId: string;
  websocketUrl: string;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | null>(null);
  const [log, setLog] = useState<readonly RealtimeEnvelope[]>([]);
  const [chatDraft, setChatDraft] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onMessage = useCallback((envelope: RealtimeEnvelope) => {
    setLog((current) => [...current.slice(-49), envelope]);
  }, []);

  const connection = useLiveConnection({
    liveId,
    websocketUrl,
    initialConnectionToken: connectionToken ?? '',
    onMessage,
  });

  const scheduleTokenRefresh = useCallback(
    (expiresAt: string) => {
      // Função nomeada (hoisted), não uma const externa — permite a chamada
      // recursiva (retry/reagendamento) sem o aviso de "acessada antes de
      // declarada" que uma referência a `scheduleTokenRefresh` (useCallback) teria.
      function run(currentExpiresAt: string): void {
        clearTimeout(refreshTimeoutRef.current);
        const delay = Math.max(
          new Date(currentExpiresAt).getTime() - Date.now() - TOKEN_REFRESH_MARGIN_MS,
          0,
        );
        refreshTimeoutRef.current = setTimeout(() => {
          void (async () => {
            const response = await fetch(`/api/panel/lives/${liveId}/token/refresh`, {
              method: 'POST',
            });
            if (!response.ok) {
              // Falha na renovação: mantém a sessão atual (o token velho ainda vale
              // até expirar de verdade) e tenta de novo em 1min, em vez de deixar o
              // usuário sem retry algum.
              refreshTimeoutRef.current = setTimeout(() => run(currentExpiresAt), 60_000);
              return;
            }
            const body = (await response.json()) as {
              data: { participantToken: string; expiresAt: string };
            };
            await stageRef.current?.exchangeToken(body.data.participantToken);
            run(body.data.expiresAt);
          })();
        }, delay);
      }
      run(expiresAt);
    },
    [liveId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          for (const track of mediaStream.getTracks()) track.stop();
          return;
        }
        mediaStreamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        const response = await fetch(`/api/panel/lives/${liveId}/join`, { method: 'POST' });
        if (!response.ok) {
          const body = (await response.json()) as { error: { code: string } };
          setErrorCode(body.error.code);
          setPhase('error');
          return;
        }
        const body = (await response.json()) as { data: JoinResponseData };
        if (cancelled) return;

        setConnectionToken(body.data.realtime.connectionToken);
        scheduleTokenRefresh(body.data.ivs.expiresAt);
        setPhase('preview');

        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];
        const localVideoStream = videoTrack ? new LocalStageStream(videoTrack) : undefined;
        const localAudioStream = audioTrack ? new LocalStageStream(audioTrack) : undefined;

        const strategy: StageStrategy = {
          stageStreamsToPublish: () =>
            [localVideoStream, localAudioStream].filter((s): s is LocalStageStream => s !== undefined),
          shouldPublishParticipant: () => true,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        };

        const stage = new Stage(body.data.ivs.participantToken, strategy);
        stage.on(StageEvents.ERROR, (error: unknown) => {
          console.error('IVS Stage error', error);
        });
        stageRef.current = stage;
      } catch (error) {
        if (!cancelled) {
          console.error('Falha ao preparar o estúdio', error);
          setErrorCode('MEDIA_ACCESS_DENIED');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimeoutRef.current);
      stageRef.current?.leave();
      for (const track of mediaStreamRef.current?.getTracks() ?? []) track.stop();
    };
  }, [liveId, scheduleTokenRefresh]);

  async function enterStage(): Promise<void> {
    await stageRef.current?.join();
    setPhase('live');
  }

  function sendChat(): void {
    if (!chatDraft.trim()) return;
    connection.send('chat.send', { body: chatDraft.trim() });
    setChatDraft('');
  }

  if (phase === 'error') {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Não foi possível entrar no estúdio (código: {errorCode ?? 'DESCONHECIDO'}). Verifique a
        permissão de câmera/microfone e tente novamente.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full rounded-md bg-black"
        />
        <div className="mt-3 flex items-center gap-3">
          {phase === 'preview' ? (
            <button
              onClick={() => void enterStage()}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Entrar ao vivo
            </button>
          ) : null}
          <span className="text-xs text-black/60 dark:text-white/60">
            {phase === 'loading' ? 'Preparando câmera e microfone…' : null}
            {phase === 'preview' ? 'Câmera e microfone prontos — teste antes de entrar.' : null}
            {phase === 'live' ? `Ao vivo — conexão: ${connection.status}` : null}
          </span>
        </div>
      </div>

      <div className="flex flex-col rounded-md border border-black/10 p-3 dark:border-white/15">
        <h2 className="mb-2 text-sm font-semibold">Atividade da sala</h2>
        <div className="mb-3 flex-1 space-y-1 overflow-y-auto text-xs">
          {log.map((envelope) => (
            <div key={envelope.eventId} className="text-black/70 dark:text-white/70">
              <span className="font-mono">{envelope.type}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendChat();
            }}
            placeholder="Mensagem no chat…"
            className="flex-1 rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
          />
          <button
            onClick={sendChat}
            className="rounded-md border border-black/10 px-3 py-1 text-sm dark:border-white/15"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
