export interface SignPlaybackCookiesInput {
  /**
   * Padrão de recurso do CloudFront, com wildcard — ex.
   * `https://dominio/{s3Prefix}/*`. NUNCA o domínio inteiro: um HLS é um manifesto
   * `.m3u8` mais N segmentos (`.ts`/`.m4s`) em URLs distintas dentro do mesmo
   * prefixo; uma política restrita a esse prefixo autoriza exatamente essa gravação,
   * nunca outra.
   */
  readonly resourceUrlPattern: string;
  readonly expiresAt: Date;
}

export interface SignedPlaybackCookies {
  readonly policy: string;
  readonly signature: string;
  readonly keyPairId: string;
}

/**
 * Cookies assinados de CloudFront (custom policy, `Resource` com wildcard) para
 * playback privado de HLS — seção 7 do README. Uma URL assinada única NÃO funciona
 * aqui: autoriza só o objeto exato (o manifesto), nunca os segmentos que o player
 * busca em seguida via URLs próprias.
 */
export interface CloudFrontSigningServicePort {
  signCookiesForPrefix(input: SignPlaybackCookiesInput): Promise<SignedPlaybackCookies>;
}
