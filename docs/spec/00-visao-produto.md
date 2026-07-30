> documentação — não é prompt de execução

# Visão do produto

## Problema

A plataforma já conecta professores e alunos em aulas ao vivo, mas uma dúvida surgida durante a aula pode desaparecer assim que a sessão termina. Algumas dúvidas morrem no fluxo do chat; outras aparecem de forma oral e não se tornam uma pergunta registrada; outras nem chegam a ser ditas.

Essa perda rompe a continuidade entre aula, material institucional e estudo posterior. O aluno deixa a sala sem uma orientação concreta, o professor não recebe uma visão agregada dos conceitos que pedem atenção, e a instituição não preserva uma ligação auditável entre dúvida, conteúdo oficial e recomendação.

## Proposta

O MVP captura uma dúvida a partir de transcrição consentida de uma aula, relaciona essa dúvida ao grafo de conceitos da disciplina e recupera materiais oficiais da instituição. A orientação resultante cita suas fontes e pode ser convertida em uma sessão de estudo no plano semanal.

A recomendação permanece sob controle do aluno. Ela pode ser aceita ou recusada, e a decisão fica registrada. O aceite cria uma `StudySession`; a recusa não é tratada como falha nem como sinal negativo sobre a pessoa.

O grafo reúne os fatos institucionais da disciplina, as relações de pré-requisito, os materiais e as dúvidas detectadas. Ele também apresenta estados calculados por regras determinísticas sobre conceitos. A visualização distingue fatos observados de inferências para que o usuário compreenda a natureza de cada relação.

## Diferenciais

### Estado determinístico e auditável

O LLM redige orientações; ele não julga o estado de aprendizagem. O state engine aplica regras determinísticas e versionadas, registra as evidências utilizadas e produz uma explicação legível.

O sistema não conclui compreensão a partir de uma evidência única e não interpreta mero acesso a material como domínio. As mudanças de estado podem ser reproduzidas a partir das regras e evidências registradas.

### Consentimento como pré-condição

O consentimento não funciona como filtro visual sobre dados já produzidos. Sem consentimento vigente, a transcrição e seus derivados não são criados. Dúvidas, evidências e orientações derivadas mantêm referência ao consentimento que autorizou seu processamento.

### Estado de conceito, nunca rótulo de pessoa

Os estados descrevem conceitos no contexto da aprendizagem. O produto não classifica alunos, não cria ranking e não transforma uma inferência em diagnóstico pessoal. O painel do professor permanece agregado e não apresenta nomes de alunos.

## Atores

### Aluno

O aluno participa da aula, registra consentimento, recebe orientação fundamentada, decide sobre a recomendação e visualiza o grafo e o plano semanal. A decisão de aceitar ou recusar permanece explícita.

### Professor

O professor conduz a aula e acessa uma visão agregada dos conceitos que receberam dúvidas ou sinais relevantes. O painel não expõe nomes de alunos.

### Instituição

A instituição fornece a estrutura da disciplina, os materiais oficiais e as relações do grafo. Ela também define as políticas de tratamento, acesso e consentimento aplicáveis.

## Demonstração de 3 minutos

O roteiro da demonstração constitui uma especificação executável do MVP:

1. Uma aula simulada começa com consentimento vigente.
2. A aula produz uma gravação.
3. A gravação gera transcrição com distinção entre professor e aluno.
4. O pipeline detecta a dúvida fictícia “diferença entre média e mediana”.
5. A dúvida é relacionada aos conceitos correspondentes no grafo de Estatística I.
6. O RAG consulta os materiais oficiais do seed.
7. O sistema apresenta uma orientação redigida com citação das fontes utilizadas.
8. O aluno aceita ou recusa a recomendação.
9. Quando aceita, a recomendação cria uma `StudySession` no plano semanal.
10. O Graph View apresenta 1 disciplina, aproximadamente 15 conceitos, estados calculados por regra e o nó de dúvida visível.
11. O professor visualiza um painel agregado, sem nomes de alunos.
12. A auditoria básica apresenta o evento, a versão da regra, as fontes e a decisão do aluno.

O fluxo possui fallback de transcrição pré-gerada para preservar a demonstração quando o pipeline externo não estiver disponível, conforme a confirmação pendente registrada em D5.

## Critério de sucesso

O MVP é bem-sucedido quando toda a cadeia da demonstração é executada 2 vezes seguidas, em sessões completas, sem falha.

## Não-objetivos

O MVP não entrega grupos de estudo, mobilidade acadêmica, suporte amplo a múltiplas disciplinas, modelos próprios de machine learning, notificações proativas, recomendação entre disciplinas, memória de longo prazo, calendário acadêmico completo, atividades e notas formais ou transcrição em tempo real.

Essas possibilidades estão descritas em [99-futuro.md](./99-futuro.md) exclusivamente como referência e não constituem requisitos do MVP.
