import type { APIGatewayProxyResultV2 } from 'aws-lambda';

// Fase 6 implementa: remover a conexão do DynamoDB via GSI2 (lookup por connectionId).
// Por enquanto só garante que a rota $disconnect seja implantável.
export async function handler(): Promise<APIGatewayProxyResultV2> {
  return { statusCode: 200 };
}
