> documentação — não é prompt de execução

# Privacidade e consentimento

## Princípio estrutural

Sem consentimento vigente, nenhum dado derivado de transcrição é criado. O consentimento constitui uma pré-condição do processamento, e não um filtro aplicado posteriormente à exibição de dados já produzidos.

## RecordingConsent

`RecordingConsent` registra a autorização relacionada à captura e ao processamento de uma aula.

- **Escopo:** aula, participante, instituição e finalidades autorizadas.
- **Quem consente:** cada participante ao qual a captura e o processamento se aplicam.
- **Granularidade:** a autorização distingue as finalidades registradas no consentimento, sem ampliar silenciosamente seu uso.
- **Vigência:** o registro contém o período no qual a autorização é válida.
- **Revogação:** a revogação encerra o uso futuro baseado naquele consentimento e permanece registrada para auditoria.

Qualquer detalhe adicional de granularidade, vigência ou efeito sobre dados previamente produzidos depende da política institucional aplicável e não é presumido nesta especificação.

## consentRef

Todo `Transcript`, `TranscriptSegment`, `DetectedQuestion` e `LearningEvidence` derivado de transcrição referencia, por `consentRef`, o `RecordingConsent` vigente que autorizou sua criação. A referência permite demonstrar a finalidade e o estado de autorização associados ao dado.

## Ausência de consentimento

Um evento recebido sem consentimento vigente é descartado antes da criação de transcrição ou de qualquer derivado. O descarte produz log auditável com identificadores técnicos mínimos, motivo e resultado. O pipeline não falha silenciosamente e não converte a ausência de consentimento em retry indefinido.

## Minimização

O painel do professor apresenta informações agregadas e não expõe nomes de alunos. Os componentes armazenam e processam apenas os dados necessários à finalidade declarada do MVP.

Os identificadores técnicos usados em pipelines e eventos evitam dados pessoais sempre que uma referência opaca atende ao mesmo objetivo.

## Vedação de rotulagem

O sistema descreve o estado de um conceito e nunca transforma evidências educacionais em atributo de uma pessoa. A interface e qualquer texto gerado não utilizam “não domina”, “fraco”, “atrasado”, “deficiente” nem termos equivalentes para caracterizar um aluno.

Estados como `POSSIBLE_DIFFICULTY` permanecem associados ao conceito e são apresentados como hipótese auditável, não como diagnóstico.

## Isolamento multi-tenant

Todos os dados mantêm `institutionId`. Toda leitura e escrita compara o tenant do recurso com o contexto autenticado por meio de `assertSameInstitution` ou controle equivalente que preserve a mesma garantia.

Uma consulta ao grafo, materiais, transcrições, evidências, recomendações ou sessões de estudo não atravessa instituições.

## Dados fictícios

Seeds, testes, documentação e exemplos utilizam exclusivamente pessoas, identificadores, aulas e conteúdos fictícios. Dados pessoais ou acadêmicos reais não integram esses artefatos.

## Correspondência com a LGPD no recorte do MVP

O MVP registra a base aplicável ao tratamento sem presumir que consentimento seja a única hipótese legal possível. A finalidade permanece explícita e limitada à demonstração educacional autorizada. A minimização restringe os dados ao necessário, e a revogabilidade permite encerrar o tratamento futuro fundamentado no consentimento.

Esses controles documentam correspondências técnicas com princípios da LGPD, mas não constituem parecer jurídico. A definição da base legal, dos prazos de retenção, dos efeitos da revogação e das responsabilidades institucionais depende de validação dos responsáveis jurídicos e de proteção de dados.
