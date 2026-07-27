import { Stack } from 'aws-cdk-lib';
import * as ivs from 'aws-cdk-lib/aws-ivs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { PlatformStackProps } from '../lib/config';

export interface IvsStackProps extends PlatformStackProps {
  readonly recordingsBucket: s3.IBucket;
}

/**
 * Pré-requisitos de IVS Real-Time para composite recording (docs/fase-1-arquitetura.md,
 * seção 5) — recursos reutilizáveis entre Stages, por isso vivem na infra e não são
 * criados por live:
 * - EncoderConfiguration: resolução/bitrate/fps do vídeo composto.
 * - StorageConfiguration: aponta para o bucket S3 de gravações.
 *
 * Nenhuma bucket policy é adicionada manualmente aqui: a documentação oficial confirma
 * que criar a StorageConfiguration já faz o IVS ajustar a policy do bucket para ter
 * permissão de escrita. Adicionar uma policy própria seria redundante e arriscaria
 * divergir do que o serviço gerencia.
 */
export class IvsStack extends Stack {
  readonly encoderConfiguration: ivs.CfnEncoderConfiguration;
  readonly storageConfiguration: ivs.CfnStorageConfiguration;

  constructor(scope: Construct, id: string, props: IvsStackProps) {
    super(scope, id, props);

    this.encoderConfiguration = new ivs.CfnEncoderConfiguration(
      this,
      'CompositeEncoderConfiguration',
      {
        name: `composite-encoder-${props.config.envName}`,
        video: {
          width: 1280,
          height: 720,
          framerate: 30,
          bitrate: 2_500_000,
        },
      },
    );

    this.storageConfiguration = new ivs.CfnStorageConfiguration(
      this,
      'CompositeStorageConfiguration',
      {
        name: `composite-storage-${props.config.envName}`,
        s3: {
          bucketName: props.recordingsBucket.bucketName,
        },
      },
    );
  }
}
