Atue como um arquiteto de software sênior, especialista em Next.js, TypeScript, arquitetura serverless na AWS, Amazon Cognito, Amazon IVS Real-Time Streaming, API Gateway, Lambda, DynamoDB, S3, CloudFront e EventBridge.

Sua tarefa é projetar e implementar o backend de uma plataforma educacional de aulas ao vivo para uma instituição de ensino superior.

## 1. Contexto do produto

A plataforma será utilizada por uma universidade que possui:

* Instituições ou unidades acadêmicas;
* Cursos e graduações;
* Disciplinas e turmas;
* Professores;
* Alunos;
* Aulas ao vivo;
* Gravações das aulas.

Os professores poderão criar, agendar, iniciar e encerrar aulas ao vivo.

Os alunos poderão acessar as lives associadas aos cursos e turmas em que estão matriculados.

Uma aula poderá ter vários apresentadores simultâneos, utilizando Amazon IVS Real-Time Streaming.

O backend será consumido inicialmente por:

1. Uma aplicação web para professores e administradores;
2. Futuramente, um aplicativo iOS desenvolvido com SwiftUI.

O contrato da API deve ser preparado desde o início para ser facilmente consumido pelo aplicativo SwiftUI.

## 2. Objetivo do MVP

O MVP deve oferecer:

* Autenticação e perfis;
* Controle de acesso por função;
* Criação e gerenciamento de cursos e turmas;
* Agendamento de aulas ao vivo;
* Live com vários apresentadores;
* Participação dos alunos;
* Chat e interações durante a aula;
* Perguntas e respostas;
* Reações rápidas;
* Enquetes;
* Controle de presença;
* Gravação das aulas;
* Replay das gravações;
* Painel web para professores;
* API REST para o aplicativo mobile;
* Comunicação WebSocket para funcionalidades em tempo real.

## 3. Tecnologias obrigatórias

Use:

* Next.js com App Router;
* TypeScript com modo estrito;
* Node.js na versão LTS compatível;
* Route Handlers do Next.js;
* Amazon Cognito;
* Amazon API Gateway;
* AWS Lambda;
* Amazon IVS Real-Time Streaming;
* Amazon S3;
* Amazon CloudFront;
* Amazon DynamoDB;
* Amazon EventBridge;
* AWS SDK for JavaScript v3;
* Zod para validação;
* OpenAPI 3.1 para documentação;
* AWS CDK com TypeScript para infraestrutura como código;
* Vitest ou Jest para testes;
* ESLint e Prettier.

Use sempre versões estáveis e compatíveis das bibliotecas.

## 4. Decisão arquitetural

O projeto deve usar Next.js para:

* Painel web administrativo;
* Painel dos professores;
* API REST;
* Organização dos módulos do backend;
* Autenticação das páginas web;
* Validação das requisições;
* Orquestração dos serviços AWS.

Mantenha toda a lógica de domínio separada dos Route Handlers.

A estrutura deve permitir que os handlers sejam executados em AWS Lambda e expostos pelo API Gateway.

Não coloque regras de negócio diretamente em arquivos `route.ts`.

Use uma arquitetura modular inspirada em Clean Architecture ou Hexagonal Architecture, sem complexidade excessiva.

Organize o código aproximadamente assim:

```text
src/
  app/
    api/
      v1/
    dashboard/
    professor/
  modules/
    auth/
    users/
    institutions/
    courses/
    classes/
    enrollments/
    lives/
    participants/
    interactions/
    recordings/
  domain/
    entities/
    errors/
    value-objects/
  application/
    use-cases/
    ports/
    dtos/
  infrastructure/
    aws/
      cognito/
      ivs/
      dynamodb/
      s3/
      cloudfront/
      eventbridge/
    repositories/
    observability/
  shared/
    auth/
    validation/
    errors/
    http/
    config/
infrastructure/
  lib/
  stacks/
tests/
```

Ajuste essa estrutura quando necessário, mas preserve a separação entre domínio, casos de uso, infraestrutura AWS e camada HTTP.

## 5. Autenticação e autorização

Use Amazon Cognito User Pools para autenticação.

O Cognito será responsável por:

* Login;
* Logout;
* Recuperação de senha;
* Confirmação de conta;
* Renovação de sessão;
* Emissão de access token, ID token e refresh token.

Não implemente emissão manual de tokens de autenticação em Lambda ou Next.js.

O backend deve:

* Validar os JWTs emitidos pelo Cognito;
* Validar issuer, audience, assinatura, expiração e `token_use`;
* Usar API Gateway JWT Authorizer ou Cognito Authorizer;
* Recuperar o usuário autenticado por meio do claim `sub`;
* Aplicar autorização por função e por recurso;
* Nunca confiar apenas em uma função enviada no corpo da requisição.

Crie os seguintes perfis:

* `ADMIN`;
* `PROFESSOR`;
* `ALUNO`.

Permissões principais:

### ADMIN

* Gerenciar cursos, turmas, professores e alunos;
* Consultar todas as lives;
* Consultar gravações;
* Alterar configurações institucionais;
* Consultar logs de auditoria.

### PROFESSOR

* Criar e editar lives das próprias disciplinas;
* Iniciar e encerrar uma live;
* Convidar outros apresentadores;
* Promover ou remover apresentadores;
* Iniciar ou encerrar gravação;
* Criar enquetes;
* Moderar chat e perguntas;
* Publicar ou ocultar uma gravação;
* Consultar presença e participantes.

### ALUNO

* Consultar lives das turmas em que está matriculado;
* Entrar em uma live;
* Assistir à transmissão;
* Enviar mensagens;
* Enviar perguntas;
* Responder enquetes;
* Enviar reações;
* Assistir às gravações autorizadas.

Inclua `institutionId` em todas as entidades relevantes para preparar o sistema para múltiplas instituições no futuro.

## 6. Amazon IVS Real-Time Streaming

Use o conceito de Stage do Amazon IVS Real-Time Streaming.

O backend nunca deve enviar credenciais AWS para o cliente.

Crie um serviço chamado `IvsRealTimeService`, responsável por:

* Criar um Stage;
* Recuperar os dados de um Stage;
* Excluir ou arquivar um Stage;
* Criar tokens temporários de participante;
* Iniciar uma composição;
* Encerrar uma composição;
* Consultar o status da composição;
* Tratar eventos recebidos pelo EventBridge.

Ao entrar em uma aula, o cliente deve chamar o backend. O backend verifica:

1. Se o usuário está autenticado;
2. Se pertence à instituição;
3. Se possui acesso ao curso ou turma;
4. Se a live está disponível;
5. Qual é a função do participante;
6. Quais capacidades do IVS devem ser concedidas.

Capacidades esperadas:

* Professor principal: `PUBLISH` e `SUBSCRIBE`;
* Professor convidado ou coapresentador: `PUBLISH` e `SUBSCRIBE`;
* Aluno comum: `SUBSCRIBE`;
* Aluno promovido temporariamente: `PUBLISH` e `SUBSCRIBE`.

Os tokens do IVS devem:

* Ser criados somente no backend;
* Possuir curta duração;
* Conter atributos que permitam identificar usuário, live, função e instituição;
* Nunca ser persistidos integralmente no banco;
* Nunca aparecer em logs;
* Ser renovados por um endpoint autenticado.

Implemente promoção e remoção de apresentadores sem conceder permissões permanentes ao usuário.

## 7. Gravações

Para aulas com vários apresentadores, utilize gravação composta do Amazon IVS por meio de server-side composition.

Fluxo esperado:

1. O professor inicia a live;
2. O backend cria ou ativa o Stage;
3. O professor começa a publicar;
4. O EventBridge recebe um evento relacionado à participação ou publicação;
5. Uma Lambda inicia a composição;
6. A composição combina os apresentadores;
7. A gravação HLS é armazenada no S3;
8. Eventos atualizam o status da gravação no DynamoDB;
9. Após processamento, a gravação fica disponível pelo CloudFront;
10. O professor pode publicar ou ocultar o replay.

O bucket S3 deve ser privado.

Não retorne URLs diretas públicas do S3.

Use CloudFront com acesso privado ao bucket e URLs assinadas ou cookies assinados quando necessário.

Estados possíveis de uma gravação:

```text
PENDING
STARTING
RECORDING
PROCESSING
READY
FAILED
HIDDEN
```

Armazene:

* ID da gravação;
* ID da live;
* Instituição;
* Stage ARN;
* Composition ARN;
* Prefixo do S3;
* Caminho do manifesto HLS;
* URL ou caminho do CloudFront;
* Duração;
* Status;
* Data de início;
* Data de término;
* Mensagem de erro;
* Visibilidade;
* Metadados técnicos.

## 8. Interações em tempo real

Use API Gateway WebSocket, Lambda e DynamoDB para as interações.

Rotas WebSocket sugeridas:

```text
$connect
$disconnect
$default
live.join
live.leave
chat.send
chat.delete
reaction.send
question.send
question.answer
question.highlight
poll.create
poll.vote
poll.close
participant.raiseHand
participant.lowerHand
participant.promote
participant.demote
```

Implemente:

* Autenticação da conexão;
* Associação entre `connectionId`, usuário e live;
* TTL para conexões expiradas;
* Remoção de conexões inválidas;
* Broadcast apenas para participantes da live;
* Limite de frequência por usuário;
* Validação de tamanho das mensagens;
* Moderação por professor;
* Persistência das interações importantes;
* Não persistir reações efêmeras indefinidamente.

As mensagens WebSocket devem possuir envelope padronizado:

```json
{
  "type": "chat.message.created",
  "eventId": "uuid",
  "liveId": "uuid",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "data": {}
}
```

## 9. Modelagem de dados

Antes de implementar o DynamoDB, apresente os principais padrões de acesso.

Inclua padrões como:

* Buscar usuário pelo Cognito `sub`;
* Listar cursos de um aluno;
* Listar turmas de um professor;
* Listar lives de uma turma;
* Listar próximas lives de um aluno;
* Buscar uma live pelo ID;
* Listar participantes de uma live;
* Verificar matrícula de um aluno;
* Listar gravações de uma disciplina;
* Buscar interações de uma live;
* Buscar conexões WebSocket ativas;
* Listar presença dos alunos.

Entidades mínimas:

```text
Institution
UserProfile
Course
ClassGroup
Enrollment
LiveSession
LivePresenter
LiveParticipant
Attendance
Recording
ChatMessage
Question
Poll
PollOption
PollVote
WebSocketConnection
AuditEvent
```

Apresente:

* Partition keys;
* Sort keys;
* GSIs;
* Itens de exemplo;
* Consultas utilizadas;
* Estratégia de paginação;
* Estratégia de TTL;
* Estratégia para evitar hot partitions.

Escolha entre single-table design ou múltiplas tabelas somente depois de explicar os padrões de acesso e os trade-offs.

## 10. Estados da live

Use uma máquina de estados clara:

```text
DRAFT
SCHEDULED
WAITING
LIVE
ENDING
ENDED
CANCELED
FAILED
```

Regras:

* Apenas professor autorizado pode criar uma live;
* Uma live deve estar associada a uma disciplina ou turma;
* Alunos não podem entrar antes da janela permitida;
* Um professor não pode iniciar uma live cancelada;
* Operações de iniciar e encerrar devem ser idempotentes;
* Uma live encerrada não pode voltar para `LIVE`;
* O replay só pode ser disponibilizado quando a gravação estiver `READY`;
* Toda alteração sensível deve gerar auditoria.

## 11. API REST

Use prefixo `/api/v1`.

Endpoints mínimos:

```text
GET    /api/v1/me
PATCH  /api/v1/me

GET    /api/v1/courses
POST   /api/v1/courses
GET    /api/v1/courses/{courseId}
PATCH  /api/v1/courses/{courseId}

GET    /api/v1/classes
POST   /api/v1/classes
GET    /api/v1/classes/{classId}
PATCH  /api/v1/classes/{classId}

GET    /api/v1/classes/{classId}/lives
POST   /api/v1/classes/{classId}/lives

GET    /api/v1/lives
GET    /api/v1/lives/{liveId}
PATCH  /api/v1/lives/{liveId}
POST   /api/v1/lives/{liveId}/start
POST   /api/v1/lives/{liveId}/finish
POST   /api/v1/lives/{liveId}/cancel

POST   /api/v1/lives/{liveId}/join
POST   /api/v1/lives/{liveId}/token/refresh
POST   /api/v1/lives/{liveId}/leave

GET    /api/v1/lives/{liveId}/participants
POST   /api/v1/lives/{liveId}/presenters/{userId}/promote
POST   /api/v1/lives/{liveId}/presenters/{userId}/demote
DELETE /api/v1/lives/{liveId}/participants/{userId}

POST   /api/v1/lives/{liveId}/recordings/start
POST   /api/v1/lives/{liveId}/recordings/stop
GET    /api/v1/lives/{liveId}/recordings

GET    /api/v1/recordings/{recordingId}
PATCH  /api/v1/recordings/{recordingId}
POST   /api/v1/recordings/{recordingId}/publish
POST   /api/v1/recordings/{recordingId}/hide
GET    /api/v1/recordings/{recordingId}/playback

GET    /api/v1/lives/{liveId}/attendance
GET    /api/v1/lives/{liveId}/questions
GET    /api/v1/lives/{liveId}/polls
```

O endpoint de entrada na live deve retornar um DTO semelhante a:

```json
{
  "live": {
    "id": "uuid",
    "title": "Aula de Arquitetura de Software",
    "status": "LIVE"
  },
  "participant": {
    "id": "uuid",
    "role": "ALUNO",
    "capabilities": ["SUBSCRIBE"]
  },
  "ivs": {
    "stageArn": "arn:aws:ivs:region:account:stage/example",
    "participantToken": "temporary-token",
    "expiresAt": "2026-01-01T12:10:00.000Z"
  },
  "realtime": {
    "webSocketUrl": "wss://example",
    "connectionToken": "temporary-token"
  }
}
```

## 12. Padrão das respostas

Utilize JSON em `camelCase`.

Datas devem estar em ISO 8601 e UTC.

Sucesso:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

Erro:

```json
{
  "error": {
    "code": "LIVE_ACCESS_DENIED",
    "message": "Você não possui acesso a esta aula.",
    "details": [],
    "requestId": "uuid"
  }
}
```

Implemente:

* Paginação por cursor;
* Filtros;
* Ordenação;
* Idempotency Key;
* Correlation ID;
* Status HTTP corretos;
* Códigos de erro estáveis;
* Mensagens internas separadas das mensagens públicas.

## 13. Painel web

Crie um painel simples e funcional para professores.

O professor deve conseguir:

* Visualizar próximas aulas;
* Criar uma aula;
* Editar título, descrição, disciplina e horário;
* Adicionar coapresentadores;
* Entrar no estúdio;
* Testar câmera e microfone;
* Iniciar a live;
* Encerrar a live;
* Visualizar participantes;
* Moderar mensagens;
* Destacar perguntas;
* Criar e encerrar enquetes;
* Promover um participante;
* Iniciar e interromper gravação;
* Consultar o processamento da gravação;
* Publicar ou ocultar o replay.

Não implemente o aplicativo SwiftUI neste momento.

Apenas prepare:

* Contrato da API;
* Documentação OpenAPI;
* Exemplos de requisições;
* Modelos de respostas;
* Fluxo de autenticação;
* Orientações de integração com o SDK iOS do Amazon IVS.

## 14. Segurança

Implemente obrigatoriamente:

* Princípio do menor privilégio no IAM;
* Bucket S3 privado;
* Criptografia em repouso;
* HTTPS obrigatório;
* Tokens temporários;
* Redação de tokens e dados sensíveis nos logs;
* Validação de todas as entradas;
* Autorização por instituição, curso e turma;
* Rate limiting;
* Throttling no API Gateway;
* Proteção contra replay de operações sensíveis;
* Auditoria das ações administrativas;
* Segregação de ambientes;
* Segredos no AWS Secrets Manager ou SSM Parameter Store;
* CORS restrito;
* Headers de segurança;
* Proteção contra enumeração de usuários;
* Exclusão segura de dados;
* Política de retenção para mensagens e gravações.

Nunca coloque secrets em:

* Código;
* Repositório;
* Arquivos enviados ao frontend;
* Variáveis com prefixo `NEXT_PUBLIC_`;
* Logs.

## 15. Observabilidade

Use:

* CloudWatch Logs;
* Logs estruturados em JSON;
* Métricas de negócio;
* Métricas técnicas;
* Alarmes;
* AWS X-Ray ou tracing compatível;
* Correlation ID;
* Dead-letter queue onde aplicável.

Métricas mínimas:

* Lives iniciadas;
* Lives encerradas;
* Falhas ao criar Stage;
* Falhas ao gerar token;
* Participantes conectados;
* Quantidade de apresentadores;
* Falhas de gravação;
* Tempo de processamento da gravação;
* Conexões WebSocket;
* Mensagens por minuto;
* Erros 4xx e 5xx;
* Duração das Lambdas;
* Throttling do DynamoDB.

## 16. Infraestrutura como código

Crie stacks do AWS CDK para:

* Cognito;
* API Gateway HTTP ou REST;
* API Gateway WebSocket;
* Lambdas;
* DynamoDB;
* IVS Real-Time;
* S3;
* CloudFront;
* EventBridge;
* IAM;
* CloudWatch;
* Filas e DLQs quando necessárias.

Separe os ambientes:

```text
development
staging
production
```

Nenhum ARN, domínio, região, bucket ou ID de conta deve ficar fixo no código.

Use tags como:

```text
Project
Environment
Institution
ManagedBy
CostCenter
```

## 17. Testes

Implemente:

* Testes unitários dos casos de uso;
* Testes de autorização;
* Testes das máquinas de estado;
* Testes dos adaptadores AWS;
* Testes dos Route Handlers;
* Testes de contrato da API;
* Testes de idempotência;
* Testes de falhas do IVS;
* Testes de processamento de eventos;
* Testes de integração com DynamoDB local ou ambiente isolado;
* Fixtures e factories tipadas.

Casos críticos:

* Aluno tentando criar live;
* Aluno não matriculado tentando entrar;
* Professor tentando editar live de outra turma;
* Usuário de outra instituição tentando acessar a live;
* Promoção temporária de aluno;
* Token IVS expirado;
* Evento duplicado do EventBridge;
* Início duplicado de gravação;
* Finalização duplicada da live;
* Falha da composição;
* Gravação ainda não processada;
* Conexão WebSocket inválida.

## 18. Entregáveis

Produza:

1. Diagrama de arquitetura em Mermaid;
2. Explicação das decisões arquiteturais;
3. Estrutura completa de pastas;
4. Modelo de domínio;
5. Padrões de acesso do DynamoDB;
6. Infraestrutura com AWS CDK;
7. Configuração do Cognito;
8. Integração com IVS Real-Time;
9. API REST;
10. API WebSocket;
11. Painel web inicial;
12. Processamento de eventos;
13. Fluxo de gravação e replay;
14. Documentação OpenAPI;
15. Arquivo `.env.example`;
16. Testes;
17. README com configuração local e deploy;
18. Exemplos de chamadas `curl`;
19. Coleção de testes da API;
20. Guia de integração futura com SwiftUI.

## 19. Forma de execução

Não gere toda a aplicação de uma vez.

Trabalhe em fases:

### Fase 1 — Arquitetura

* Apresente o diagrama;
* Explique os componentes;
* Defina os fluxos;
* Mostre decisões e trade-offs;
* Defina os padrões de acesso.

### Fase 2 — Fundação

* Crie o projeto;
* Configure TypeScript;
* Configure qualidade de código;
* Crie módulos e abstrações;
* Crie tratamento de erros;
* Configure variáveis de ambiente.

### Fase 3 — Infraestrutura

* Crie as stacks do CDK;
* Configure ambientes;
* Configure IAM;
* Configure Cognito, DynamoDB e APIs.

### Fase 4 — Autenticação e domínio

* Implemente usuários;
* Implemente cursos, turmas e matrículas;
* Implemente autorização.

### Fase 5 — Lives

* Implemente criação e gerenciamento;
* Integre o IVS Real-Time;
* Implemente tokens de participantes;
* Implemente vários apresentadores.

### Fase 6 — Interações

* Implemente WebSocket;
* Implemente chat, perguntas, reações e enquetes.

### Fase 7 — Gravações

* Implemente composição;
* Integre EventBridge;
* Armazene no S3;
* Distribua pelo CloudFront.

### Fase 8 — Painel web

* Implemente as telas dos professores;
* Integre as APIs;
* Implemente estados de carregamento e erro.

### Fase 9 — Qualidade

* Testes;
* Observabilidade;
* Segurança;
* Documentação;
* Guia para SwiftUI.

Ao final de cada fase:

* Mostre os arquivos criados;
* Explique as decisões;
* Execute ou descreva os testes;
* Verifique tipos;
* Verifique lint;
* Informe pendências;
* Não avance silenciosamente para a próxima fase.

## 20. Regras finais

* Não use código fictício em partes críticas;
* Não exponha credenciais;
* Não armazene tokens do IVS;
* Não confunda tokens do Cognito com tokens do IVS;
* Não coloque regras de negócio nos controllers;
* Não dependa de estado em memória nas Lambdas;
* Não use `any` sem justificativa;
* Não ignore erros da AWS;
* Não considere eventos do EventBridge como únicos;
* Todos os consumidores de eventos devem ser idempotentes;
* Use nomes claros em inglês no código;
* Use textos da interface em português;
* Escreva comentários somente quando agregarem contexto;
* Prefira funções pequenas e testáveis;
* Verifique a documentação oficial atual da AWS antes de usar nomes de operações, parâmetros ou limites de serviço.

Comece somente pela Fase 1.

Apresente primeiro:

1. Arquitetura proposta;
2. Diagrama Mermaid;
3. Fluxo de autenticação;
4. Fluxo de entrada em uma live;
5. Fluxo de múltiplos apresentadores;
6. Fluxo de gravação e replay;
7. Padrões de acesso do DynamoDB;
8. Principais riscos técnicos;
9. Decisões que precisam ser tomadas antes da implementação.
# hackathon
