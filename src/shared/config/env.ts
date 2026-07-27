import 'server-only';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),

  AWS_REGION: z.string().min(1),

  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),

  // Tabela única (single-table design) — decisão justificada em docs/fase-1-arquitetura.md.
  DYNAMODB_TABLE_NAME: z.string().min(1),

  S3_RECORDINGS_BUCKET_NAME: z.string().min(1),

  CLOUDFRONT_DOMAIN_NAME: z.string().min(1),
  CLOUDFRONT_KEY_PAIR_ID: z.string().min(1),
  // Nunca a chave privada em si — apenas o ARN do segredo no Secrets Manager,
  // lido em runtime pelo serviço que assina as URLs do CloudFront.
  CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: z
    .string()
    .regex(/^arn:aws:secretsmanager:/, 'deve ser um ARN do Secrets Manager'),

  EVENTBRIDGE_BUS_NAME: z.string().min(1),

  // Endpoint de gerenciamento usado pela Lambda para enviar mensagens aos
  // clientes conectados via API Gateway Management API.
  WEBSOCKET_API_ENDPOINT: z.string().min(1),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ALLOWED_ORIGINS: z.string().min(1),

  // Só a Lambda consumidora de EventBridge (Fase 7) precisa destes dois — por isso são
  // opcionais aqui. Este schema hoje reflete o footprint de env do server function
  // Next.js; as Lambdas de WebSocket/EventBridge têm um footprint bem menor (só
  // DYNAMODB_TABLE_NAME, ver infrastructure/stacks/api-stack.ts e event-bus-stack.ts) —
  // elas ainda não chamam getEnv(), então isso não quebra nada hoje, mas antes de
  // implementar a Fase 6/7 dentro delas, considere um schema próprio e mais estrito
  // por superfície em vez de reusar este.
  IVS_ENCODER_CONFIGURATION_ARN: z.string().optional(),
  IVS_STORAGE_CONFIGURATION_ARN: z.string().optional(),

  // Número de shards da partição de chat (PK=LIVE#{liveId}#{shard}) — só as Lambdas
  // que leem/escrevem chat usam isso; default 1 (sem sharding) para as demais.
  CHAT_SHARD_COUNT: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Lazy e memoizado: importar este módulo não deve falhar em contextos onde
 * as variáveis ainda não existem (build, lint, testes de outros módulos).
 * A validação só acontece quando o ambiente é efetivamente lido.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(`Variáveis de ambiente inválidas: ${issues}`);
    }

    cachedEnv = parsed.data;
  }

  return cachedEnv;
}
