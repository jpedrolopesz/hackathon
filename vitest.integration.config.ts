import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Testes de integração contra DynamoDB Local — exigem Java (a lib `dynamodb-local`
// baixa e sobe o DynamoDBLocal.jar sob demanda). Separados do `npm test` padrão de
// propósito: não devem tornar o loop de desenvolvimento dependente de Java, nem
// tornar o `npm test` lento/flaky em ambientes sem Java disponível.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  ssr: { resolve: { conditions: ['react-server'] } },
});
