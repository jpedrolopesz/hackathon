> documentação — não é prompt de execução

# Decisões e pendências

## ADR-001 — Course e Discipline

`Course` representa um curso superior. A nova entidade `Discipline` representa uma disciplina filha de `Course`, usa `PK=DISC#{id}` e possui o campo `semester`.

`ClassGroup` passa a referenciar `disciplineId` e mantém `courseId` por compatibilidade. O grafo, os materiais, o RAG e o plano de estudos ficam ancorados em `Discipline`.

Essa evolução não utiliza migração destrutiva.

## ADR-002 — Transcrição e diarização

A transcrição e a diarização utilizam Amazon Transcribe com português do Brasil, timestamps e speaker labels.

## ADR-003 — LLM e embeddings

O LLM e os embeddings utilizam Amazon Bedrock. O acesso ocorre sempre por trás da porta `LlmService`, e o modelo específico permanece configurável.

## ADR-004 — Baseline e branch

O trabalho ocorre na branch `feat/edu-agent`. O commit `549eed7` foi criado como baseline único de revisão e contém as entregas das Etapas 1–3 ainda não revisadas, tendo como antecessor o commit `205088a`.

## ADR-005 — Detecção de dúvida

A detecção usa heurística determinística versionada como `doubt-detector/v1`.

Um `TranscriptSegment` gera candidato a dúvida quando as três condições ocorrem:

1. O speaker label é do aluno.
2. O texto contém marcador interrogativo: “?”, “como”, “qual a diferença”, “não entendi” ou “pode explicar”.
3. Há correspondência normalizada por caixa e acentos entre o texto e o `title` ou as palavras-chave de um conceito do grafo da disciplina.

O conceito correspondente define as arestas `DOUBT_ABOUT`. A classificação via Amazon Bedrock permanece fora do MVP. Esta decisão resolve D9.

## ADR-006 — Prova simulada

O MVP não introduz entidade `Assessment` nem `Activity`. A prova simulada é um `Material` com `materialType: 'SIMULATED_EXAM'`, mantido na partição institucional, com arestas `COVERS_CONCEPT` comuns.

Os resultados fictícios da prova são registrados como `LearningEvidence` de origem `ACTIVITY`, com `sourceRef` apontando para o id do material.

`ActivityLearningEvidence` recebe o campo opcional `result?: 'CORRECT' | 'INCORRECT'`. O campo registra um fato observado sobre a resposta e não constitui julgamento sobre a pessoa. Ele é insumo da regra R3 do ADR-008. Esta alteração de entidade está autorizada e resolve D10.

## ADR-007 — Plano semanal

A entrega mínima é a página `src/app/plan/`, dentro da Etapa 10. A página apresenta os 7 dias da semana corrente, de segunda a domingo, com as `StudySession` agrupadas por dia. Cada card exibe o conceito, a origem com link para a recomendação e o status.

Não há biblioteca de calendário nem dependência nova. O aceite da recomendação cria a sessão, que passa a aparecer no plano. O replanejamento da Etapa 11 apenas altera a data das sessões.

O caminho `src/app/plan/` segue a estrutura existente do App Router, que não utiliza route groups. Esta decisão resolve D11.

## ADR-008 — Regras de estado state-rules/v1

As regras são determinísticas e avaliadas por conceito C do usuário U em ordem de prioridade; a primeira que casar define o estado.

| # | Estado | Condição |
|---|---|---|
| R1 | `NEEDS_REVIEW` | Existe `StudySession` aceita para C com data planejada vencida e não concluída, inclusive por atraso simulado. |
| R2 | `POSSIBLE_DIFFICULTY` | Existe ao menos uma evidência `TRANSCRIPT` de dúvida sobre C ainda não seguida de sessão de estudo concluída sobre C. |
| R3 | `NEEDS_PRACTICE` | Existe ao menos uma evidência `ACTIVITY` com `result: 'INCORRECT'` sobre C. |
| R4 | `BLOCKED` | C não possui evidência própria e algum pré-requisito direto está em `POSSIBLE_DIFFICULTY`, `NEEDS_PRACTICE` ou `NEEDS_REVIEW`. |
| R5 | `LIKELY_UNDERSTOOD` | Existem ao menos duas evidências de ao menos duas origens distintas, sendo ao menos uma `ACTIVITY` com `result: 'CORRECT'`. |
| R6 | `IN_PROGRESS` | Existe ao menos uma evidência de qualquer origem, inclusive somente `ACCESS`. |
| R7 | `NOT_STARTED` | Não existe evidência. |

R5 possui guarda explícita: a transição nunca decorre de evidência única e nunca se apoia somente em evidência de origem `ACCESS`.

O recálculo abrange o conceito que recebeu a evidência nova e propaga aos dependentes diretos por `PREREQUISITE_OF`, seguindo transitivamente apenas enquanto o estado efetivamente mudar. A `explanation` segue o template da regra e cita os ids das evidências e o `consentRef` quando aplicável, por exemplo: “Calculado por state-rules/v1 R2: 1 dúvida detectada em aula (ev-x, consentimento c-y), sem sessão de estudo concluída.”

Esta decisão resolve D12.

## ADR-009 — Partição do nó de dúvida

`GraphNode` cobre exclusivamente os tipos `CONCEPT`, `MODULE` e `MATERIAL`, mantidos na partição institucional `DISC#{disciplineId}`.

O nó `DOUBT` não é item institucional: ele é projetado em tempo de leitura a partir do item `DetectedQuestion` persistido na partição individual, com `PK=USER#{userId}#DISC#{disciplineId}` e `SK=DOUBT#{detectedQuestionId}`.

As arestas `DOUBT_ABOUT` também não são itens `GraphEdge` institucionais: elas são projetadas das evidências `TRANSCRIPT` retornadas pela mesma `Query` da partição individual. O tipo `DOUBT_ABOUT` permanece em `GraphEdgeType` apenas para o contrato de resposta do endpoint.

O modelo preserva as 2 Queries do endpoint, não utiliza `Scan` e impede que dado individual alcance a partição institucional.

`DetectedQuestion` recebe `readonly userId: string`. A dúvida pertence ao participante cuja fala consentida a originou, e o campo ancora o item na partição individual. Esta alteração de entidade está autorizada.

## ADR-010 — Capability do aluno

A capability padrão do aluno é `SUBSCRIBE`, por menor privilégio. Na aula simulada da demonstração, o participante aluno é promovido explicitamente a `PUBLISH`, condicionado a consentimento vigente. Sem essa promoção, a fala do aluno não integra a gravação e a diarização da Etapa 7 não possui vozes a distinguir.

Esta decisão resolve D7.

## ADR-011 — Composição da demonstração

A demonstração utiliza o pipeline real com fallback de transcrição pré-gerada, acionável por script ou flag. Os 2 ensaios da Etapa 13 exercitam ambos os caminhos ao menos uma vez.

Esta decisão resolve D5.

## Restrições de ambiente

- O Git local é 2.15.0 e não oferece `git branch --show-current`; a leitura da branch utiliza `git rev-parse --abbrev-ref HEAD`.
- `.env.example` é um arquivo-modelo rastreado por exceção explícita no `.gitignore`. Arquivos `.env` reais permanecem ignorados.

## Pendências abertas

### PENDENTE (D4) — Lista de conceitos do seed

A proposta aguarda validação humana e registra:

- **M1 Fundamentos:** População e amostra · Tipos de variáveis · Tabelas de frequência · Histograma
- **M2 Tendência central:** Média aritmética · Mediana · Moda
- **M3 Dispersão:** Amplitude · Variância · Desvio padrão · Coeficiente de variação
- **M4 Análise exploratória:** Quartis e percentis · Boxplot · Assimetria · Correlação linear (noção)
- **Pré-requisitos:** Tabelas de frequência→Histograma; Média→Variância→Desvio padrão→Coeficiente de variação; Mediana→Quartis→Boxplot; Média e Mediana→Assimetria.
- **Materiais:** apostila (capítulo de tendência central), videoaula do M2, lista de exercícios e prova simulada (`SIMULATED_EXAM`, conforme ADR-006).

Todos os dados são fictícios.

### PENDENTE (D6) — Prazo do hackathon

O prazo do hackathon ainda não está registrado nesta especificação. A ausência impede a validação do planejamento temporal.

## Restrições de arquitetura verificáveis

- Nenhum padrão de acesso novo utiliza `ScanCommand`.
- Amazon Bedrock e Amazon Transcribe não são chamados por Route Handler nem por handler WebSocket.
- Toda consulta preserva o isolamento por `institutionId`.
- Toda orientação do RAG exige grounding e somente é publicada quando todos os identificadores de fonte citados existem.
- As únicas dependências previstas são `react-force-graph` e os SDKs AWS de Amazon Transcribe e Amazon Bedrock.
- Nenhum dado individual é persistido na partição institucional `DISC#{disciplineId}`. O nó `DOUBT` e as arestas `DOUBT_ABOUT` são projetados em tempo de leitura a partir da partição individual, conforme ADR-009.
- As únicas alterações de entidade autorizadas no MVP são `result?: 'CORRECT' | 'INCORRECT'` em `ActivityLearningEvidence` e `readonly userId: string` em `DetectedQuestion`. Qualquer outra alteração de entidade exige autorização da IA Principal.
