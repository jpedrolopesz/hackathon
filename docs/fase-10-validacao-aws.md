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

### Dados do smoke professor/aluno

- `joao_professor@hotmail.com`: Cognito
  `sub=94b844a8-4071-7000-4366-d4a920c22f00`, perfil `PROFESSOR`/`vitru`;
  audit `3b358ce8-ba90-4be9-b662-5b91b305046d`.
- `joao_aluno@hotmail.com`: Cognito
  `sub=84983458-30e1-7077-db73-9f1ff9b7d009`, perfil `ALUNO`/`vitru`;
  audit `ff96d939-177a-4fa1-b360-e9528adf5d00`.
- Mensagens do Cognito foram suprimidas porque os endereços são identidades de
  teste. Ambos começam em `FORCE_CHANGE_PASSWORD`; credenciais temporárias não são
  registradas neste documento.
- Curso `01KYQK2GMH5MQ96V0A6NJDKXBD`, `Curso de Teste — Fase 10`.
- Turma `01KYQK2GMJG5P4X14FC6RAE5SZ`, `Turma de Teste — Fase 10`, vinculada ao
  professor. A GSI1 foi consultada e retornou a turma.
- Matrícula do aluno criada com estado `ACTIVE` e validada por leitura consistente.
- Audits da estrutura: curso `9a09330d-1fd3-413d-94d9-554a98574fd9`, turma
  `db05941a-3f7e-4ed3-8f91-39ad5e7b87ab`, matrícula
  `038fcc31-e364-4b39-afb0-4274d5f9871a`.

### Correções do primeiro uso professor/aluno

- Ao criar uma live, o Next recusou a Server Action porque `Origin` era
  `d2tdadn4gc7c6n.cloudfront.net`, mas `X-Forwarded-Host` chegava como
  `fplkjua5c0.execute-api.us-east-1.amazonaws.com`. Digest
  `1386071799@E80`; correlation ID
  `433f44b9-64ef-45e5-984f-17c1cd025042`.
- A origem do HttpApi no CloudFront passou a definir
  `X-Forwarded-Host=d2tdadn4gc7c6n.cloudfront.net`. Isso mantém a proteção CSRF
  do Next, fazendo os dois cabeçalhos representarem a mesma origem pública.
- O login de ALUNO era redirecionado para a listagem exclusiva do professor e
  falhava com `ROLE_NOT_ALLOWED`. Digest `956291345`; correlation IDs
  `139c1981-40e8-42a0-b858-e45e6a1beddc`,
  `ec1af1c4-9ad8-432c-86be-85149860795d` e
  `12a8cfdb-87d9-4cb9-8cbf-545561a96d7c`.
- Foi criada a listagem de aulas por matrículas ativas do próprio aluno, com
  isolamento por instituição, e uma sala de aula que entra no IVS somente como
  subscriber. O aluno não solicita câmera/microfone nem capacidade de publicação;
  chat, perguntas e voto em enquete permanecem disponíveis.
- O primeiro diff foi interrompido porque a ausência de `institution=vitru`
  proporia substituir o domínio do Cognito por `unspecified-development-live-classes`.
  Nenhum deploy foi executado com esse contexto incorreto. O diff repetido com o
  contexto correto não mostrou alterações em Cognito ou DynamoDB.
- Validação local: typecheck, lint, 498 testes unitários, 28 testes de integração,
  Next build, OpenNext build e CDK synth passaram. O ambiente restrito inicialmente
  bloqueou as portas do DynamoDB Local e o download das fontes Geist; ambos passaram
  ao repetir com as permissões necessárias.
- `Api-development` terminou em `UPDATE_COMPLETE` em 2026-07-29. A página pública
  `/login` respondeu HTTP 200. Uma consulta adicional pela AWS CLI local não pôde
  rodar por incompatibilidade da instalação Python 3.14 com `libexpat`; o deploy do
  CloudFormation já confirmou a atualização da distribuição.

### Primeira tentativa de provisionar o IVS Stage

- Ao entrar no estúdio, `CreateStage` falhou atomicamente com HTTP 403 porque a
  chamada incluía a tag obrigatória `Environment`, mas a role da Lambda possuía
  `ivs:CreateStage` sem `ivs:TagResource`. Digest `2428913089`.
- Lambda correlation IDs: `85e3527c-33cd-42c7-8d71-8d696842bbb0`,
  `c2d54892-8f32-48b1-8789-5663e26c1685`,
  `23cb0077-4226-4e9f-afa7-eb258a161cbf` e
  `1d911da3-e958-4ee1-9cca-794fdac25fdc`. IVS request IDs:
  `b0724dc5-97be-48b5-af95-820174780426`,
  `8c2f9ce5-732f-4b2a-93ca-c53b17611bd9`,
  `11ba5f17-815d-4adb-a62c-dc1eeb9a4fdc` e
  `894aefc7-64ee-4c36-aa2d-ef803ac3f7f0`.
- Nenhum Stage foi criado nessas tentativas. A policy de criação passou a autorizar
  `ivs:CreateStage` e `ivs:TagResource` no mesmo ARN `stage/*`, preservando a
  condição `aws:RequestTag/Environment=development`.

### Primeiro teste de realtime e vídeo do aluno

- Chat, perguntas e enquetes não funcionavam porque toda conexão WebSocket falhava
  no `$connect` com HTTP 500. O authorizer autônomo carregava `server-only`, marcador
  específico do Next que lança uma exceção quando executado fora do ambiente de
  Server Components.
- API Gateway request IDs observados: `BSNjdE0tIAMEXIw=`,
  `BSNk-FJXIAMECvA=`, `BSNtCHItoAMEFNA=` e `BSN9qEY9IAMEr-A=`.
  Lambda request IDs: `0ae899bb-f732-43b9-880f-d00e901e8d11`,
  `de3d2c96-7fad-4d44-8231-cd0feeadc6e0`,
  `42b7d203-625b-4507-bd0d-7f16ba9dec09` e
  `eeff75fd-f98c-47a2-af02-5ebefbb70d86`.
- O marcador foi removido da camada `src/infrastructure`, usada tanto pelo Next
  quanto pelas Lambdas independentes. Um teste de arquitetura agora falha se ele
  reaparecer nessa camada; os bundles sintetizados também foram inspecionados.
- Por decisão funcional no smoke, ALUNO matriculado passa a receber
  `PUBLISH+SUBSCRIBE` dentro da aula. A sala do aluno solicita câmera/microfone,
  publica os tracks e exibe o professor; o estúdio exibe em mosaico os streams
  remotos dos alunos. Isso não altera o papel permanente `ALUNO` nem suas permissões
  administrativas.
- Validação pré-deploy: typecheck, lint, 499 testes unitários, 28 testes de
  integração, Next build, OpenNext build e CDK synth passaram.

No development atual, tabela, buckets e secrets são configurados para destruição
(buckets com `autoDeleteObjects`); portanto podem ser apagados pelo destroy. Em
production, tabela/buckets/secrets protegidos por `RETAIN` sobrevivem e aparecem
como recursos órfãos deliberados após remoção da stack. Nunca executar teardown de
production como atalho para limpar development, e nunca apagar acervo sem exportação
e autorização explícita.
