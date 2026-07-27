export type ParticipantRole = 'ADMIN' | 'PROFESSOR' | 'ALUNO';

export type IvsCapability = 'PUBLISH' | 'SUBSCRIBE';

/**
 * Identidade usada para construir o payload do CreateParticipantToken.
 *
 * `liveParticipantId` é o UUID do registro `LiveParticipant` no DynamoDB — um
 * identificador opaco cunhado pelo nosso backend, sem relação criptográfica ou
 * previsível com o `sub` do Cognito. O mapeamento opaco -> usuário real (sub,
 * institutionId, e-mail, nome, matrícula) só existe no DynamoDB, do lado do servidor;
 * nunca é enviado ao IVS.
 */
export interface ParticipantTokenIdentity {
  readonly liveParticipantId: string;
  readonly role: ParticipantRole;
}

// Limite documentado por CreateParticipantToken: "The maximum length of this field is
// 1 KB total. This field is exposed to all stage participants and should not be used
// for personally identifying, confidential, or sensitive information." O mesmo aviso
// vale para `userId`.
const MAX_ATTRIBUTES_BYTES = 1024;

const FORBIDDEN_ATTRIBUTE_KEYS = new Set([
  'sub',
  'cognitosub',
  'email',
  'name',
  'fullname',
  'institutionid',
  'matricula',
  'registrationnumber',
  'studentid',
  'phone',
  'phonenumber',
]);

const EMAIL_LIKE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JWT_LIKE_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function buildParticipantTokenAttributes(
  identity: ParticipantTokenIdentity,
): Record<string, string> {
  return {
    liveParticipantId: identity.liveParticipantId,
    role: identity.role,
  };
}

/**
 * `userId` é só "texto de apoio para identificar o token" (não é o `sub` do Cognito).
 * Aqui ele é sempre o mesmo id opaco usado em `attributes.liveParticipantId` —
 * nunca validamos o FORMATO de `userId` para distinguir "opaco" de "real", porque um
 * UUID opaco e um `sub` do Cognito têm exatamente a mesma forma por design (essa é a
 * ideia de um identificador opaco). A garantia vem do call site: este é o único ponto
 * que deveria produzir o valor de `userId` de um CreateParticipantToken.
 */
export function buildParticipantTokenUserId(identity: ParticipantTokenIdentity): string {
  return identity.liveParticipantId;
}

export interface ParticipantTokenPayload {
  readonly userId?: string;
  readonly attributes?: Record<string, string>;
}

/**
 * Falha cedo se qualquer identificador real acabar no payload que vai para o IVS —
 * `attributes` e `userId` são expostos a TODOS os participantes do stage. Verifica:
 * 1. Nenhuma chave de `attributes` bate com um campo sensível conhecido;
 * 2. Nenhum valor de `attributes` parece um e-mail ou um token JWT;
 * 3. `attributes` não excede 1 KB (limite documentado do CreateParticipantToken).
 */
export function assertNoSensitiveTokenFields(payload: ParticipantTokenPayload): void {
  const attributes = payload.attributes ?? {};

  for (const [key, value] of Object.entries(attributes)) {
    if (FORBIDDEN_ATTRIBUTE_KEYS.has(key.toLowerCase())) {
      throw new Error(`Campo sensível "${key}" não pode ir em attributes do token IVS.`);
    }

    if (EMAIL_LIKE_PATTERN.test(value)) {
      throw new Error(`Valor de "${key}" em attributes do token IVS parece ser um e-mail.`);
    }

    if (JWT_LIKE_PATTERN.test(value)) {
      throw new Error(`Valor de "${key}" em attributes do token IVS parece ser um JWT.`);
    }
  }

  const attributesSize = Buffer.byteLength(JSON.stringify(attributes), 'utf-8');
  if (attributesSize > MAX_ATTRIBUTES_BYTES) {
    throw new Error(
      `attributes do token IVS excede o limite de ${MAX_ATTRIBUTES_BYTES} bytes: ${attributesSize} bytes.`,
    );
  }
}

/**
 * `capabilities` aceita 0 a 2 itens segundo a API, mas se omitido o default
 * documentado é PUBLISH+SUBSCRIBE — omitir o campo dá permissão de publicar a
 * qualquer participante, inclusive um aluno comum. Por isso a regra de negócio desta
 * plataforma é mais estrita que a da API: `capabilities` deve sempre ser passado
 * explicitamente, ter 1 ou 2 itens, sem duplicatas, e sempre incluir SUBSCRIBE (todo
 * participante de uma aula pode ao menos assistir — seção 6 do README).
 */
export function assertValidCapabilities(capabilities: readonly IvsCapability[]): void {
  if (capabilities.length < 1 || capabilities.length > 2) {
    throw new Error('capabilities deve ter 1 ou 2 itens.');
  }

  if (new Set(capabilities).size !== capabilities.length) {
    throw new Error('capabilities não pode ter duplicatas.');
  }

  if (!capabilities.includes('SUBSCRIBE')) {
    throw new Error('capabilities deve sempre incluir SUBSCRIBE.');
  }
}

export const IVS_TOKEN_CAPABILITIES_BY_ROLE = {
  SUBSCRIBER_ONLY: ['SUBSCRIBE'],
  PRESENTER: ['PUBLISH', 'SUBSCRIBE'],
} as const satisfies Record<string, readonly IvsCapability[]>;

// Confirmado em CreateParticipantToken (RealTimeAPIReference): duration em minutos,
// mínimo 1, máximo 20160 (14 dias), default 720 (12h).
export const IVS_TOKEN_DURATION_MINUTES = {
  MIN: 1,
  MAX: 20160,
  DEFAULT: 720,
} as const;

export function assertValidDurationMinutes(duration: number): void {
  if (
    !Number.isInteger(duration) ||
    duration < IVS_TOKEN_DURATION_MINUTES.MIN ||
    duration > IVS_TOKEN_DURATION_MINUTES.MAX
  ) {
    throw new Error(
      `duration deve ser um inteiro entre ${IVS_TOKEN_DURATION_MINUTES.MIN} e ${IVS_TOKEN_DURATION_MINUTES.MAX} minutos.`,
    );
  }
}
