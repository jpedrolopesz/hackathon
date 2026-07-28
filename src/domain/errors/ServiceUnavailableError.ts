import { DomainError } from './DomainError';

/**
 * Upstream (ex.: IVS Real-Time) recusou a chamada por throttling — as cotas de taxa
 * da API do IVS são fixas e não ajustáveis (5-50 TPS conforme a ação). Isso não é uma
 * falha real: o cliente deve tentar de novo em breve, nunca vira 500, e nunca deve
 * levar uma live para FAILED. Ver docs/fase-1-arquitetura.md, seção 6/9.
 */
export class ServiceUnavailableError extends DomainError {
  constructor(publicMessage: string, code = 'SERVICE_UNAVAILABLE', internalMessage?: string) {
    super(publicMessage, code, internalMessage);
  }
}
