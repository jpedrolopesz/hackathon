import 'server-only';

/**
 * Retorna uma URL absoluta na origem pública canônica do painel.
 *
 * CloudFront remove o `Host` do viewer antes de chamar o API Gateway, portanto
 * `request.url` aponta para `execute-api` no ambiente AWS. A origem configurada pelo
 * CDK é preferida e não depende de headers fornecidos pelo cliente; o fallback mantém
 * desenvolvimento local e testes simples funcionando.
 */
export function publicRequestUrl(
  pathname: string,
  request: Request,
  configuredOrigin?: string,
): URL {
  return new URL(pathname, configuredOrigin ?? new URL(request.url).origin);
}
