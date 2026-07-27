import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Sem isso, importar um módulo com `import 'server-only'` (ex. src/shared/config/env.ts)
  // resolve para a condição "default" do pacote, que lança um Error em vez de ser um no-op.
  ssr: { resolve: { conditions: ['react-server'] } },
});
