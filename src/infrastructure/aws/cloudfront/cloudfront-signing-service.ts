import 'server-only';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
import type {
  CloudFrontSigningServicePort,
  SignPlaybackUrlInput,
} from '@/application/ports/CloudFrontSigningServicePort';

/**
 * A chave privada PEM nunca é gerada nem lida pelo CDK (ver
 * `infrastructure/stacks/storage-stack.ts`) — só o ARN do Secret é conhecido em
 * build time. Em runtime, a Lambda/servidor busca o valor uma vez e cacheia em
 * memória do processo (mesmo padrão de `getDocumentClient` — reaproveita entre
 * invocações do mesmo runtime, sem round-trip a cada assinatura).
 */
export class CloudFrontSigningService implements CloudFrontSigningServicePort {
  private readonly secretsClient: SecretsManagerClient;
  private cachedPrivateKey: string | undefined;

  constructor(
    private readonly keyPairId: string,
    private readonly privateKeySecretArn: string,
  ) {
    this.secretsClient = new SecretsManagerClient({});
  }

  async signUrl(input: SignPlaybackUrlInput): Promise<string> {
    const privateKey = await this.getPrivateKey();
    return getSignedUrl({
      url: input.url,
      keyPairId: this.keyPairId,
      privateKey,
      dateLessThan: input.expiresAt.toISOString(),
    });
  }

  private async getPrivateKey(): Promise<string> {
    if (this.cachedPrivateKey === undefined) {
      const result = await this.secretsClient.send(
        new GetSecretValueCommand({ SecretId: this.privateKeySecretArn }),
      );
      if (!result.SecretString) {
        throw new Error('CloudFront signing secret has no SecretString.');
      }
      this.cachedPrivateKey = result.SecretString;
    }
    return this.cachedPrivateKey;
  }
}
