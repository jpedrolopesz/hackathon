import * as DynamoDbLocal from 'dynamodb-local';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

/**
 * `DynamoDbLocal.launch` resolve antes da JVM aceitar conexões — sem o poll aqui, o
 * primeiro comando real falha por corrida (confirmado empiricamente: um `setTimeout`
 * fixo de alguns segundos não é suficiente e não é confiável entre máquinas).
 */
export async function launchDynamoDbLocal(port: number): Promise<DynamoDBClient> {
  await DynamoDbLocal.launch(port, null, [], false, false);

  const client = new DynamoDBClient({
    endpoint: `http://localhost:${port}`,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await client.send(new ListTablesCommand({}));
      return client;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error(`DynamoDB Local não respondeu na porta ${port}: ${String(lastError)}`);
}

export function stopDynamoDbLocal(port: number): void {
  DynamoDbLocal.stop(port);
}
