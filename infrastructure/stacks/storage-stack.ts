import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

/**
 * Bucket privado de gravações + distribuição CloudFront de playback com URLs assinadas.
 *
 * Object Ownership "Bucket owner enforced" é exigido pelo IVS Real-Time para composite
 * recording (docs/fase-1-arquitetura.md, seção 5) — não é o default do CDK, por isso
 * fica explícito aqui.
 *
 * A chave pública usada pelo CloudFront (PublicKey/KeyGroup) vem de um SSM Parameter
 * por ambiente — não é secreta, mas também não fica hardcoded: `valueForStringParameter`
 * gera uma dynamic reference resolvida pelo CloudFormation no deploy, então o
 * parâmetro pode ser criado depois deste `cdk synth`, antes do deploy real.
 * A chave PRIVADA correspondente nunca entra no CDK: fica em um Secret do Secrets
 * Manager criado vazio aqui e populado manualmente fora do CDK; a aplicação lê o ARN
 * em runtime (ver CLOUDFRONT_PRIVATE_KEY_SECRET_ARN em src/shared/config/env.ts).
 */
export class StorageStack extends Stack {
  readonly recordingsBucket: s3.Bucket;
  readonly mediaDistribution: cloudfront.Distribution;
  readonly signingPublicKey: cloudfront.PublicKey;
  readonly signingPrivateKeySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: props.config.removalPolicy,
      autoDeleteObjects: props.config.removalPolicy === RemovalPolicy.DESTROY,
    });

    const signingPublicKeyPem = ssm.StringParameter.valueForStringParameter(
      this,
      `/platform/${props.config.envName}/cloudfront/signing-public-key`,
    );

    this.signingPublicKey = new cloudfront.PublicKey(this, 'PlaybackSigningPublicKey', {
      encodedKey: signingPublicKeyPem,
    });

    const keyGroup = new cloudfront.KeyGroup(this, 'PlaybackKeyGroup', {
      items: [this.signingPublicKey],
    });

    this.mediaDistribution = new cloudfront.Distribution(this, 'MediaDistribution', {
      comment: `Playback privado de gravações (${props.config.envName})`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.recordingsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        trustedKeyGroups: [keyGroup],
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
    });

    this.signingPrivateKeySecret = new secretsmanager.Secret(this, 'CloudFrontSigningPrivateKey', {
      description:
        'Chave privada (PEM) usada para assinar URLs/cookies do CloudFront de playback. ' +
        'Populada manualmente fora do CDK; nunca gerada ou lida pelo CloudFormation.',
      removalPolicy: props.config.removalPolicy,
    });
  }
}
