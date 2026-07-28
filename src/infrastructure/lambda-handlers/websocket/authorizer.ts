import 'server-only';
import type {
  APIGatewayRequestAuthorizerWithContextHandler,
  PolicyDocument,
} from 'aws-lambda';
import { GetUserProfileBySubUseCase } from '@/application/use-cases/get-user-profile-by-sub';
import { getDocumentClient } from '@/infrastructure/aws/dynamodb/document-client';
import { DynamoDbConnectionTicketRepository } from '@/infrastructure/repositories/dynamodb-connection-ticket-repository';
import { DynamoDbUserProfileRepository } from '@/infrastructure/repositories/dynamodb-user-profile-repository';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida.`);
  }
  return value;
}

const tableName = requiredEnv('DYNAMODB_TABLE_NAME');
const documentClient = getDocumentClient();

const connectionTicketRepository = new DynamoDbConnectionTicketRepository(
  documentClient,
  tableName,
);
const getUserProfileBySub = new GetUserProfileBySubUseCase(
  new DynamoDbUserProfileRepository(documentClient, tableName),
);

export interface WebSocketAuthorizerContext {
  readonly userId: string;
  readonly institutionId: string;
  readonly role: string;
  readonly liveId: string;
  readonly [key: string]: string;
}

function buildAllowPolicy(methodArn: string): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: methodArn }],
  };
}

/**
 * Lambda authorizer de REQUEST na rota `$connect` (docs/fase-1-arquitetura.md, seção
 * 10.1) — único mecanismo de JWT disponível para WebSocket API.
 *
 * Revisão de segurança pós-Fase-6: o access token do Cognito NUNCA vai na URL — API
 * Gateway registra a query string em logs de execução, e a seção 14 do README proíbe
 * token em log. Em vez de reverificar um JWT aqui, `/join` (HTTP, já autenticado)
 * emite um `connectionToken` de uso único e vida curta (seção 11 do README, campo
 * `realtime.connectionToken`, ver `JoinLiveUseCase`) — é isso que a URL do WebSocket
 * carrega. Este authorizer só CONSOME o ticket, atomicamente (uma segunda tentativa
 * com o mesmo ticket é rejeitada — ver `DynamoDbConnectionTicketRepository.consume`),
 * e resolve `role`/`institutionId` do `UserProfile` a partir do `userId` gravado no
 * ticket (nunca de um claim de JWT).
 *
 * Lançar com a mensagem literal `"Unauthorized"` é a convenção documentada do API
 * Gateway para um authorizer REQUEST negar com 401 sem precisar registrar uma Gateway
 * Response customizada.
 */
export const handler: APIGatewayRequestAuthorizerWithContextHandler<
  WebSocketAuthorizerContext
> = async (event) => {
  const ticket = event.queryStringParameters?.['ticket'];
  if (!ticket) {
    throw new Error('Unauthorized');
  }

  const consumed = await connectionTicketRepository.consume(ticket);
  if (!consumed) {
    throw new Error('Unauthorized');
  }

  const profile = await getUserProfileBySub.execute(consumed.userId);
  if (!profile) {
    throw new Error('Unauthorized');
  }

  return {
    principalId: consumed.userId,
    policyDocument: buildAllowPolicy(event.methodArn),
    context: {
      userId: profile.userId,
      institutionId: profile.institutionId,
      role: profile.role,
      liveId: consumed.liveId,
    },
  };
};
