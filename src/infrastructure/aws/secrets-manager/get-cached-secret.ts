import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
const cache = new Map<string, string>();

/**
 * Busca o valor de um secret uma única vez por runtime e cacheia em memória do
 * processo (mesmo padrão de `CloudFrontSigningService.getPrivateKey` — reaproveita
 * entre invocações do mesmo runtime, sem round-trip a cada requisição).
 */
export async function getCachedSecret(secretArn: string): Promise<string> {
  const cached = cache.get(secretArn);
  if (cached !== undefined) {
    return cached;
  }

  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) {
    throw new Error(`Secret ${secretArn} has no SecretString.`);
  }

  cache.set(secretArn, result.SecretString);
  return result.SecretString;
}
