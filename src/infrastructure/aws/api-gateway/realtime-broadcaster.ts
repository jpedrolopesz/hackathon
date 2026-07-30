import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { RealtimeBroadcaster, BroadcastResult } from '@/application/ports/RealtimeBroadcaster';

/**
 * `endpoint` é a URL de gerenciamento da stage (`WEBSOCKET_API_ENDPOINT`,
 * `https://{apiId}.execute-api.{region}.amazonaws.com/{stage}`) — não a URL `wss://`
 * de conexão do cliente, que é um endpoint diferente da mesma API.
 */
export class ApiGatewayRealtimeBroadcaster implements RealtimeBroadcaster {
  private readonly client: ApiGatewayManagementApiClient;

  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }

  async send(connectionId: string, payload: unknown): Promise<BroadcastResult> {
    try {
      await this.client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(payload), 'utf-8'),
        }),
      );
      return 'sent';
    } catch (error) {
      // GoneException = a conexão morreu sem passar por $disconnect (aba fechada à
      // força, rede caiu). Não é um erro operacional — é o sinal de que o item no
      // DynamoDB está obsoleto; quem chama decide se limpa (ver broadcast-to-live.ts).
      if (error instanceof GoneException) {
        return 'stale';
      }
      throw error;
    }
  }
}
