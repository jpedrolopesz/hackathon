import type { APIGatewayProxyResultV2 } from 'aws-lambda';

// Fase 6 implementa: autenticar a conexão e associar connectionId/usuário/live no
// DynamoDB (PK=LIVE#{liveId}, SK=CONNECTION#{connectionId}, ver docs/fase-1-arquitetura.md).
// Por enquanto só garante que a rota $connect seja implantável.
export async function handler(): Promise<APIGatewayProxyResultV2> {
  return { statusCode: 200 };
}
