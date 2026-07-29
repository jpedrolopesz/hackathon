import 'server-only';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({});
const cachedSecrets = new Map<string, string>();

/**
 * O secret do client confidencial do painel nunca é gerado nem lido pelo CDK — fica
 * só no próprio Cognito. Buscado uma vez por runtime via `DescribeUserPoolClient`
 * (única forma de obtê-lo sem colocá-lo em CloudFormation/env var em texto claro) e
 * cacheado em memória do processo, mesmo padrão de `getCachedSecret`/
 * `CloudFrontSigningService`.
 */
export async function getPanelClientSecret(userPoolId: string, clientId: string): Promise<string> {
  const cacheKey = `${userPoolId}:${clientId}`;
  const cachedSecret = cachedSecrets.get(cacheKey);
  if (cachedSecret !== undefined) {
    return cachedSecret;
  }

  const result = await client.send(
    new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }),
  );
  const secret = result.UserPoolClient?.ClientSecret;
  if (!secret) {
    throw new Error(`Cognito client ${clientId} has no ClientSecret.`);
  }

  cachedSecrets.set(cacheKey, secret);
  return secret;
}
