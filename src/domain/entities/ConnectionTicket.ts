/**
 * Chave: PK=CONNTICKET#{ticket}, SK=CONNTICKET. Uso único, vida curta — emitido por
 * `JoinLiveUseCase` (seção 11 do README, campo `realtime.connectionToken`) e
 * consumido pelo Lambda authorizer do `$connect` (docs/fase-1-arquitetura.md, seção
 * 10.1). Nunca o access token do Cognito: esse não pode ir na URL do WebSocket (a
 * seção 14 do README proíbe token em log, e a query string do `$connect` cai em logs
 * de execução do API Gateway).
 */
export interface ConnectionTicket {
  readonly ticket: string;
  readonly liveId: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}
