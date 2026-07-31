# maestro-agent

Agente local que consulta equipamentos via SNMP (na rede interna, onde o MAESTRO
na Vercel não alcança) e manda o status pro painel do MAESTRO.

## Setup

```
cd maestro-agent
npm install
copy .env.example .env
```

Edite `.env` com o `MAESTRO_AGENT_TOKEN` (o mesmo valor configurado na env var
`MAESTRO_AGENT_TOKEN` do projeto Vercel).

Edite `devices.json` com os equipamentos a consultar (`community` é a community
SNMP v2c do equipamento — `public` é só um placeholder até confirmar o valor real).

## Rodar manualmente

```
node agent.js
```

## Agendar (Windows Task Scheduler)

Criar uma tarefa que rode `node agent.js` a cada 5 minutos, com "Start in"
apontando pra essa pasta (`maestro-agent/`) — o script lê `devices.json` e
`.env` relativos à própria localização do arquivo, então o diretório de
trabalho da tarefa não importa, mas o comando precisa apontar pro caminho
completo de `agent.js`.
