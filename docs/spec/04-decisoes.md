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

## Restrições de ambiente

- O Git local é 2.15.0 e não oferece `git branch --show-current`; a leitura da branch utiliza `git rev-parse --abbrev-ref HEAD`.
- `.env.example` é um arquivo-modelo rastreado por exceção explícita no `.gitignore`. Arquivos `.env` reais permanecem ignorados.

## Pendências abertas

### PENDENTE (D4) — Lista de conceitos do seed

A lista institucional dos conceitos de Estatística I ainda não está definida. A pendência bloqueia a Etapa 4.

### PENDENTE (D5) — Pipeline real e fallback da demonstração

A composição da demonstração com pipeline real e fallback pré-gerado requer confirmação antes da Etapa 13.

### PENDENTE (D6) — Prazo do hackathon

O prazo do hackathon ainda não está registrado nesta especificação. A ausência impede a validação do planejamento temporal.

### PENDENTE (D7) — Capability do aluno

A capability do aluno entre `PUBLISH` e `SUBSCRIBE` ainda não está decidida. A pendência bloqueia a Etapa 7.

### PENDENTE (D9) — Método de detecção da dúvida

O método permanece entre heurística determinística e classificação via Amazon Bedrock. A opção via Bedrock exige job assíncrono e faz a Etapa 8 compartilhar infraestrutura com a Etapa 9. A pendência bloqueia a Etapa 8.

Esta pendência foi levantada pela Supervisora e aguarda decisão da IA Principal.

### PENDENTE (D10) — Entidade da prova simulada

A Etapa 4 prevê uma prova simulada, enquanto a Etapa 2 não inclui `Assessment` nem `Activity`. A pendência bloqueia a Etapa 4 junto com D4.

Esta pendência foi levantada pela Supervisora e aguarda decisão da IA Principal.

### PENDENTE (D11) — UI do plano semanal

A Etapa 10 cria `StudySession` no plano semanal, mas nenhuma etapa define a entrega dessa tela. A pendência bloqueia a Etapa 10.

Esta pendência foi levantada pela Supervisora e aguarda decisão da IA Principal.

### PENDENTE (D12) — Limiares das regras de estado

Os limiares das regras determinísticas de `LearningState` ainda não estão definidos. A pendência bloqueia a Etapa 11.

Esta pendência foi levantada pela Supervisora e aguarda decisão da IA Principal.

## Restrições de arquitetura verificáveis

- Nenhum padrão de acesso novo utiliza `ScanCommand`.
- Amazon Bedrock e Amazon Transcribe não são chamados por Route Handler nem por handler WebSocket.
- Toda consulta preserva o isolamento por `institutionId`.
- Toda orientação do RAG exige grounding e somente é publicada quando todos os identificadores de fonte citados existem.
- As únicas dependências previstas são `react-force-graph` e os SDKs AWS de Amazon Transcribe e Amazon Bedrock.
