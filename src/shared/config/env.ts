import 'server-only';
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  // Origem pública canônica do painel. Em CloudFront -> API Gateway, `request.url`
  // contém o hostname do origin (`execute-api`), não o domínio visto pelo navegador;
  // OAuth precisa reutilizar exatamente a callback cadastrada no Cognito.
  APP_PUBLIC_ORIGIN: z.string().url().optional(),

  AWS_REGION: z.string().min(1),

  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  // Emissor real dos tokens (formato fixo da AWS) — usado por `aws-jwt-verify` para
  // validar assinatura/expiração de id_token/access_token antes de confiar em
  // qualquer claim (nunca decodifica sem verificar).
  COGNITO_ISSUER_URL: z.string().url(),
  // Domínio do Hosted UI (`https://{prefix}.auth.{region}.amazoncognito.com`) — para
  // onde o painel redireciona no login (seção 13 do README, fluxo de autenticação).
  COGNITO_HOSTED_UI_DOMAIN: z.string().url(),
  // ARN do Secrets Manager que guarda a chave de assinatura/criptografia do cookie de
  // sessão do painel — nunca a chave em si (mesma filosofia da chave privada do
  // CloudFront: gerada pelo próprio Secrets Manager no deploy, nunca aparece em texto
  // claro no CloudFormation nem é lida em build time).
  SESSION_SECRET_ARN: z
    .string()
    .regex(/^arn:aws:secretsmanager:/, 'deve ser um ARN do Secrets Manager'),

  // Tabela única (single-table design) — decisão justificada em docs/fase-1-arquitetura.md.
  DYNAMODB_TABLE_NAME: z.string().min(1),

  S3_RECORDINGS_BUCKET_NAME: z.string().min(1),

  // Sem CLOUDFRONT_DOMAIN_NAME: o domínio de playback é o mesmo domínio da própria
  // distribuição que serve esta Lambda (media/* — ver infrastructure/stacks/
  // api-stack.ts), então é lido do `Host` de cada requisição, não de env var — uma
  // env var fixa aqui criaria uma dependência circular no CloudFormation (Lambda ->
  // Distribution -> HttpApi -> Lambda). Ver `GetRecordingPlaybackInput.appDomainName`.
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
  // URL wss:// que o NAVEGADOR usa para abrir a conexão — diferente de
  // WEBSOCKET_API_ENDPOINT (o endpoint HTTPS de management API, usado só
  // server-side para PostToConnection). Passada ao cliente via prop de Server
  // Component (nunca NEXT_PUBLIC_*: essas variáveis são embutidas no bundle em
  // BUILD time, antes do `cdk deploy` existir — não serviriam para um valor só
  // conhecido depois do deploy).
  WEBSOCKET_CLIENT_URL: z.string().min(1),

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

  // Teto por ambiente. A emissão real usa duração agendada da aula + 30min,
  // limitada por este valor e pelo máximo absoluto do IVS.
  IVS_PARTICIPANT_TOKEN_MAX_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(20_160)
    .default(720),

  // Teto absoluto do cookie assinado de playback (GetRecordingPlaybackUseCase, Fase
  // 7) — a validade real é `duração da gravação + margem`, nunca passa disto (ver
  // docs/fase-1-arquitetura.md, seção 13). Default de 6h cobre qualquer aula real
  // com folga generosa.
  PLAYBACK_COOKIE_MAX_TTL_MINUTES: z.coerce.number().int().positive().default(360),
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
