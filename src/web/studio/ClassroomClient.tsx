'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Stage,
  StageEvents,
  LocalStageStream,
  SubscribeType,
  type StageStrategy,
  type StageParticipantInfo,
  type StageStream,
} from 'amazon-ivs-web-broadcast';
import type { ChatMessage } from '@/domain/entities/ChatMessage';
import type { Poll } from '@/domain/entities/Poll';
import type { Question } from '@/domain/entities/Question';
import { useLiveConnection, type RealtimeEnvelope } from '@/web/realtime/use-live-connection';
import { RemoteVideoTiles } from './RemoteVideoTiles';

interface JoinData {
  readonly ivs: { readonly participantToken: string };
  readonly realtime: { readonly connectionToken: string };
}

export function ClassroomClient({
  liveId,
  websocketUrl,
}: {
  liveId: string;
  websocketUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [connectionToken, setConnectionToken] = useState('');
  const [status, setStatus] = useState('Entrando na aula…');
  const [errorCode, setErrorCode] = useState<string>();
  const [chat, setChat] = useState<readonly ChatMessage[]>([]);
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  const [polls, setPolls] = useState<readonly Poll[]>([]);
  const [draft, setDraft] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [remoteStreams, setRemoteStreams] = useState<Readonly<Record<string, MediaStream>>>({});

  const onMessage = useCallback((event: RealtimeEnvelope) => {
    if (event.type === 'chat.message.created') {
      setChat((current) => [...current, event.data as ChatMessage]);
    } else if (
      event.type === 'question.created' ||
      event.type === 'question.answered' ||
      event.type === 'question.highlighted'
    ) {
      const question = event.data as Question;
      setQuestions((current) => [
        ...current.filter((item) => item.questionId !== question.questionId),
        question,
      ]);
    } else if (event.type === 'poll.created') {
      const poll = event.data as Poll;
      setPolls((current) => [...current.filter((item) => item.pollId !== poll.pollId), poll]);
    } else if (event.type === 'poll.closed') {
      const { poll } = event.data as { readonly poll: Poll };
      setPolls((current) => [...current.filter((item) => item.pollId !== poll.pollId), poll]);
    } else if (event.type === 'sync.resumed') {
      const data = event.data as {
        readonly chatMessages: readonly ChatMessage[];
        readonly questions: readonly Question[];
        readonly polls: readonly Poll[];
      };
      setChat(data.chatMessages);
      setQuestions(data.questions);
      setPolls(data.polls);
    }
  }, []);

  const connection = useLiveConnection({
    liveId,
    websocketUrl,
    initialConnectionToken: connectionToken,
    onMessage,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/panel/lives/${liveId}/join`, { method: 'POST' });
      const body = (await response.json()) as
        | { readonly data: JoinData }
        | { readonly error: { readonly code: string } };
      if (!response.ok || !('data' in body)) {
        if (!cancelled) setErrorCode('error' in body ? body.error.code : 'JOIN_FAILED');
        return;
      }
      if (cancelled) return;
      setConnectionToken(body.data.realtime.connectionToken);
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (cancelled) {
        for (const track of mediaStream.getTracks()) track.stop();
        return;
      }
      mediaStreamRef.current = mediaStream;
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
      const localStreams = mediaStream.getTracks().map((track) => new LocalStageStream(track));
      const strategy: StageStrategy = {
        stageStreamsToPublish: () => localStreams,
        shouldPublishParticipant: () => true,
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };
      const stage = new Stage(body.data.ivs.participantToken, strategy);
      stage.on(
        StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED,
        (participant: StageParticipantInfo, streams: StageStream[]) => {
          setRemoteStreams((current) => ({
            ...current,
            [participant.id]: new MediaStream(streams.map((stream) => stream.mediaStreamTrack)),
          }));
        },
      );
      stage.on(
        StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED,
        (participant: StageParticipantInfo) => {
          setRemoteStreams((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([participantId]) => participantId !== participant.id),
            ),
          );
        },
      );
      stage.on(StageEvents.ERROR, () => setErrorCode('IVS_STAGE_ERROR'));
      stageRef.current = stage;
      await stage.join();
      if (!cancelled) setStatus('Ao vivo');
    })().catch(() => {
      if (!cancelled) setErrorCode('JOIN_FAILED');
    });
    return () => {
      cancelled = true;
      stageRef.current?.leave();
      for (const track of mediaStreamRef.current?.getTracks() ?? []) track.stop();
    };
  }, [liveId]);

  if (errorCode) {
    return (
      <p className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        Não foi possível entrar na aula (código: {errorCode}).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <figure>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded-md bg-black"
          />
          <figcaption className="mt-1 text-xs opacity-60">Você</figcaption>
        </figure>
        <RemoteVideoTiles streams={remoteStreams} />
      </div>
      <p className="text-sm opacity-60">
        {status} — conexão: {connection.status}
      </p>
      <div className="grid gap-6 md:grid-cols-3">
        <section className="rounded-md border p-3">
          <h2 className="mb-2 font-semibold">Chat</h2>
          {chat.map((message) => (
            <p key={message.messageId} className="text-sm">
              {message.body}
            </p>
          ))}
          <div className="mt-3 flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 rounded border px-2"
              placeholder="Mensagem"
            />
            <button
              className="rounded border px-2"
              onClick={() => {
                if (draft.trim()) connection.send('chat.send', { body: draft.trim() });
                setDraft('');
              }}
            >
              Enviar
            </button>
          </div>
        </section>
        <section className="rounded-md border p-3">
          <h2 className="mb-2 font-semibold">Perguntas</h2>
          {questions.map((question) => (
            <p key={question.questionId} className="text-sm">
              {question.body}
            </p>
          ))}
          <div className="mt-3 flex gap-2">
            <input
              value={questionDraft}
              onChange={(event) => setQuestionDraft(event.target.value)}
              className="min-w-0 flex-1 rounded border px-2"
              placeholder="Pergunta"
            />
            <button
              className="rounded border px-2"
              onClick={() => {
                if (questionDraft.trim()) {
                  connection.send('question.send', { body: questionDraft.trim() });
                }
                setQuestionDraft('');
              }}
            >
              Enviar
            </button>
          </div>
        </section>
        <section className="rounded-md border p-3">
          <h2 className="mb-2 font-semibold">Enquetes</h2>
          {polls.map((poll) => (
            <div key={poll.pollId} className="mb-3 text-sm">
              <p className="font-medium">{poll.question}</p>
              {poll.options.map((option) => (
                <button
                  key={option.optionId}
                  disabled={poll.status !== 'OPEN'}
                  onClick={() =>
                    connection.send('poll.vote', {
                      pollId: poll.pollId,
                      optionId: option.optionId,
                    })
                  }
                  className="mr-2 mt-1 rounded border px-2 py-1 disabled:opacity-50"
                >
                  {option.text}
                </button>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
