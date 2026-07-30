> documentação — não é prompt de execução

# MVP do hackathon

Este documento é a fonte de verdade do escopo do MVP. O trabalho compreende exclusivamente as etapas 2 a 13 descritas a seguir.

## Etapa 2 — Entidades novas e testes

- **Entrega:** entidades `Discipline`, `Material`, `RecordingConsent`, `Transcript`, `TranscriptSegment`, `DetectedQuestion`, `GraphNode`, `GraphEdge`, `LearningEvidence`, `LearningState`, `Recommendation` e `StudySession`, acompanhadas de testes unitários. Conforme ADR-009, `GraphNode` cobre exclusivamente os tipos `CONCEPT`, `MODULE` e `MATERIAL`, e `DetectedQuestion` inclui `readonly userId: string`. Conforme ADR-006, `ActivityLearningEvidence` inclui `result?: 'CORRECT' | 'INCORRECT'`.
- **Critério de pronto:** os testes unitários permanecem verdes e nenhuma entidade existente é alterada além do que está definido no ADR-001.
- **Dependências:** nenhuma dependência de etapa anterior deste escopo.
- **Status:** planejada.

## Etapa 3 — Gate de consentimento

- **Entrega:** `RecordingConsent`, verificação de consentimento no pipeline e modal de consentimento na sala.
- **Critério de pronto:** um evento sem consentimento vigente é descartado com log, e esse comportamento possui cobertura de teste.
- **Dependências:** Etapa 2.
- **Status:** planejada.

## Etapa 4 — Seed do grafo institucional

- **Entrega:** carga idempotente de JSON para DynamoDB com 15 conceitos de Estatística I, módulos, pré-requisitos, 3–4 materiais, 2 aulas e 1 prova simulada.
- **Critério de pronto:** o script pode ser executado novamente sem duplicar ou corromper os dados.
- **Dependências:** Etapa 2 e validação humana da lista de conceitos. A prova simulada é um `Material` com `materialType: 'SIMULATED_EXAM'`, conforme ADR-006.
- **Status:** BLOQUEADA — `PENDENTE (D4)`, aguardando validação humana da lista de conceitos.

## Etapa 5 — Endpoint do grafo do aluno

- **Entrega:** `GET /me/graph/{disciplineId}` no padrão da API v1.
- **Critério de pronto:** a leitura usa no máximo 2 operações `Query`, não usa `Scan`, e possui teste de contrato e teste de isolamento de tenant.
- **Dependências:** Etapas 2 e 4.
- **Status:** planejada.

## Etapa 6 — Interface Graph View

- **Entrega:** Graph View com `react-force-graph`, estados, legenda, painel de nó e distinção visual entre fato por traço sólido e inferência por traço tracejado.
- **Critério de pronto:** a interface renderiza os dados fornecidos pelo endpoint.
- **Dependências:** Etapa 5; o desenvolvimento visual pode começar com mock.
- **Status:** planejada.

## Etapa 7 — Pipeline de transcrição

- **Entrega:** fluxo `recording.ready` → job assíncrono → Amazon Transcribe → persistência de `Transcript` e segmentos.
- **Critério de pronto:** a saída possui timestamps e speaker labels; o processamento é idempotente e possui DLQ.
- **Dependências:** Etapas 2 e 3.
- **Status:** planejada. A capability foi definida pelo ADR-010.

## Etapa 8 — Detecção de dúvida e atualização do grafo

- **Entrega:** detecção de dúvida pela heurística determinística `doubt-detector/v1`, conforme ADR-005, emissão do evento `transcript.doubt_detected` e processamento pelo graph-updater, que cria nó de dúvida, arestas e `LearningEvidence` com `consentRef`.
- **Critério de pronto:** a dúvida usada na demonstração aparece no grafo.
- **Dependências:** Etapa 7.
- **Status:** planejada. O método foi definido pelo ADR-005.

## Etapa 9 — RAG mínimo

- **Entrega:** recuperação sobre os materiais do seed e orientação redigida via Amazon Bedrock com citação de fontes.
- **Critério de pronto:** um teste de grounding garante que a orientação somente é publicada quando todos os identificadores citados existem.
- **Dependências:** Etapa 4.
- **Status:** planejada.

## Etapa 10 — Recomendação e sessão de estudo

- **Entrega:** `Recommendation` nos estados `PROPOSED`, `ACCEPTED`, `REJECTED` e `IGNORED`; o aceite cria uma `StudySession` no plano semanal, entregue como a página `src/app/plan/`, conforme ADR-007.
- **Critério de pronto:** o estado é persistido, e o grafo e o plano refletem a decisão.
- **Dependências:** Etapas 6 e 9.
- **Status:** planejada. A interface foi definida pelo ADR-007.

## Etapa 11 — State engine e replanejamento

- **Entrega:** state engine com `NOT_STARTED`, `BLOCKED`, `IN_PROGRESS`, `NEEDS_PRACTICE`, `POSSIBLE_DIFFICULTY`, `NEEDS_REVIEW` e `LIKELY_UNDERSTOOD`, pelas regras de `state-rules/v1`, conforme ADR-008, além de replanejamento por atraso simulado.
- **Critério de pronto:** o motor recalcula somente conceitos afetados, produz `explanation` legível e nunca conclui domínio por evidência única nem por mero acesso a material.
- **Dependências:** Etapas 8 e 10.
- **Status:** planejada. Os limiares foram definidos pelo ADR-008.

## Etapa 12 — Painel agregado e auditoria

- **Entrega:** painel agregado do professor e auditoria contendo evento, versão da regra, fontes e decisão do aluno.
- **Critério de pronto:** a apresentação agregada não contém nomes de alunos.
- **Dependências:** Etapa 10.
- **Status:** planejada.

## Etapa 13 — Demonstração

- **Entrega:** roteiro da demonstração, fallback de transcrição pré-gerada e 2 ensaios completos.
- **Critério de pronto:** a demonstração de 3 minutos é reproduzida 2 vezes sem falha.
- **Dependências:** todas as etapas anteriores.
- **Status:** planejada. A composição foi definida pelo ADR-011, com pipeline real e fallback pré-gerado exercitados nos 2 ensaios.

## Fora de escopo do MVP

As capacidades explicitamente excluídas deste MVP estão registradas em [99-futuro.md](./99-futuro.md). Esse documento é referência de evolução e não amplia o escopo das etapas acima.
