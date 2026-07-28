/** Padrão de acesso #14 (docs/fase-1-arquitetura.md, seção 10.4). */
export interface RateLimiter {
  /** true = ação permitida (já contabilizada); false = limite excedido nesta janela. */
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
