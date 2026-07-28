/**
 * Valores iniciais, ajustáveis — não são exigência do README (docs/fase-1-
 * arquitetura.md, seção 10.4). Cada ação tem seu próprio orçamento de rate limit (chave
 * do `RateLimiter` prefixada por ação) para que votar não consuma a cota de enviar
 * mensagens de chat, por exemplo. Reação não está aqui: seu limite é no próprio API
 * Gateway WebSocket (rota `reaction.send`), não em DynamoDB — ver
 * `send-reaction.ts` e `infrastructure/stacks/api-stack.ts`.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;
export const QUESTION_MAX_LENGTH = 1000;
export const POLL_QUESTION_MAX_LENGTH = 500;
export const POLL_OPTION_MAX_LENGTH = 200;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 8;
export const REACTION_MAX_LENGTH = 8;

export const CHAT_RATE_LIMIT = { limit: 5, windowSeconds: 10 } as const;
export const QUESTION_RATE_LIMIT = { limit: 3, windowSeconds: 30 } as const;
export const POLL_VOTE_RATE_LIMIT = { limit: 10, windowSeconds: 10 } as const;

/**
 * Vida do `connectionToken` (docs/fase-1-arquitetura.md, seção 10.1) — uso único,
 * curto o bastante para que um vazamento acidental (log, histórico do navegador)
 * já esteja expirado quando alguém tentar reusá-lo.
 */
export const CONNECTION_TICKET_TTL_SECONDS = 60;
