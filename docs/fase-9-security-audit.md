# Auditoria de segurança e observabilidade — Fase 9

## Segurança (seção 14)

| Controle | Estado | Evidência / pendência |
|---|---|---|
| Menor privilégio IAM | Implementado | Policies por função e recurso; IVS condicionado à tag `Environment`. `DescribeUserPoolClient` só pode ser escopado ao user pool pela própria IAM da AWS, não ao app client. |
| S3 privado, criptografia e HTTPS | Implementado | Block Public Access, SSE-S3, `enforceSSL` e CloudFront com OAC. DynamoDB e Secrets Manager usam criptografia gerenciada. |
| Tokens temporários e segredos | Implementado | Cognito/IVS/ticket têm TTL; segredos ficam no Secrets Manager/SSM. Tokens não entram em logs nem no cache de idempotência. |
| Validação e autorização | Implementado | Zod/validação de DTO, contexto autenticado e checagens por papel, instituição, curso e turma nos casos de uso. |
| Rate limit e throttling | Implementado | WebSocket por rota/usuário e HTTP API com limites por ambiente; métricas detalhadas habilitadas. |
| Replay | Implementado | Mutações acumulativas exigem `Idempotency-Key` com claim atômico e TTL de 24h. `/join`, refresh e ticket não usam cache por serem emissão de credencial. |
| Auditoria administrativa | Parcial | Logs JSON registram rota, método, status, request/correlation ID e código de erro. Falta trilha imutável dedicada com ator, alvo e before/after para toda ação ADMIN. |
| CORS e headers | Implementado | Origins exatas por ambiente; CSP, HSTS, nosniff, frame deny, referrer e permissions policy. |
| Enumeração e exclusão | Parcial | Respostas externas usam códigos estáveis sem revelar existência fora do tenant; remoções de domínio existem. Falta workflow formal de direito ao apagamento e inventário de backups/retention. |
| Retenção | Implementado | TTL de chat e lifecycle de gravações por ambiente. |

## Topologia de contas

Hoje a aplicação aceita `--context env=development|staging|production` e cria
recursos, nomes, tags, retenção, limites e policies separados. Ela pode ser implantada
três vezes na mesma conta ou em contas distintas; o CDK usa a conta/região das
credenciais e não contém IDs fixos.

Isso fornece segregação lógica, mas **não obriga segregação de conta**. Para atender
ao controle com isolamento forte, a recomendação é uma conta AWS por ambiente
(idealmente numa Organization), com:

1. mapeamento explícito ambiente → account ID no pipeline;
2. role de deploy distinta por conta e aprovação manual para produção;
3. SCPs que bloqueiem acesso cruzado e deploy de `production` fora da conta prevista;
4. centralização apenas de logs/auditoria, por roles de leitura;
5. teste de synth/deploy que rejeite divergência entre `env` e conta.

Esses guardrails organizacionais/pipeline ainda não estão implementados neste
repositório; tags e conditions não substituem uma fronteira de conta.

## Observabilidade (seção 15)

As APIs emitem logs JSON com correlation ID e métricas EMF para lives iniciadas e
encerradas, participantes/tokens, apresentadores, chat, falhas e throttling do IVS,
falhas de gravação e 4xx/5xx. Lambda e DynamoDB fornecem duração/throttling nativos.
API Gateway tem métricas detalhadas; há alarmes para erros/throttles da Lambda,
throttling do DynamoDB, consumidor EventBridge e mensagens na DLQ. O EventBridge
consumer possui DLQ.

O X-Ray está ativo nas Lambdas; gravações emitem duração de processamento e
aberturas/fechamentos WebSocket têm métricas próprias. Pendências explícitas: gauge
reconciliado de conexões WebSocket ativas e destinos de notificação
dos alarmes. Esses itens dependem de uma
decisão operacional sobre conta de observabilidade e canal de plantão.
