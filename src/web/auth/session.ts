import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { getCachedSecret } from '@/infrastructure/aws/secrets-manager/get-cached-secret';
import { getEnv } from '@/shared/config/env';

export const SESSION_COOKIE_NAME = 'session';

export interface SessionPayload {
  /** `sub` do Cognito — chave de `UserProfile` (userId). */
  readonly sub: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch (segundos) de expiração do `accessToken` — usado para saber quando
   * renovar antes de repassar como Bearer para `/api/v1/*` (ver proxy.ts). */
  readonly accessTokenExpiresAt: number;
}

/**
 * `EncryptJWT` (JWE, `dir`/`A256GCM`) — não só assinado (`SignJWT`/JWS), porque o
 * payload carrega o `refreshToken` do Cognito, um credential real. `httpOnly` +
 * `Secure` já impedem leitura via JS/rede, mas criptografar o CONTEÚDO é defesa em
 * profundidade (ex.: um log ou backup que capture o valor do cookie não expõe nada
 * legível). Chave derivada do secret do Secrets Manager via SHA-256 (sempre 32
 * bytes, o que `A256GCM` exige) — o secret em si (gerado pelo próprio Secrets
 * Manager, 64 chars) não tem tamanho fixo garantido.
 */
async function getEncryptionKey(): Promise<Uint8Array> {
  const secret = await getCachedSecret(getEnv().SESSION_SECRET_ARN);
  return createHash('sha256').update(secret).digest();
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  const key = await getEncryptionKey();
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .encrypt(key);
}

export async function decryptSession(token: string): Promise<SessionPayload | null> {
  try {
    const key = await getEncryptionKey();
    const { payload } = await jwtDecrypt(token, key);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!value) {
    return null;
  }
  return decryptSession(value);
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await encryptSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
