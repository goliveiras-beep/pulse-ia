# Pulse IA — LiveMode

IA oficial da LiveMode no Slack, powered by Claude (Anthropic).

## Deploy na Vercel

### 1. Suba o projeto
- Crie um repositório no GitHub e suba esses arquivos
- Acesse vercel.com → "Add New Project" → importe o repositório
- Clique em Deploy

### 2. Configure as variáveis de ambiente
Na Vercel: Settings > Environment Variables

| Variável | Onde encontrar |
|---|---|
| `SLACK_BOT_TOKEN` | api.slack.com/apps > Install App > Bot User OAuth Token |
| `ANTHROPIC_API_KEY` | console.anthropic.com > API Keys |

### 3. Copie a URL do deploy
Após o deploy, a Vercel gera uma URL tipo:
`https://pulse-ia.vercel.app`

Sua Request URL será:
`https://pulse-ia.vercel.app/api/pulse`

### 4. Configure no Slack App
- api.slack.com/apps > seu app > Event Subscriptions
- Cole a Request URL: `https://SEU-PROJETO.vercel.app/api/pulse`
- Em "Subscribe to bot events", adicione: `message.im`
- Salve e reinstale o app

## Como usar
Qualquer pessoa do time manda DM pro app Pulse IA no Slack e recebe resposta do Claude em segundos.
