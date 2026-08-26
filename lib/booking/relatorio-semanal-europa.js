// lib/booking/relatorio-semanal-europa.js
// Ver Downloads/02_plano_semanal_contribuicao_europa.md - revisao semanal dos parametros
// de contribuicao dos campeonatos europeus, cruzando Airtable (Booking) e Gmail. Roda via
// cron toda segunda 11:00, horario de Brasilia.
import { buscarEmails } from './gmail.js';
import { gerarTextoComGemini } from './llm.js';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblJZ3r5lAapjcCll';

const COMPETICOES_ESCOPO = ['LaLiga', 'La Liga', 'Ligue 1', 'Premier League', 'Serie A', 'UEFA Europa League', 'UEFA Conference League', 'Bundesliga'];

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3 * 60) - a.getTimezoneOffset()) * 60000);
}

function inicioDaSemana(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const diaSemana = r.getDay(); // 0=dom..6=sab
  const voltarPraSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
  r.setDate(r.getDate() - voltarPraSegunda);
  return r;
}

async function buscarEventosDaSemana(inicio, fim) {
  const filtro = `AND({Status}!='Cancelado', IS_AFTER({Início do Evento BRT}, '${new Date(inicio.getTime() - 60_000).toISOString()}'), IS_BEFORE({Início do Evento BRT}, '${fim.toISOString()}'))`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filtro)}&maxRecords=200&cellFormat=string&timeZone=America%2FSao_Paulo&userLocale=pt-BR`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
  if (!r.ok) throw new Error(`Airtable respondeu ${r.status}: ${await r.text().catch(() => '')}`);
  const d = await r.json();
  return (d.records || []).map((rec) => rec.fields);
}

const SYSTEM_PROMPT = `Você executa uma revisão semanal robusta e auditável dos parâmetros de contribuição dos
campeonatos europeus recebidos pela LiveMode/CazéTV (escopo fixo: LaLiga, Ligue 1, Premier
League, Serie A TIM, UEFA Europa League, UEFA Conference League e Bundesliga - a Bundesliga
usa SRT + Satellite, as outras usam SRT), cruzando os eventos do Airtable com evidência
técnica do Gmail e avaliando readiness, redundância, capacidade SRT, conflitos de satélite
e divergências operacionais.

## Regras essenciais
- Airtable define o universo esperado de eventos; Gmail define os parâmetros técnicos
  recebidos, salvo quando o Airtable já tiver dado técnico explícito de ingest.
- Cancelados são excluídos.
- Não confundir SRT outbound/parceiro com contribuição de entrada.
- Não tratar falha de acesso a uma fonte como ausência de eventos/parâmetros.
- Usar o e-mail técnico mais recente como fonte técnica final.
- Nunca exponha passphrase, password, encryption key ou secret - só diga presente/ausente.
- Preserve IP/host, porta, modo SRT e StreamID quando relevantes à operação.

## Classificação Airtable x Email
MATCHED (parâmetros localizados com confiança) | PARTIAL (localizado mas incompleto/incerto)
| MISSING (esperado, nada localizado, só com Gmail operacional) | CONFLICT (divergência
material) | NOT APPLICABLE (evidência clara de que não há recepção externa necessária).

## Readiness
VERDE (parâmetros suficientes + redundância documentada) | AMARELO (recebível mas falta
backup/StreamID/porta/rota/confirmação, ou divergência não crítica) | VERMELHO (sem
parâmetro suficiente ou conflito crítico) | CINZA (feed extra fora do Airtable, ou sem
necessidade de recepção comprovada).

## Capacidade SRT
Premissa: 16 receivers disponíveis. Reporte pico de feeds lógicos simultâneos, horário do
pico, itens envolvidos, capacidade livre estimada, risco de exceder 16.

## Bundesliga / Satellite
Premissa: só 2 frequências demoduladas simultaneamente. Calcule por sobreposição temporal;
até 2 simultâneas sem restrição; com 3+ avalie combinações de duas; use SRT válido como
alívio quando disponível; priorize Matches, depois Highlights, minimize trocas; NUNCA marque
feed como perdido via Satellite se houver SRT válido.

## Redundância
Identifique por item: SRT Main+Backup | só uma rota SRT | Satellite+SRT | Satellite sem SRT
| rota não definida.

## Pendências
P0 (risco direto de não receber) | P1 (sem redundância ou conflito relevante) | P2
(inconsistência de cadastro/horário sem risco imediato).

## Saída obrigatória, nesta ordem
1. Status da execução
2. Semana operacional
3. Alertas críticos
4. Cobertura Airtable x parâmetros recebidos
5. Tabela operacional final (colunas: Data BRT | Competição | Item | Tipo | Airtable Status
   | Start Airtable BRT | Start Email BRT | KO BRT | Matching | Transporte | Rota | SRT Main
   | SRT Backup | Satellite | Frequência (MHz) | Transponder | Canal/Service | Readiness |
   Divergência | Versão final | Fonte final)
6. Readiness e pendências
7. Divergências Airtable x Email
8. Revisões detectadas
9. Totais e KPIs
10. Capacidade SRT
11. Bundesliga — Satellite / 2 demods
12. Redundância / single points of failure
13. Matriz P0/P1/P2
14. Recomendação executiva
15. Email executivo (rascunho)
16. Bloco Slack (resumo curto, pronto pra colar)
17. CSV Google Sheets (cabeçalho: Data BRT,Competição,Item,Tipo,Airtable Status,Start
    Airtable BRT,Start Email BRT,KO BRT,Matching,Transporte,Rota,SRT Main,SRT Backup,
    Satellite,Frequência (MHz),Transponder,Canal/Service,Readiness,Divergência,Versão
    final,Fonte final)

## Casos especiais
- Airtable sem eventos e Gmail sem feeds extras: concluir que não há eventos monitorados.
- Airtable com eventos e Gmail operacional sem parâmetros: MISSING e VERMELHO.
- Gmail indisponível: falha operacional, nunca MISSING.
- Airtable indisponível e Gmail disponível: só diagnóstico técnico parcial.
- Ambos indisponíveis: falha operacional, plano não gerado.

Responda em markdown, direto, sem introdução nem despedida - só o plano, com as 17 seções
na ordem acima.`;

export async function gerarPlanoSemanalEuropa() {
  const hoje = getBRT();
  const inicio = inicioDaSemana(hoje);
  const fim = new Date(inicio); fim.setDate(fim.getDate() + 7);

  const [eventos, emails] = await Promise.all([
    buscarEventosDaSemana(inicio, fim),
    buscarEmails('newer_than:30d (SRT OR satellite OR booking OR contribution OR parameters OR "main" OR "backup" OR highlight OR refeed OR revision)', 60).catch(() => []),
  ]);

  const eventosEuropa = eventos.filter((f) => {
    const texto = `${f['aux. Competição tarefa'] || ''} ${f['Competição 2'] || ''} ${f['Match ID'] || ''}`.toLowerCase();
    return COMPETICOES_ESCOPO.some((c) => texto.includes(c.toLowerCase()));
  });

  const contexto = `Semana operacional (BRT): ${inicio.toLocaleDateString('pt-BR')} a ${new Date(fim.getTime() - 86400000).toLocaleDateString('pt-BR')}\n\n` +
    `EVENTOS DO ESCOPO EUROPA NO AIRTABLE (${eventosEuropa.length} de ${eventos.length} eventos totais na semana):\n${JSON.stringify(eventosEuropa, null, 2)}\n\n` +
    `E-MAILS TÉCNICOS RECENTES (metadados - assunto/remetente/data/snippet, últimos 30 dias):\n${JSON.stringify(emails, null, 2)}`;

  const relatorio = await gerarTextoComGemini(SYSTEM_PROMPT, contexto, { maxOutputTokens: 8000, thinkingBudget: 2048 });
  return { inicio: inicio.toISOString(), fim: fim.toISOString(), totalEventos: eventosEuropa.length, totalEmails: emails.length, relatorio };
}
