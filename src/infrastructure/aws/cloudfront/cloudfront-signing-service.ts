import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import type {
  CloudFrontSigningServicePort,
  SignedPlaybackCookies,
  SignPlaybackCookiesInput,
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

  async signCookiesForPrefix(input: SignPlaybackCookiesInput): Promise<SignedPlaybackCookies> {
    const privateKey = await this.getPrivateKey();
    // Custom policy com `Resource` em wildcard — é isso que autoriza o manifesto E
    // todos os segmentos do prefixo da gravação numa única assinatura. O helper do
    // SDK só monta policy "canned" (uma URL exata, sem wildcard) quando se passa
    // `dateLessThan`; para wildcard, a policy tem que ser montada à mão e passada
    // como `policy`.
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: input.resourceUrlPattern,
          Condition: {
            DateLessThan: { 'AWS:EpochTime': Math.floor(input.expiresAt.getTime() / 1000) },
          },
        },
      ],
    });

    const signed = getSignedCookies({ policy, keyPairId: this.keyPairId, privateKey });
    // `CloudFront-Policy` só é opcional no tipo por causa da variante "canned"
    // (dateLessThan sem policy customizada) — como sempre chamamos com `policy`
    // acima, o SDK sempre devolve os três campos.
    if (!signed['CloudFront-Policy']) {
      throw new Error('getSignedCookies did not return CloudFront-Policy for a custom policy.');
    }
    return {
      policy: signed['CloudFront-Policy'],
      signature: signed['CloudFront-Signature'],
      keyPairId: signed['CloudFront-Key-Pair-Id'],
    };
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
