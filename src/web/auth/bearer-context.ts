import 'server-only';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { UnauthorizedError } from '@/domain/errors/UnauthorizedError';
import type { AuthenticatedRequestContext } from '@/application/authorization/AuthenticatedRequestContext';
import { useCases } from '@/web/container';
import { getEnv } from '@/shared/config/env';

/**
 * Verificação DENTRO da rota (defesa em profundidade) — não confia só no JWT
 * authorizer do API Gateway (`infrastructure/stacks/api-stack.ts`, rota
 * `/api/v1/{proxy+}`): mesmo que a Lambda seja invocada de outra forma (teste,
 * warm start reaproveitado, etc.), esta rota nunca confia em claim nenhum sem
 * validar assinatura/expiração primeiro.
 *
 * `tokenUse: 'access'` — o `access_token`, não o `id_token`: é o token que
 * autoriza CHAMADAS de API (o `id_token` é sobre IDENTIDADE para o próprio
 * cliente, seção OIDC). `clientId: null` aceita tokens do painel OU do futuro
 * app iOS (dois client ids diferentes no mesmo user pool) — a autorização real
 * de qualquer forma vem do UserProfile, nunca do client id do token.
 */
// Construído sob demanda (nunca no topo do módulo): o Next.js importa/avalia
// módulos de rota em BUILD TIME para "coletar dados da página", antes de
// `getEnv()` ter qualquer variável real (só existem em runtime na Lambda) — ver
// mesma nota em `src/web/container.ts`.
let cachedVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (!cachedVerifier) {
    cachedVerifier = CognitoJwtVerifier.create({
      userPoolId: getEnv().COGNITO_USER_POOL_ID,
      tokenUse: 'access',
      clientId: null,
    });
  }
  return cachedVerifier;
}

export async function resolveContextFromBearerToken(
  request: Request,
): Promise<AuthenticatedRequestContext> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  if (!token) {
    throw new UnauthorizedError('Token de acesso ausente.', 'UNAUTHORIZED');
  }

  let sub: string;
  try {
    const payload = await getVerifier().verify(token);
    sub = payload.sub;
  } catch {
    throw new UnauthorizedError('Token de acesso inválido ou expirado.', 'UNAUTHORIZED');
  }

  const profile = await useCases.getUserProfileBySub.execute(sub);
  if (!profile) {
    throw new UnauthorizedError('Sessão não está pronta (perfil não provisionado).', 'UNAUTHORIZED');
  }

  return { userId: profile.userId, institutionId: profile.institutionId, role: profile.role };
}
