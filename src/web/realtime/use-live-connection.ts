'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RealtimeEnvelope<T = unknown> {
  readonly type: string;
  readonly eventId: string;
  readonly liveId: string;
  readonly timestamp: string;
  readonly data: T;
}

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// Heartbeat bem abaixo do timeout de conexão ociosa (10min, fixo, não ajustável —
// docs/fase-1-arquitetura.md, seção 10.8): folga generosa para variação de rede.
const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000;

// Reconexão preventiva ANTES do teto de 2h (fixo, não ajustável) — contrato exato
// da seção 10.9: um ponto aleatório entre 1h45 e 1h55, nunca depois de 2h. O jitter
// (10min de janela) espalha o pico entre muitos clientes reconectando perto do
// mesmo horário de início de aula.
const RECONNECT_MIN_MS = (105 * 60 + 0) * 1000; // 1h45
const RECONNECT_MAX_MS = (115 * 60 + 0) * 1000; // 1h55

function randomReconnectDelayMs(): number {
  return RECONNECT_MIN_MS + Math.random() * (RECONNECT_MAX_MS - RECONNECT_MIN_MS);
}

export interface UseLiveConnectionOptions {
  readonly liveId: string;
  readonly websocketUrl: string;
  readonly initialConnectionToken: string;
  readonly onMessage: (envelope: RealtimeEnvelope) => void;
}

export interface LiveConnection {
  readonly status: ConnectionStatus;
  send: (action: string, payload?: Record<string, unknown>) => void;
}

/**
 * Cliente WebSocket do painel — implementa o contrato documentado em
 * docs/fase-1-arquitetura.md, seção 10.8/10.9 (heartbeat, retomada de estado via
 * `sync.resume`, reconexão preventiva com jitter antes do teto de 2h do API
 * Gateway). "Contrato do cliente, não código deste repositório" até a Fase 8 — esta
 * é a primeira implementação real dele.
 *
 * Reconexão preventiva: pede um ticket NOVO (`/api/panel/lives/{liveId}/realtime/ticket`
 * — nunca `/join` de novo, ver seção 10.9 sobre por que isso evitaria gastar a cota
 * fixa de `CreateParticipantToken`) e abre a conexão NOVA antes de fechar a velha —
 * evita qualquer janela sem WebSocket.
 */
export function useLiveConnection(options: UseLiveConnectionOptions): LiveConnection {
  const { liveId, websocketUrl, initialConnectionToken, onMessage } = options;
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const socketRef = useRef<WebSocket | null>(null);
  const lastEventTimestampRef = useRef<string | undefined>(undefined);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const openSocket = useCallback(
    (connectionToken: string, isReconnect: boolean): WebSocket => {
      const socket = new WebSocket(`${websocketUrl}?ticket=${encodeURIComponent(connectionToken)}`);

      socket.addEventListener('open', () => {
        setStatus('open');
        if (isReconnect) {
          socket.send(
            JSON.stringify({
              action: 'sync.resume',
              since: lastEventTimestampRef.current,
            }),
          );
        }
      });

      socket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as RealtimeEnvelope;
          lastEventTimestampRef.current = envelope.timestamp;
          onMessageRef.current(envelope);
        } catch {
          // Mensagem que não é um envelope JSON válido (ex.: eco de erro do API
          // Gateway) — ignorada, não derruba a conexão.
        }
      });

      return socket;
    },
    [websocketUrl],
  );

  const send = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    socketRef.current?.send(JSON.stringify({ action, ...payload }));
  }, []);

  useEffect(() => {
    if (!initialConnectionToken) {
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function scheduleReconnect(): void {
      reconnectTimeout = setTimeout(() => {
        void reconnect();
      }, randomReconnectDelayMs());
    }

    async function reconnect(): Promise<void> {
      if (cancelled) return;
      setStatus('reconnecting');

      const response = await fetch(`/api/panel/lives/${liveId}/realtime/ticket`, {
        method: 'POST',
      });
      if (!response.ok || cancelled) {
        // Sem ticket novo, não há como reconectar preventivamente — a conexão
        // velha ainda está de pé (o corte do API Gateway só acontece às 2h) e vai
        // tentar de novo no próximo heartbeat/erro. Não force um retry agressivo
        // aqui: seria o mesmo pico que a Fase 5/9 já mitigou.
        return;
      }
      const body = (await response.json()) as { data: { connectionToken: string } };

      const oldSocket = socketRef.current;
      const newSocket = openSocket(body.data.connectionToken, true);
      newSocket.addEventListener(
        'open',
        () => {
          oldSocket?.close();
        },
        { once: true },
      );
      socketRef.current = newSocket;
      scheduleReconnect();
    }

    // Limite inferior do primeiro `sync.resume`: sem isso, uma reconexão antes de
    // qualquer evento enviaria `since` ausente e seria rejeitada pelo handler.
    lastEventTimestampRef.current ??= new Date().toISOString();
    const initialSocket = openSocket(initialConnectionToken, false);
    socketRef.current = initialSocket;
    scheduleReconnect();

    const heartbeatInterval = setInterval(() => {
      socketRef.current?.send(JSON.stringify({ action: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeatInterval);
      clearTimeout(reconnectTimeout);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [initialConnectionToken, liveId, openSocket]);

  return { status, send };
}
