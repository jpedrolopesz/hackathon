export interface SignPlaybackUrlInput {
  readonly url: string;
  readonly expiresAt: Date;
}

/** URL/cookie assinado de CloudFront para playback privado (seção 7 do README —
 * nenhuma URL direta do S3, sempre via CloudFront com OAC). */
export interface CloudFrontSigningServicePort {
  signUrl(input: SignPlaybackUrlInput): Promise<string>;
}
