# Fase 10 — validação no ambiente AWS development

> Desenho aprovado, execução bloqueada até o dono do projeto definir a topologia de
> contas. Nenhum deploy faz parte da Fase 9.

## Ordem e evidências

1. Configurar AWS Budget e confirmar conta/região.
2. Preparar chave pública no SSM e chave privada no Secrets Manager.
3. Fazer o primeiro deploy sem `appDomain`, registrar outputs e domínio CloudFront.
4. Fazer o segundo deploy com `--context appDomain=<output>`.
5. Validar Hosted UI, callback/logout e troca de authorization code.
6. Executar o smoke professor → aluno → gravação → replay.
7. Preservar eventos IVS brutos sanitizados, correlation IDs, traces e screenshots.
8. Registrar cada divergência com esperado, obtido, ARN, horário UTC, correção e reteste.

O smoke principal cobre criação/agendamento, início e publicação do professor,
entrada e reprodução pelo aluno, lista de participantes, chat, perguntas,
moderação, enquete, promoção/rebaixamento, encerramento, processamento até `READY`
e replay no navegador. S3 direto e CloudFront sem cookie devem responder 403;
CloudFront com os três cookies deve carregar manifesto e todos os segmentos.

## Eventos e máquinas de estado

Capturar `source`, `detail-type`, `detail.event_name`, `resources`,
`detail.stage_arn` quando presente, timestamp, ARN da composição, prefixo e duração.
Conferir `WAITING → LIVE`, `STARTING → RECORDING → PROCESSING → READY`, falhas para
`FAILED`, duplicados como no-op e eventos atrasados sem regressão.

## Cenários adicionais obrigatórios

### Auto-shutdown e gravações fragmentadas

1. Com gravação ativa, derrubar deliberadamente o publisher por mais de 60 segundos.
2. Confirmar o auto-shutdown da composição e o fechamento do primeiro `Recording`.
3. Reconectar e publicar novamente.
4. Confirmar a criação de uma nova composição e de um segundo `Recording`.
5. Encerrar a aula e esperar ambos chegarem a `READY`.
6. Confirmar dois IDs/prefixos independentes no S3 e o painel agrupando-os, em ordem,
   como partes da mesma `liveId`.

### Reconexão WebSocket

1. Registrar o último timestamp recebido pelo aluno e derrubar o socket.
2. Produzir chat/perguntas durante a lacuna.
3. Obter ticket novo, reconectar e validar ping/pong.
4. Enviar `sync.resume` com o timestamp registrado.
5. Confirmar recuperação ordenada da lacuna e o valor correto de `truncated`.
6. Confirmar que múltiplas conexões/reconexões não duplicam `LiveParticipant` nem
   presença/contagem de attendance.

### Ticket de uso único

Abrir uma conexão com `connectionToken`, tentar um segundo handshake com exatamente
o mesmo token e confirmar rejeição. Um ticket novo deve conectar normalmente.

### Expulsão e reentrada

1. Professor dono remove um aluno por `DELETE /participants/{userId}`.
2. Confirmar `DisconnectParticipant`, remoção do vínculo corrente e evento
   `LIVE_PARTICIPANT_REMOVED` na auditoria.
3. Confirmar que o participantId antigo não volta ao stage.
4. O aluno chama `/join` novamente; confirmar token e participantId IVS novos.
5. Confirmar que o novo participantId entra no mesmo stage e que presença não duplica.
6. Esta operação é expulsão, nunca banimento da pessoa.

## Cotas antes de carga real

Conferir e solicitar, conforme previsão do semestre: IVS concurrent publishers
(default documentado 1.000), IVS concurrent subscriptions (20.000) e API Gateway
WebSocket new connections (500/s), todas por conta/região. Monitorar também os
limites fixos: `CreateParticipantToken` 50 TPS e operações IVS de stage/composição/
disconnect a 5 TPS.

## Teardown

Development usa `RemovalPolicy.DESTROY`; produção usa `RETAIN`. Antes de destruir:

1. exportar a tabela e copiar qualquer gravação que deva sobreviver;
2. registrar outputs/ARNs e verificar objetos/versionamento do bucket;
3. esvaziar apenas o bucket development confirmado pelo nome/tag;
4. executar `cdk destroy --all --context env=development`;
5. conferir CloudFormation, S3, Secrets Manager, SSM, Cognito, APIs, logs e alarmes;
6. apagar manualmente somente recursos comprovadamente órfãos do environment
development.

## Registro de execução — primeiro deploy development

Data: 2026-07-29 UTC. Conta `847566517340`, região `us-east-1`, instituição
`vitru`.

- `DynamoDb-development` e `Cognito-development` foram criadas na primeira
  tentativa.
- O primeiro `Api-development` falhou porque o CDK serializou os campos internos de
  `RouteSettings` como `throttlingBurstLimit`/`throttlingRateLimit`; o resource
  provider exige `ThrottlingBurstLimit`/`ThrottlingRateLimit`. Request token:
  `2267c4e7-b6cd-d97e-5c05-d7feb878972e`. Corrigido com override explícito no
  template.
- A tentativa seguinte falhou porque uma conta nova não tinha
  `cloudWatchRoleArn` regional configurado para o API Gateway. Request ID:
  `74030afa-f6ef-4bfd-af2d-ce6c931186d8`. Corrigido provisionando
  `AWS::ApiGateway::Account` e a role de entrega de logs na stack.
- A terceira tentativa falhou porque a WebSocket Stage tentou aplicar
  `RouteSettings` antes da criação da rota `reaction.send`. Request ID:
  `a5ede065-3c9d-498e-9f1e-4b453c9712dd`. Corrigido com dependência explícita da
  Stage no `AWS::ApiGatewayV2::Route`.
- As três stacks falhadas terminaram em `ROLLBACK_COMPLETE`, sem recursos
  sobreviventes, e suas cascas vazias foram removidas antes de cada nova tentativa.
- A quarta tentativa criou as cinco stacks com `CREATE_COMPLETE`. Distribuição
  `E3FGA4RU5EMDAZ`, domínio `d2tdadn4gc7c6n.cloudfront.net`, estado `Deployed`.
- A chave pública foi criada em
  `/platform/development/cloudfront/signing-public-key`. A chave privada
  correspondente foi escrita no Secret criado pela stack; somente metadados e
  fingerprints foram usados na verificação. Nenhum conteúdo secreto foi impresso.
- O CDK ainda emite avisos não bloqueantes sobre `FunctionOptions.logRetention` e
  sobre a força default `strong` das referências cross-stack.

### Segundo deploy com appDomain

- Executado com
  `appDomain=d2tdadn4gc7c6n.cloudfront.net`.
- `Cognito-development` terminou em `UPDATE_COMPLETE`; as outras quatro stacks não
  tiveram alterações.
- O panel client passou a aceitar
  `https://d2tdadn4gc7c6n.cloudfront.net/api/auth/callback` e
  `https://d2tdadn4gc7c6n.cloudfront.net/login`, preservando também as URLs de
  localhost.
- OAuth confirmado como Authorization Code, scopes `openid`, `email`, `profile` e
  identity provider `COGNITO`.
- O domínio `vitru-development-live-classes` ficou `ACTIVE`. Uma requisição sem
  credenciais ao `/oauth2/authorize`, usando o callback CloudFront, respondeu `302`
  para o fluxo de login esperado.
- Nenhum secret, token ou ticket foi incluído nas consultas ou saídas de validação.

### Correção do redirect_uri atrás do CloudFront

- Ao abrir o login pelo painel, o Cognito exibiu `An error was encountered with the
  requested page`.
- `/api/auth/login` construía a callback a partir de `request.url`. Atrás do
  CloudFront, esse valor continha o hostname interno
  `fplkjua5c0.execute-api.us-east-1.amazonaws.com`, que não correspondia à callback
  CloudFront cadastrada no app client.
- Corrigido com `APP_PUBLIC_ORIGIN`, injetado pelo CDK somente quando `appDomain`
  está definido. Login, callback e logout usam essa origem canônica; não confiam em
  `Host` ou `X-Forwarded-Host` controlável pelo cliente.
- Validação local: typecheck, lint, 496 testes, Next build e OpenNext build passaram.
- `Api-development` foi atualizado para `UPDATE_COMPLETE`. Após o deploy,
  `/api/auth/login` emitiu
  `redirect_uri=https://d2tdadn4gc7c6n.cloudfront.net/api/auth/callback` e o fluxo
  terminou na página pública de login do Cognito com HTTP 200. API Gateway request ID
  da verificação: `BPo39jGPIAMEJ3w=`.

### Bootstrap do primeiro ADMIN

- Usuário Cognito criado para `jplopeszamonelo@icloud.com`, nome
  `Administrador`, `sub=7488e4f8-e0e1-70d4-eea0-313e7a36137b`.
- Estado inicial confirmado como `FORCE_CHANGE_PASSWORD`; a senha temporária foi
  entregue pelo mecanismo de convite do Cognito e não apareceu em comandos ou logs.
- O `UserProfile` foi criado na instituição `vitru`, papel `ADMIN`, em transação
  atômica com o evento de auditoria `ADMIN_BOOTSTRAPPED`.
- Audit ID: `17824e1c-baed-45a1-aef4-de3983e2c740`; ator operacional:
  `aws-iam:jpedrolopesz`.
- Um segundo usuário, criado manualmente no Cognito com
  `jplopeszamonelo@hotmail.com`, autenticou sem possuir `UserProfile` e recebeu a
  mensagem de perfil ausente. O perfil `ADMIN`/`vitru` foi criado depois para
  `sub=8418a4b8-80e1-70df-fd8c-3f5910e04afd`, sem alterar o ADMIN iCloud.
  Audit ID: `5ab70c14-81bf-4ade-9fa8-4f3bf0b066fb`.

No development atual, tabela, buckets e secrets são configurados para destruição
(buckets com `autoDeleteObjects`); portanto podem ser apagados pelo destroy. Em
production, tabela/buckets/secrets protegidos por `RETAIN` sobrevivem e aparecem
como recursos órfãos deliberados após remoção da stack. Nunca executar teardown de
production como atalho para limpar development, e nunca apagar acervo sem exportação
e autorização explícita.
