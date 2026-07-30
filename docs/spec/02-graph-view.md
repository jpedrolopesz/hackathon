> documentação — não é prompt de execução

# Graph View

## Objetivo

O Graph View apresenta a relação entre a disciplina, seus módulos, conceitos, materiais oficiais e dúvidas detectadas com consentimento. A visualização torna explícito quais vínculos são fatos observados e quais são inferências produzidas pelas regras do sistema.

O Graph View não é boletim, ranking ou mecanismo de classificação de aluno. Ele não atribui valor, capacidade ou rótulo a uma pessoa. Os estados descrevem exclusivamente a situação de um conceito no contexto de aprendizagem autorizado.

## Nós

### Conceito

O nó de conceito representa um tópico ensinável da disciplina.

- `nodeId`
- `disciplineId`
- `institutionId`
- `type: CONCEPT`
- `title`
- `description`
- `learningState`
- `explanation`

### Módulo

O nó de módulo agrupa conceitos que pertencem à mesma unidade de organização institucional.

- `nodeId`
- `disciplineId`
- `institutionId`
- `type: MODULE`
- `title`
- `description`

### Material

O nó de material representa uma fonte oficial utilizada no RAG.

- `nodeId`
- `materialId`
- `disciplineId`
- `institutionId`
- `type: MATERIAL`
- `title`
- `materialType`
- `sourceRef`

### Nó de dúvida

O nó de dúvida não é um item institucional. Ele é projetado em tempo de leitura a partir do item `DetectedQuestion` persistido na partição individual, conforme ADR-009.

`GraphNode` cobre exclusivamente os tipos `CONCEPT`, `MODULE` e `MATERIAL`. O tipo `DOUBT` existe apenas no contrato de resposta do endpoint.

- `nodeId`
- `detectedQuestionId`
- `userId`
- `disciplineId`
- `institutionId`
- `type: DOUBT`
- `summary`
- `consentRef`
- `createdAt`

## Arestas

- **Pré-requisito:** parte do conceito que é pré-requisito e aponta para o conceito dependente, que só é bem compreendido após ele.
- **Pertence-a-módulo:** liga um conceito ao módulo institucional correspondente.
- **Cobre-conceito:** liga um material oficial ao conceito que ele aborda.
- **Dúvida-sobre:** liga um nó de dúvida ao conceito relacionado. Ela não é um item `GraphEdge` institucional e é projetada em tempo de leitura a partir das evidências de origem `TRANSCRIPT` da partição individual.

Em uma evidência de origem `TRANSCRIPT`, o campo `sourceRef` contém o `detectedQuestionId` que originou a evidência. Esse valor permite projetar a aresta `DOUBT_ABOUT` que liga o nó de dúvida ao conceito indicado por `conceptId`.

Cada aresta contém identificador, `disciplineId`, `institutionId`, origem, destino, tipo e natureza factual ou inferida.

## Semântica visual

Uma aresta **SÓLIDA** representa um fato observado ou uma relação institucional declarada. Uma aresta **TRACEJADA** representa uma inferência produzida pelo sistema.

Essa distinção permanece visível ao usuário em todos os estados relevantes da interface. A legenda identifica expressamente “fato observado” e “inferência”.

## Estados de LearningState

Os estados descrevem conceitos, nunca pessoas.

| Estado | Definição do conceito | Texto exibido |
|---|---|---|
| `NOT_STARTED` | Ainda não há evidência suficiente de interação relevante com o conceito. | Não iniciado |
| `BLOCKED` | O conceito depende de pré-requisito cujo estado impede avanço coerente. | Bloqueado por pré-requisito |
| `IN_PROGRESS` | Existem evidências de trabalho em andamento, sem base suficiente para outro estado. | Em progresso |
| `NEEDS_PRACTICE` | As evidências indicam necessidade de novas oportunidades de prática sobre o conceito. | Precisa de prática |
| `POSSIBLE_DIFFICULTY` | Há sinais que justificam atenção, sem transformar a inferência em diagnóstico ou atributo pessoal. | Possível dificuldade no conceito |
| `NEEDS_REVIEW` | Evidências anteriores justificam uma revisão do conceito. | Precisa de revisão |
| `LIKELY_UNDERSTOOD` | Um conjunto de evidências compatíveis sustenta a hipótese auditável de compreensão do conceito. | Provavelmente compreendido |

As transições seguem as regras determinísticas e versionadas de `state-rules/v1`, conforme ADR-008. O recálculo permanece restrito aos conceitos afetados e produz uma explicação legível. Nenhuma transição para `LIKELY_UNDERSTOOD` decorre de evidência única ou de mero acesso a material.

## LearningEvidence

`LearningEvidence` registra a base factual usada pelo state engine. As origens previstas são transcrição, atividade e acesso. Uma evidência derivada de transcrição possui `consentRef` obrigatório, associado ao consentimento vigente que autorizou sua criação.

Uma evidência de origem `ACTIVITY` pode registrar `result?: 'CORRECT' | 'INCORRECT'`, conforme ADR-006. Esse campo descreve a resposta observada e nunca um atributo da pessoa.

O acesso a um material representa somente um fato de acesso. Esse fato nunca indica domínio por si só e não autoriza uma conclusão isolada sobre compreensão.

## Modelo DynamoDB single-table

### proposta — sujeita a validação da IA Principal

O modelo é ancorado em `Discipline`, conforme o ADR-001, com `PK=DISC#{disciplineId}` para os dados institucionais do grafo. Todo item mantém `institutionId`, e todo acesso valida esse valor com o contexto autenticado.

Proposta de itens institucionais:

| Item | PK | SK |
|---|---|---|
| Discipline | `DISC#{disciplineId}` | `METADATA` |
| GraphNode (`CONCEPT`, `MODULE` e `MATERIAL`) | `DISC#{disciplineId}` | `NODE#{nodeType}#{nodeId}` |
| GraphEdge | `DISC#{disciplineId}` | `EDGE#{edgeType}#{fromNodeId}#{toNodeId}` |
| Material | `DISC#{disciplineId}` | `MATERIAL#{materialId}` |

Os estados e as evidências individuais ficam em uma partição orientada ao usuário e à disciplina:

| Item | PK | SK |
|---|---|---|
| LearningState | `USER#{userId}#DISC#{disciplineId}` | `STATE#{conceptId}` |
| LearningEvidence | `USER#{userId}#DISC#{disciplineId}` | `EVIDENCE#{conceptId}#{evidenceId}` |
| DetectedQuestion vinculada | `USER#{userId}#DISC#{disciplineId}` | `DOUBT#{detectedQuestionId}` |

O endpoint realiza uma `Query` na partição institucional para conceitos, módulos, materiais e suas arestas e uma `Query` na partição individual para estados, evidências e dúvidas. O nó `DOUBT` e as arestas `DOUBT_ABOUT` são projetados a partir do resultado da `Query` individual. Não há `Scan`. Os GSIs existentes somente recebem projeções adicionais se a validação demonstrar necessidade para padrões de acesso secundários; o endpoint principal permanece limitado a 2 Queries.

## Contrato ilustrativo do endpoint

O formato abaixo utiliza dados exclusivamente fictícios.

```json
{
  "data": {
    "discipline": {
      "id": "disc-estatistica-1",
      "name": "Estatística I",
      "semester": "semestre-ficticio"
    },
    "nodes": [
      {
        "id": "concept-mediana",
        "type": "CONCEPT",
        "title": "Mediana",
        "learningState": "IN_PROGRESS",
        "explanation": "Existem evidências de estudo em andamento sobre este conceito."
      },
      {
        "id": "doubt-media-mediana",
        "type": "DOUBT",
        "summary": "Diferença entre média e mediana"
      }
    ],
    "edges": [
      {
        "id": "edge-doubt-mediana",
        "type": "DOUBT_ABOUT",
        "source": "doubt-media-mediana",
        "target": "concept-mediana",
        "evidenceKind": "INFERRED",
        "style": "DASHED"
      }
    ]
  },
  "meta": {
    "requestId": "request-ficticio"
  }
}
```
