import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import seedPayload from '../seeds/estatistica-i.json';
import { loadGraphSeed } from '@/infrastructure/seed/load-graph-seed';
import { parseGraphSeed } from '@/infrastructure/seed/graph-seed-schema';

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const institutionId = requiredEnvironmentVariable('INSTITUTION_ID');
  const tableName = requiredEnvironmentVariable('DYNAMODB_TABLE_NAME');
  const region = requiredEnvironmentVariable('AWS_REGION');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  const seed = parseGraphSeed(seedPayload);
  const result = await loadGraphSeed(client, tableName, {
    institutionId,
    seed,
  });

  console.info(`${result.itemsWritten} itens do grafo foram gravados.`);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : `Falha ao carregar seed: ${error}`,
  );
  process.exitCode = 1;
});
