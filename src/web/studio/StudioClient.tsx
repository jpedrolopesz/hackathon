'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Stage,
  LocalStageStream,
  SubscribeType,
  StageEvents,
  type StageStrategy,
} from 'amazon-ivs-web-broadcast';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import type { LiveParticipant } from '@/domain/entities/LiveParticipant';
import type { Poll } from '@/domain/entities/Poll';
import type { Question } from '@/domain/entities/Question';
import type { RealtimeEnvelope } from '@/web/realtime/use-live-connection';
import { useLiveConnection } from '@/web/realtime/use-live-connection';

interface JoinResponseData {
  readonly ivs: { readonly participantToken: string; readonly expiresAt: string };
  readonly realtime: { readonly connectionToken: string };
}

interface SyncData {
  readonly chatMessages: readonly ChatMessage[];
  readonly questions: readonly Question[];
  readonly polls: readonly Poll[];
}

interface ClosedPollData {
  readonly poll: Poll;
  readonly results: readonly { readonly optionId: string; readonly count: number }[];
}

const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
type Phase = 'loading' | 'preview' | 'live' | 'reconnecting' | 'error';

function upsertById<T>(items: readonly T[], item: T, id: (value: T) => string): readonly T[] {
  const withoutCurrent = items.filter((candidate) => id(candidate) !== id(item));
  return [...withoutCurrent, item];
}

export function StudioClient({
  liveId,
  websocketUrl,
  initialParticipants,
}: {
  liveId: string;
  websocketUrl: string;
  initialParticipants: readonly LiveParticipant[];
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  const [polls, setPolls] = useState<readonly Poll[]>([]);
  const [pollResults, setPollResults] = useState<
    Readonly<Record<string, readonly { readonly optionId: string; readonly count: number }[]>>
  >({});
  const [participants, setParticipants] = useState<readonly LiveParticipant[]>(initialParticipants);
  const [chatDraft, setChatDraft] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<readonly string[]>(['', '']);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const strategyRef = useRef<StageStrategy | null>(null);
  const phaseRef = useRef<Phase>('loading');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const updatePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const onMessage = useCallback((envelope: RealtimeEnvelope) => {
    switch (envelope.type) {
      case 'chat.message.created':
        setChatMessages((current) =>
          upsertById(current, envelope.data as ChatMessage, (message) => message.messageId),
        );
        break;
      case 'chat.message.deleted': {
        const { messageId } = envelope.data as { readonly messageId: string };
        setChatMessages((current) => current.filter((message) => message.messageId !== messageId));
        break;
      }
      case 'question.created':
      case 'question.answered':
      case 'question.highlighted':
        setQuestions((current) =>
          upsertById(current, envelope.data as Question, (question) => question.questionId),
        );
        break;
      case 'poll.created':
        setPolls((current) => upsertById(current, envelope.data as Poll, (poll) => poll.pollId));
        break;
      case 'poll.closed': {
        const data = envelope.data as ClosedPollData;
        setPolls((current) => upsertById(current, data.poll, (poll) => poll.pollId));
        setPollResults((current) => ({ ...current, [data.poll.pollId]: data.results }));
        break;
      }
      case 'participant.connected':
        setParticipants((current) =>
          upsertById(
            current,
            envelope.data as LiveParticipant,
            (participant) => participant.liveParticipantId,
          ),
        );
        break;
      case 'participant.disconnected': {
        const { liveParticipantId } = envelope.data as {
          readonly liveParticipantId: string;
        };
        setParticipants((current) =>
          current.filter((participant) => participant.liveParticipantId !== liveParticipantId),
        );
        break;
      }
      case 'sync.resumed': {
        const data = envelope.data as SyncData;
        setChatMessages(data.chatMessages);
        setQuestions(data.questions);
        setPolls(data.polls);
        break;
      }
      case 'error': {
        const data = envelope.data as { readonly message?: string };
        setNotice(data.message ?? 'A ação não pôde ser concluída.');
        break;
      }
    }
  }, []);

  const connection = useLiveConnection({
    liveId,
    websocketUrl,
    initialConnectionToken: connectionToken ?? '',
    onMessage,
  });

  const scheduleTokenRefresh = useCallback(
    (expiresAt: string) => {
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
              refreshTimeoutRef.current = setTimeout(() => run(currentExpiresAt), 60_000);
              return;
            }

            const body = (await response.json()) as {
              data: { participantToken: string; expiresAt: string };
            };
            const oldStage = stageRef.current;
            const strategy = strategyRef.current;
            if (!oldStage || !strategy) return;

            const wasLive = phaseRef.current === 'live';
            if (wasLive) {
              updatePhase('reconnecting');
              setNotice(
                'Renovando a autorização do IVS; a publicação será interrompida por instantes.',
              );
            }

            const replacement = new Stage(body.data.participantToken, strategy);
            replacement.on(StageEvents.ERROR, (error: unknown) => {
              console.error('IVS Stage error', error);
            });

            try {
              // CreateParticipantToken não é compatível com exchangeToken. Sair e
              // entrar novamente é obrigatório e causa uma breve interrupção.
              oldStage.leave();
              if (wasLive) await replacement.join();
              stageRef.current = replacement;
              if (wasLive) updatePhase('live');
              setNotice(wasLive ? 'Publicação reconectada com a autorização renovada.' : null);
              run(body.data.expiresAt);
            } catch (error) {
              console.error('Falha ao reconectar o Stage após renovar o token', error);
              stageRef.current = oldStage;
              try {
                if (wasLive) await oldStage.join();
                if (wasLive) updatePhase('live');
                setNotice(
                  'A renovação falhou; a sessão anterior foi restaurada. Tentaremos novamente.',
                );
              } catch (restoreError) {
                console.error('Falha ao restaurar o Stage anterior', restoreError);
                setErrorCode('TOKEN_RECONNECT_FAILED');
                updatePhase('error');
              }
              refreshTimeoutRef.current = setTimeout(() => run(currentExpiresAt), 60_000);
            }
          })();
        }, delay);
      }
      run(expiresAt);
    },
    [liveId, updatePhase],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          for (const track of mediaStream.getTracks()) track.stop();
          return;
        }
        mediaStreamRef.current = mediaStream;
        if (videoRef.current) videoRef.current.srcObject = mediaStream;

        const response = await fetch(`/api/panel/lives/${liveId}/join`, { method: 'POST' });
        if (!response.ok) {
          const body = (await response.json()) as { error: { code: string } };
          setErrorCode(body.error.code);
          updatePhase('error');
          return;
        }
        const body = (await response.json()) as { data: JoinResponseData };
        if (cancelled) return;

        setConnectionToken(body.data.realtime.connectionToken);
        scheduleTokenRefresh(body.data.ivs.expiresAt);

        const videoTrack = mediaStream.getVideoTracks()[0];
        const audioTrack = mediaStream.getAudioTracks()[0];
        const localVideoStream = videoTrack ? new LocalStageStream(videoTrack) : undefined;
        const localAudioStream = audioTrack ? new LocalStageStream(audioTrack) : undefined;
        const strategy: StageStrategy = {
          stageStreamsToPublish: () =>
            [localVideoStream, localAudioStream].filter(
              (stream): stream is LocalStageStream => stream !== undefined,
            ),
          shouldPublishParticipant: () => true,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        };
        strategyRef.current = strategy;

        const stage = new Stage(body.data.ivs.participantToken, strategy);
        stage.on(StageEvents.ERROR, (error: unknown) => {
          console.error('IVS Stage error', error);
        });
        stageRef.current = stage;
        updatePhase('preview');
      } catch (error) {
        if (!cancelled) {
          console.error('Falha ao preparar o estúdio', error);
          setErrorCode('MEDIA_ACCESS_DENIED');
          updatePhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(refreshTimeoutRef.current);
      stageRef.current?.leave();
      for (const track of mediaStreamRef.current?.getTracks() ?? []) track.stop();
    };
  }, [liveId, scheduleTokenRefresh, updatePhase]);

  async function enterStage(): Promise<void> {
    await stageRef.current?.join();
    updatePhase('live');
  }

  function sendChat(): void {
    if (!chatDraft.trim()) return;
    connection.send('chat.send', { body: chatDraft.trim() });
    setChatDraft('');
  }

  function createPoll(): void {
    const options = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (!pollQuestion.trim() || options.length < 2) {
      setNotice('Informe uma pergunta e pelo menos duas opções.');
      return;
    }
    connection.send('poll.create', { question: pollQuestion.trim(), options });
    setPollQuestion('');
    setPollOptions(['', '']);
  }

  if (phase === 'error') {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Não foi possível entrar no estúdio (código: {errorCode ?? 'DESCONHECIDO'}). Verifique a
        câmera, o microfone e a conexão antes de tentar novamente.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </div>
      ) : null}

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
              {phase === 'reconnecting' ? 'Reconectando a publicação com um token novo…' : null}
            </span>
          </div>
        </div>

        <section className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <h2 className="mb-2 text-sm font-semibold">
            Participantes ao vivo ({participants.length})
          </h2>
          <ul className="space-y-2 text-xs">
            {participants.map((participant) => (
              <li key={participant.liveParticipantId}>
                <span className="font-medium">{participant.role}</span>
                {' — '}
                {participant.capabilities.includes('PUBLISH') ? 'Apresentador' : 'Espectador'}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <h2 className="mb-3 text-sm font-semibold">Chat e moderação</h2>
          <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
            {chatMessages.map((message) => (
              <div
                key={message.messageId}
                className="flex items-start justify-between gap-2 text-xs"
              >
                <p>
                  <span className="font-medium">{message.authorRole}:</span> {message.body}
                </p>
                <button
                  onClick={() => connection.send('chat.delete', { messageId: message.messageId })}
                  className="text-red-700 underline dark:text-red-300"
                >
                  Excluir
                </button>
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
              className="min-w-0 flex-1 rounded-md border border-black/10 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
            />
            <button onClick={sendChat} className="rounded-md border px-3 py-1 text-sm">
              Enviar
            </button>
          </div>
        </section>

        <section className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <h2 className="mb-3 text-sm font-semibold">Perguntas</h2>
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {questions.map((question) => (
              <div
                key={question.questionId}
                className="rounded-md bg-black/5 p-2 text-xs dark:bg-white/10"
              >
                <p>{question.body}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span>{question.status}</span>
                  <button
                    onClick={() =>
                      connection.send('question.highlight', { questionId: question.questionId })
                    }
                    className="underline"
                  >
                    Destacar
                  </button>
                </div>
              </div>
            ))}
            {questions.length === 0 ? (
              <p className="text-xs opacity-60">Nenhuma pergunta.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-md border border-black/10 p-3 dark:border-white/15">
          <h2 className="mb-3 text-sm font-semibold">Enquetes</h2>
          <div className="mb-4 space-y-2">
            <input
              value={pollQuestion}
              onChange={(event) => setPollQuestion(event.target.value)}
              placeholder="Pergunta da enquete"
              className="w-full rounded-md border px-2 py-1 text-sm dark:bg-transparent"
            />
            {pollOptions.map((option, index) => (
              <input
                key={index}
                value={option}
                onChange={(event) =>
                  setPollOptions((current) =>
                    current.map((value, optionIndex) =>
                      optionIndex === index ? event.target.value : value,
                    ),
                  )
                }
                placeholder={`Opção ${index + 1}`}
                className="w-full rounded-md border px-2 py-1 text-sm dark:bg-transparent"
              />
            ))}
            <div className="flex gap-2">
              <button
                onClick={() => setPollOptions((current) => [...current, ''])}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Adicionar opção
              </button>
              <button
                onClick={createPoll}
                className="rounded-md bg-black px-2 py-1 text-xs text-white dark:bg-white dark:text-black"
              >
                Criar enquete
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {polls.map((poll) => (
              <div key={poll.pollId} className="rounded-md bg-black/5 p-2 text-xs dark:bg-white/10">
                <p className="font-medium">{poll.question}</p>
                <ul className="my-2 space-y-1">
                  {poll.options.map((option) => {
                    const count = pollResults[poll.pollId]?.find(
                      (result) => result.optionId === option.optionId,
                    )?.count;
                    return (
                      <li key={option.optionId}>
                        {option.text}
                        {count !== undefined ? ` — ${count} voto(s)` : ''}
                      </li>
                    );
                  })}
                </ul>
                {poll.status === 'OPEN' ? (
                  <button
                    onClick={() => connection.send('poll.close', { pollId: poll.pollId })}
                    className="text-red-700 underline dark:text-red-300"
                  >
                    Encerrar enquete
                  </button>
                ) : (
                  <span>Encerrada</span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
