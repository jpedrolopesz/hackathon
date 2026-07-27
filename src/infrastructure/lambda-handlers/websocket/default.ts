import type { APIGatewayProxyResultV2 } from 'aws-lambda';

// Fase 6 implementa: rotear pelas rotas do envelope (live.join, chat.send, poll.vote,
// etc. — seção 8 do README) e fazer broadcast via API Gateway Management API.
// Por enquanto só garante que a rota $default seja implantável.
export async function handler(): Promise<APIGatewayProxyResultV2> {
  return { statusCode: 200 };
}
