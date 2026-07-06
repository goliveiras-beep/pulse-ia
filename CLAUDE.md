# CLAUDE.md

Este arquivo orienta o Claude Code (claude.ai/code) ao trabalhar com o código deste repositório.

## O que é isso

**Pulse IA** é o assistente de IA interno e portal operacional da LiveMode (empresa brasileira de produção
de TV ao vivo). Tem duas frentes:

1. Um **bot no Slack** (DM pro app "Pulse IA") para perguntas rápidas, consulta da grade de transmissão ao
   vivo e autorregistro de ausências.
2. Um **portal web** (`/api/app`) — dashboards em HTML renderizado no servidor para dois perfis:
   `colaborador` (vê os próprios turnos/escala, solicita folgas/ausências) e `gestor` (edita a escala da
   equipe, aprova solicitações, gera escalas com IA, relatórios de RH/banco de horas, repositório de
   documentos).

Tudo está em português do Brasil — comentários de código, textos de interface, nomes de variáveis/funções e
mensagens de commit. Mantenha código novo consistente com isso.

## Stack e restrições

- **Funções serverless Node.js ESM puras**, publicadas na **Vercel** — cada arquivo em `api/` (e
  `api/auth/`) é um handler independente exportando `default async function handler(req, res)`, sem
  router/framework compartilhado (nada de Express/Next.js).
- **Sem build, sem bundler, sem TypeScript, sem configuração de linter/formatter e sem suíte de testes.**
  O `package.json` declara uma única dependência (`google-auth-library`) e nenhum script. Não existe
  `npm run build`/`test`/`lint` — validar uma mudança significa ler o código com atenção e, quando possível,
  exercitar o endpoint já publicado.
- Arquivos estáticos (`index.html`, a landing page de marketing; `privacy.html`; o arquivo de verificação do
  Google) são servidos tal como estão pela Vercel; não têm relação com o portal dinâmico em `api/app.js`.
- `vercel.json` define `maxDuration: 30` para todas as funções `api/*.js` e dois agendamentos de cron que
  chamam `/api/monitor?token=pulse_monitor_2026` (aproximadamente de hora em hora durante o dia, de meia em
  meia hora de madrugada).

## Rodando / publicando

- Não há servidor de desenvolvimento local versionado no repositório. Para rodar localmente, usa-se a
  Vercel CLI (`vercel dev`), que precisa de todas as variáveis de ambiente abaixo configuradas em
  `.env.local` (copie o `.env.example` como ponto de partida — ele só lista duas delas; o resto precisa vir
  das configurações do projeto na Vercel ou de outra pessoa do time).
- O deploy acontece automaticamente a cada push, via integração da Vercel com o GitHub (veja o `README.md`
  para os passos originais de configuração: criar o projeto na Vercel, configurar as variáveis de ambiente,
  apontar a Request URL de Event Subscriptions do app do Slack para `/api/pulse`).
- Não existe ambiente de staging neste repositório — mudanças em `api/*.js` vão pro ar no próximo deploy.

### Variáveis de ambiente realmente usadas pelo código

| Variável | Usada por |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `lib/google-auth.js` — JSON da service account (como string) para todo acesso ao Google Sheets |
| `GOOGLE_SHEET_ID` | a única planilha que funciona como banco de dados da aplicação |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | fluxo de login via Google OAuth (`api/app.js`, `api/auth/*`) |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | `api/upload-atestado.js` — upload de atestados pro Drive usando a conta fixa de um gestor |
| `PULSE_BASE_URL` | base da redirect URI do OAuth |
| `SLACK_BOT_TOKEN` | postar/ler via Slack Web API (`api/pulse.js`, `api/monitor.js`) |
| `SLACK_RH_CHANNEL` | canal de notificação do RH para registros de ausência |
| `GROQ_API_KEY` | chamadas de LLM rápidas/baratas (`llama-3.1-8b-instant` via endpoint compatível com OpenAI da Groq) — Q&A geral, interpretação de comandos, frases motivacionais |
| `ANTHROPIC_API_KEY` | usada só em `api/gerar-escala.js` — chama o Claude diretamente para a geração de escala assistida por IA |
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_ID` | a grade de eventos de transmissão ao vivo, lida do Airtable e cruzada com a escala de trabalho em vários lugares |
| `CRON_TOKEN` | precisa ser igual ao token usado nos caminhos de cron do `vercel.json` para o `api/monitor.js` aceitar a requisição |
| `GITHUB_TOKEN` | `api/monitor.js` faz commit de `data/grade_snapshot.json` de volta neste repositório via API do GitHub, para comparar mudanças na grade ao longo do tempo |
| `DRIVE_ATESTADOS_FOLDER_ID` / `PULSE_REPOSITORY_FOLDER_ID` | pastas do Drive usadas para upload de atestados / repositório de documentos (`api/repositorio.js`) |
| `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` | `api/auth/drive-token.js`, uma ferramenta manual e pontual que gera um refresh token do Drive e o publica nas variáveis de ambiente da Vercel |
| `IMPORT_TOKEN` | token de autenticação (bearer) do `api/import-escala.js` (padrão `pulse_import_2026`) |

## Arquitetura

### O Google Sheets é o banco de dados

Não existe um banco de dados de verdade — uma única planilha do Google (`GOOGLE_SHEET_ID`) é a fonte da
verdade, acessada pela função `sheetsRequest(sheetId, path, method, body)` de `lib/google-auth.js`
(autenticação via JWT de service account, token cacheado em memória). Cada arquivo `api/*.js` monta seus
próprios wrappers finos `getSheet`/`setSheet`/`appendSheet` em cima dela e lê/escreve abas específicas por
intervalo em notação A1, ex.: `Escala!A2:F2000`. Abas principais:

- **`Equipe`** — cadastro da equipe. **O layout de colunas não é consistente entre os arquivos** — há dois
  esquemas concorrentes, dependendo de quantas colunas o arquivo busca:
  - **9 colunas** (`Equipe!A2:I...`) — usado por `api/equipe.js`, `api/escalas.js`, `api/gerar-escala.js`,
    `api/chat.js`: `0=nome, 1=cargo, 2=nucleo, 3=email, 4=slackId, 5=regime, 6=status, 7=senha (hash),
    8=perfil`.
  - **12/13 colunas** (`Equipe!A2:L...`/`A2:M...`) — usado por `api/app.js` (12, sem a última), `api/
    equipe-view.js`, `api/banco-horas.js`, `lib/solicitar-widget.js` (13): `0=nome, 1=cargo, 2=nucleo,
    3=cpf, 4=rg, 5=nascimento, 6=endereco, 7=senha (hash, não rotulada mas preservada nas escritas),
    8=perfil, 9=email, 10=status, 11=telefone, 12=tipoContrato`.
  - Ou seja: **`perfil` está sempre no índice 8 nos dois esquemas**, mas **`status` está no índice 6 no
    esquema de 9 colunas e no índice 10 no de 12/13** — é o erro mais fácil de cometer ao copiar lógica
    entre arquivos. `api/dashboard.js` e `api/meu-turno.js` usam um terceiro range parcial (`A2:G50`, 7
    colunas) mas só leem `0=nome`/`1=cargo`/`2=nucleo`, que coincidem nos dois esquemas.
  - **Confira sempre o índice de coluna usado no arquivo específico antes de assumir o significado de uma
    coluna** — não cruze índices entre arquivos sem checar. Cada arquivo que faz essa leitura agora tem um
    comentário local documentando o mapeamento exato que ele usa.
- **`Escala`** — a escala de trabalho. Formato da linha: `[data DD/MM, (sem uso), nome, entrada HH:MM,
  saída HH:MM, obs]`, onde `obs` é um de `''`, `Folga`, `Férias`, `Dispensa Médica`, `Gerado IA`,
  `Ajustado IA`. Turnos que viram a meia-noite são representados com `saída < entrada` (veja
  `duracaoTurno`/`estaDeServico` para a matemática de virada de turno, duplicada em vários arquivos).
- **`Ausências`** — solicitações/aprovações de ausência, sempre 6 colunas (`Ausências!A2:F...`, mesmo
  quando algum arquivo busca um range maior tipo `A2:I500` "por segurança" — as colunas depois da F nunca
  são lidas): `0=id/status, 1=nome, 2=tipo, 3=motivo, 4=data início DD/MM, 5=data fim DD/MM`. O prefixo do
  ID (coluna 0) também indica o status: `PLS-...` = pendente, `APROVADO-...` = aprovado, `RECUSADO`/
  `CANCELADO` = estados finais negativos. Todos os arquivos já usam o nome da aba com acento
  (`Ausências`) — a menção antiga a uma variante sem acento em `api/escalas.js` não é mais verdade, foi
  corrigida. Duas inconsistências conhecidas nessa leitura: `api/dashboard.js` não filtra por status ao
  cruzar ausências da semana (uma linha `CANCELADO`/`RECUSADO` entra igual); e `api/escalas.js` tem um
  filtro (`r[8]!=='pendente'` sobre `Equipe`) que compara a coluna de `perfil` com a string `'pendente'` —
  isso nunca é verdadeiro (perfil só vale `gestor`/`colaborador`), então o filtro não exclui ninguém; se a
  intenção era pular colaboradores pendentes, o índice certo seria `6` (esquema de 9 colunas).
- **`PulseConfig`** — planilha genérica de configuração chave/valor (hoje só tem
  `publicacao_horizonte`, o limite DD/MM que controla até quando quem não é gestor pode ver a escala
  publicada). É criada automaticamente na primeira escrita, se não existir (veja o padrão
  criar-aba-e-tentar-de-novo em `api/publicar.js`/`api/setup-config.js`).
- **`Ajustes`** — log de auditoria (só inserção) de edições na escala (quem/o quê/quando), escrito junto de
  toda mutação em `Escala`.
- As checagens de papel/perfil sempre são "procurar a linha do usuário em `Equipe` por nome/email, checar se
  a coluna `perfil`/status é igual a `'gestor'`/`'ativo'`" — não existe uma tabela de papéis separada.

Como tudo é feito com aritmética de índice de linha contra uma planilha viva (`rows.findIndex(...)`,
escrevendo em `Escala!A${idx+2}:F${idx+2}`), edições feitas pela interface, por lógica derivada do Airtable
e por edições manuais na planilha podem entrar em race condition ou ficar dessincronizadas — tome cuidado
com qualquer mudança que assuma que a posição de uma linha permanece estável entre dois `await`.

### Autenticação: sessões via cookie feitas na mão, sem biblioteca

Não há framework de autenticação/biblioteca de JWT para a sessão do portal. `pulse_session` é um cookie com
`base64(payload|sha256(payload+ts+'pulse2026')|timestamp)`, verificado quanto à expiração de 7 dias e à
correspondência da assinatura. **Existem dois formatos de payload incompatíveis em uso**: um mais antigo,
`nome|hash|ts` (`api/equipe.js`, `api/gerar-escala.js`), e um mais novo que suporta um estado intermediário
de OAuth via separadores `~~` (`nome~~accessToken~~refreshToken|hash|ts`, com um prefixo `~~OAUTH~~...`
usado no meio do login, antes do usuário ser associado a uma linha de `Equipe`), usado por `api/app.js` e a
maioria dos outros arquivos. Ao mexer na lógica de sessão, siga o formato mais novo e tenha em mente que os
arquivos antigos não foram migrados.

Fluxo de login: `/api/app` sem cookie válido renderiza uma página "Entrar com Google" → OAuth do Google →
`api/auth/callback.js` troca o código, define um cookie intermediário com prefixo `~~OAUTH~~` → redireciona
para `api/auth/register.js`, que casa o email com `Equipe`. Se encontrado e ativo, troca pelo cookie de
sessão final; se a pessoa é nova, insere uma linha `pendente` e mostra uma página de espera que consulta
`api/auth/check-status.js` periodicamente.

Existem mais dois cookies: `pulse_pending_action` (`api/chat.js`) guarda uma ação de mudança de escala
assinada e com TTL, aguardando a resposta "confirmar"/"cancelar" do usuário — o fluxo de comandos via chat
com IA sempre propõe antes de confirmar, nunca escreve direto.

**Nem toda rota tem o mesmo nível de proteção de autenticação/perfil** — por exemplo, `api/meu-turno.js`
(ver o turno de alguém pelo slug do nome) não tem nenhuma checagem de sessão, e `api/dashboard.js` também
não parece checar se o usuário é gestor. Não assuma que um novo arquivo `api/*.js` está protegido só porque
a maioria dos seus vizinhos está; confira explicitamente.

### Dois provedores de LLM, para tarefas diferentes

- **Groq** (`llama-3.1-8b-instant`, endpoint de chat completions compatível com a API da OpenAI) cuida das
  tarefas de texto rápidas/baratas: Q&A geral no Slack (`api/pulse.js`), interpretação de comando em
  linguagem natural → ação em JSON para o editor de escala via chat (`api/chat.js`), e a "frase do dia"
  motivacional curta (`api/app.js`).
- **A API da Anthropic chamada diretamente** (modelo `claude-haiku-4-5-20251001`, sem SDK — `fetch` cru) é
  usada só em `api/gerar-escala.js`, para o raciocínio mais pesado envolvido na geração de escala assistida
  por IA (preencher buracos de cobertura, sugerir folgas com base em análise de fadiga/dias consecutivos).

### O Airtable é o calendário de eventos ao vivo ("grade")

A grade de transmissão (eventos/jogos individuais ao vivo — separada da escala de *trabalho* em `Escala`)
vive no Airtable (base `appqPBoDUYfX2edOp`, tabela `tblkqT3nDu1Gw6bnf`), lida apenas para leitura via
`fetch` + `filterByFormula`. Praticamente todo dashboard cruza "quem está de plantão" (`Escala`) com "o que
está no ar" (eventos do Airtable) para calcular cobertura — veja
`estaDeServico`/`statusTurno`/`cruzarEventos` em `api/app.js` (duplicadas com pequenas variações em
`api/dashboard.js`, `api/gerar-escala.js`, `api/banco-horas.js`, `api/meu-turno.js`). O `api/monitor.js`
roda num cron da Vercel, compara a grade de amanhã no Airtable com `data/grade_snapshot.json` (que ele
mesmo commita de volta neste repositório via API do GitHub) e posta as mudanças no Slack.

### Motor de regras trabalhistas

`lib/escalas-engine.js` é o único arquivo com funções puras, sem dependência de planilha: matemática de
duração de turno lidando com virada de meia-noite, cálculo de interjornada (descanso entre turnos), e
`analisarDia`/`analisarEscala`, que sinalizam violações da CLT (jornada acima de 10h, falta do intervalo de
1h acima de 8h trabalhadas, interjornada abaixo de 11h, 6º/7º dia consecutivo sem folga). Reaproveite essas
funções em vez de reescrever essa matemática em outro lugar.

### Portal em HTML renderizado no servidor (`api/app.js`, ~1900 linhas)

O maior arquivo do repositório. Ele renderiza documentos HTML completos como strings de template em JS —
sem motor de templates. Convenções a seguir ao mexer nele (ou nos arquivos parecidos `api/equipe-view.js`,
`api/escalas.js`, `api/repositorio.js`, `api/ausencias.js`):

- Um wrapper compartilhado `baseHTML(titulo, conteudo, script)` define o `<head>`/CSS de tema; o tema
  claro/escuro é feito inteiramente com propriedades customizadas de CSS (`--bg`, `--text`, `--card`, ...)
  trocadas sob uma classe `html.dark`, alternada no cliente via `localStorage['pulse-theme']`.
  Strings vindas de usuário interpoladas em HTML precisam passar pelo helper de escape `esc()` definido
  localmente em cada arquivo — não existe um utilitário de escape compartilhado, então, ao criar um novo
  arquivo que renderiza HTML, crie o seu próprio.
- A lógica de negócio que decide o que renderizar (métricas, status por dia, cobertura) é calculada
  **duas vezes**: uma no servidor, para a renderização inicial da página, e outra reimplementada dentro do
  bloco `<script>` inline, para que a navegação entre dia/semana/mês não precise de ida e volta ao servidor.
  Ao mudar uma regra (ex.: o que conta como "de plantão"), procure por todas as reimplementações da mesma
  lógica em JS no lado cliente, no mesmo arquivo — não só a função do servidor.
- A interação é feita via handlers `onclick="..."` inline, não `addEventListener`, e um widget flutuante de
  chat com IA (constante `CHAT_IA`, que faz POST para `/api/chat`) mais um widget de solicitação de ausência
  (`SOLICITAR_BTN`) são adicionados na maioria das páginas autenticadas.
- Datas são em BRT (`America/Sao_Paulo`, UTC-3), calculadas com aritmética manual de offset (`getBRT()`,
  `agoraBrasil()`, `hojeBrasil()`, ou `toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})`) — esse
  padrão é copiado e colado em cada arquivo em vez de compartilhado; não existe biblioteca de timezone. O
  formato canônico de data voltado ao usuário é `DD/MM` (sem o ano — assume-se o ano corrente).

### Scripts pontuais / administrativos

`api/setup-*.js` e `api/fix-gestor.js` são scripts disparados manualmente via GET (protegidos por um
parâmetro de query fixo `?token=pulse_setup_2026`, não ligado a nenhuma variável de ambiente), usados uma
única vez para inicializar abas da planilha e popular dados — não fazem parte do fluxo normal de
requisições e alteram a planilha com valores fixos quando acessados. `api/import-escala.js` é um backfill
pontual parecido, para um intervalo de datas específico. Trate esses arquivos como ferramentas
históricas/de emergência, não como endpoints para evoluir.

## Convenções a seguir

- Commits do git: minúsculo, sem acento, com prefixos no estilo conventional commits (`feat:`, `fix:`,
  `refactor:`), escritos em português, ex.: `fix: usar campo ENCODERS GERAL (via cellFormat=string) em vez
  de Encoder Auxiliar`.
- Siga o formato de cookie de sessão, os índices de coluna da planilha e o estilo de cálculo de data em BRT
  já usados no arquivo que você está editando, em vez de introduzir um padrão novo — este código já tem
  várias convenções concorrentes (veja as seções "Autenticação" e "Google Sheets" acima), e aqui
  consistência dentro do arquivo importa mais que consistência entre arquivos.
- Várias strings mágicas funcionam como segredos informais (salt de sessão `'pulse2026'`, token de setup
  `'pulse_setup_2026'`, token de cron, valor padrão do token de import) — estão hardcoded em vez de virem de
  variáveis de ambiente na maioria dos lugares. Não "conserte" isso como refactor de passagem; trate como
  comportamento existente, a menos que seja pedido explicitamente para mudar.
