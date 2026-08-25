// api/gerar-escala.js — Geração de escala com cobertura inteligente
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../lib/google-auth.js';
import { calcularDia, horasNoturnas, jornadaContratada, feriadosDoAno, duracaoHoras } from '../lib/horas-extras-engine.js';
import { createHash } from 'crypto';

const AIRTABLE_BASE = 'appqPBoDUYfX2edOp';
const AIRTABLE_TABLE = 'tblkqT3nDu1Gw6bnf';
const COOKIE_NAME = 'pulse_session';

function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtData(d) { return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; }
function fmtAirtable(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function toMin(h) { if(!h) return null; const [hh,mm]=h.split(':').map(Number); return hh*60+(mm||0); }
function toHoraBRT(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  d.setHours(d.getHours() - 3);
  return d.toISOString().match(/T(\d{2}:\d{2})/)?.[1] || '';
}

function estaDeServico(ent, sai, horaEv, horaFimEv) {
  if(!ent||!sai||!horaEv) return false;
  const i=toMin(ent), f=toMin(sai), e=toMin(horaEv);
  if (i===null||f===null||e===null) return false;
  const durTurno = f>i ? f-i : (1440-i)+f;
  let offsetInicio = e - i; if (offsetInicio < -60) offsetInicio += 1440;
  let offsetFim = offsetInicio;
  const fimEv = horaFimEv ? toMin(horaFimEv) : null;
  if (fimEv !== null) {
    let durEvento = fimEv - e; if (durEvento < 0) durEvento += 1440;
    offsetFim = offsetInicio + durEvento;
  }
  return offsetInicio >= -60 && offsetFim <= durTurno + 15;
}

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now()-parseInt(ts,10) > 7*24*3600*1000) return null;
    if (h !== hash(data+ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,'PUT',{values});
}
async function appendSheet(range, values) {
  // NÃO usa values.append: a detecção de "tabela" do Sheets erra o alinhamento de colunas
  // quando há qualquer linha desalinhada perto do fim da aba (bug real, gravava a partir da
  // coluna C em vez de A — ver CLAUDE.md changelog 2026-07-11). Calcula a próxima linha vazia
  // explicitamente e grava com update (PUT), que sempre respeita as colunas pedidas.
  const [sheetName, cols] = range.split('!');
  const [colStart, colEnd] = cols.split(':');
  const existing = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(`${sheetName}!${colStart}2:${colEnd}`)}`).then(d=>d.values||[]);
  const nextRow = 2 + existing.length;
  const lastRow = nextRow + values.length - 1;
  await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent(`${sheetName}!${colStart}${nextRow}:${colEnd}${lastRow}`)}?valueInputOption=RAW`, 'PUT', {values});
}

async function getEventosPeriodo(dataInicio, dataFim) {
  const filter = `AND(DATESTR({fldBNl8ypKaV5hFG5})>='${dataInicio}',DATESTR({fldBNl8ypKaV5hFG5})<='${dataFim}')`;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?filterByFormula=${encodeURIComponent(filter)}&maxRecords=300&sort[0][field]=Encerramento&sort[0][direction]=asc`,
      {headers:{Authorization:`Bearer ${process.env.AIRTABLE_API_KEY}`}});
    const d = await r.json();
    return (d.records||[]).map(r=>({
      data: r.fields['Encerramento']?.split('T')[0]||'',
      hora: toHoraBRT(r.fields['Início do Evento BRT']||''),
      horaFim: toHoraBRT(r.fields['Encerramento']||''),
      nome: r.fields['Match ID']||'Evento',
      tipo: r.fields['Tipo de Conteúdo']||'',
    }));
  } catch { return []; }
}

async function ajustarDia(data, eventosDia, escalaCompleta, editaveis) {
  const lacunas = eventosDia.filter(ev => {
    if(!ev.hora) return false;
    return !escalaCompleta.some(p => estaDeServico(p.ent, p.sai, ev.hora, ev.horaFim));
  });

  if(lacunas.length === 0 || editaveis.length === 0) return { escala: escalaCompleta, ajustes: [], lacunasResolvidas: 0 };

  const escalaStr = escalaCompleta.map(p=>`${p.nome}: ${p.ent}–${p.sai}${p.existente?' (já confirmado, NÃO pode mudar)':''}`).join('\n');
  const editaveisStr = editaveis.map(p=>p.nome).join(', ');
  const lacunasStr = lacunas.map(e=>`${e.hora}${e.horaFim?'–'+e.horaFim:''} — ${e.nome} (${e.tipo})`).join('\n');
  const todosStr = eventosDia.map(e=>`${e.hora}${e.horaFim?'–'+e.horaFim:''} — ${e.nome}`).join('\n');

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Você é gestor de operações de TV ao vivo. Para o dia ${data}, há eventos sem cobertura. Sugira o MÍNIMO de ajustes de turno para cobrir as lacunas.

EQUIPE ESCALADA (turno base):
${escalaStr}

PESSOAS QUE PODEM SER AJUSTADAS (as demais já têm escala confirmada e NÃO podem ser alteradas):
${editaveisStr}

TODOS OS EVENTOS DO DIA:
${todosStr}

EVENTOS SEM COBERTURA:
${lacunasStr}

Regras:
- Turno tem 9h (1h intervalo = 8h trabalhadas)
- Só sugira ajustes para pessoas da lista "PESSOAS QUE PODEM SER AJUSTADAS"
- Prefira mudar quem já faz turno mais próximo do horário da lacuna
- Mantenha o mesmo número de horas
- Responda SOMENTE em JSON assim (sem texto extra):
{"ajustes":[{"nome":"Nome Pessoa","entAntes":"HH:MM","saiAntes":"HH:MM","entDepois":"HH:MM","saiDepois":"HH:MM","motivo":"razão curta"}]}`
        }]
      })
    });
    const d = await r.json();
    const txt = d.choices?.[0]?.message?.content?.trim()||'{"ajustes":[]}';
    const clean = txt.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    const editaveisNomes = new Set(editaveis.map(p=>p.nome));
    const ajustes = (parsed.ajustes||[]).filter(a => editaveisNomes.has(a.nome)); // segurança extra: nunca ajustar quem já está confirmado

    const escalaAjustada = escalaCompleta.map(p => {
      if (p.existente) return p; // nunca tocar em quem já tem escala confirmada
      const aj = ajustes.find(a=>a.nome===p.nome);
      if(aj) return { ...p, ent: aj.entDepois, sai: aj.saiDepois, ajustado: true, motivo: aj.motivo, entAntes: aj.entAntes, saiAntes: aj.saiAntes };
      return p;
    });

    return { escala: escalaAjustada, ajustes, lacunasResolvidas: ajustes.length };
  } catch {
    return { escala: escalaCompleta, ajustes: [], lacunasResolvidas: 0 };
  }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  // Equipe (14 col — layout real, ver CLAUDE.md): 0=nome, 8=perfil, 12=tipoContrato (CLT/PJ/Temporário,
  // usado pra cruzar banco de horas). Faixa ampliada de I pra M nesta sessão (31/07/2026) pra dar acesso
  // ao tipo de contrato — antes só ia até I e por isso a análise não conseguia calcular banco/extras.
  // Ausências (range busca 9 col, só 0/1/2/4/5 são usados aqui): 0=id/status, 1=nome, 2=tipo, 4=início DD/MM, 5=fim DD/MM
  // Disponibilidade (5 col, criada em api/equipe-view.js): 0=nome, 1=dia da semana, 2=hora início, 3=hora fim, 4=motivo
  const [equipeRaw, escalaRaw, ausenciasRaw, disponibilidadeRaw] = await Promise.all([
    getSheet('Equipe!A2:M200'),
    getSheet('Escala!A2:F2000'),
    getSheet('Ausências!A2:I500'),
    getSheet('Disponibilidade!A2:E500'),
  ]);
  const restricoesPorNome = {};
  disponibilidadeRaw.filter(r=>r[0]).forEach(r => {
    (restricoesPorNome[r[0]] = restricoesPorNome[r[0]] || []).push({ diaSemana: r[1]||'', horaInicio: r[2]||'', horaFim: r[3]||'', motivo: r[4]||'' });
  });
  const DIAS_SEMANA_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  function turnoSobrepoeJanela(entTurno, saiTurno, entJanela, saiJanela) {
    const toMin = h => { const [hh,mm]=(h||'').split(':').map(Number); return (hh||0)*60+(mm||0); };
    const i1=toMin(entTurno), s1raw=toMin(saiTurno), i2=toMin(entJanela), s2=toMin(saiJanela);
    const s1 = s1raw > i1 ? s1raw : s1raw + 1440; // turno virando a noite
    return i1 < s2 && i2 < s1;
  }
  // Verdadeiro se gerar o turno padrão dessa pessoa nesse dia bateria numa janela de indisponibilidade
  // dela (ex: horário de faculdade) — nesse caso o dia fica em branco de propósito, pra alguém decidir
  // manualmente, em vez de criar um turno que a pessoa não pode cumprir.
  function conflitaComDisponibilidade(nome, dataObj, ent, sai) {
    const restr = restricoesPorNome[nome];
    if (!restr || !restr.length || !ent || !sai) return false;
    const diaSem = DIAS_SEMANA_FULL[dataObj.getDay()];
    return restr.some(r => r.diaSemana === diaSem && turnoSobrepoeJanela(ent, sai, r.horaInicio, r.horaFim));
  }

  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.status(403).json({ error: 'Acesso negado — não é gestor' });

  // Nunca gerar turno por cima de Férias/Folga programada/Atestado/etc já aprovados —
  // essas informações são sempre mais importantes que uma escala gerada automaticamente
  function statusAusencia(id) {
    if (!id) return 'pendente';
    if (id.startsWith('APROVADO')) return 'aprovado';
    if (id === 'RECUSADO') return 'recusado';
    if (id === 'CANCELADO') return 'cancelado';
    return 'pendente';
  }
  function dentroPeriodoAus(ini, fim, df) {
    if (!ini) return false;
    const toNum = s => { const p = s.split('/'); return parseInt(p[1]) * 100 + parseInt(p[0]); };
    const n = toNum(df), i = toNum(ini), f = toNum(fim || ini);
    if (f >= i) return n >= i && n <= f;
    return n >= i || n <= f;
  }
  function temAusenciaAprovada(df, nome) {
    return ausenciasRaw.some(a => a[1]===nome && statusAusencia(a[0])==='aprovado' && dentroPeriodoAus(a[4], a[5], df));
  }

  const hoje = getBRT();
  // Início e fim do período configuráveis via ?inicio=YYYY-MM-DD&fim=YYYY-MM-DD (inputs de data no
  // topo da página) — sem esses parâmetros, mantém o padrão de sempre (amanhã, 14 dias).
  const inicioParam = req.query.inicio;
  const fimParam = req.query.fim;
  const inicio = (inicioParam && /^\d{4}-\d{2}-\d{2}$/.test(inicioParam))
    ? new Date(inicioParam + 'T00:00:00')
    : (() => { const d = new Date(hoje); d.setDate(hoje.getDate() + 1); return d; })();
  const fim = (fimParam && /^\d{4}-\d{2}-\d{2}$/.test(fimParam) && new Date(fimParam + 'T00:00:00') >= inicio)
    ? new Date(fimParam + 'T00:00:00')
    : (() => { const d = new Date(inicio); d.setDate(inicio.getDate() + 13); return d; })();
  // Nº de dias do período (inclusive nas duas pontas) — substitui o "14" fixo de antes em todo loop abaixo.
  const diasSpan = Math.round((fim - inicio) / 86400000) + 1;
  const ativos = equipeRaw.filter(r=>r[0]&&r[6]!=='Inativo');

  // ── Regra fixa: rotação de fim de semana em 2 turmas (decidida com o Guilherme em 20/08/2026) ──
  // Duas turmas alternam Sáb+Dom toda semana (uma trabalha, a outra folga completo, troca na semana
  // seguinte). Carga horária de cada um vem do Tipo de Contrato: Temporário ("LET") = 6h, CLT
  // ("LiveMode") = 8h — com exceção manual pro Thiago (PJ, tratado como LiveMode/8h por decisão do
  // gestor). Se sobrar evento sem ninguém da turma de serviço cobrindo, estica quem é 6h (nunca quem
  // já é 8h) em até 2h, priorizando quem está mais perto do buraco — só então fica "sem cobertura".
  function resolverNomeRotacao(fragmento) {
    const norm = fragmento.toLowerCase();
    const achado = ativos.find(r => r[0] && r[0].toLowerCase().startsWith(norm));
    return achado ? achado[0] : null;
  }
  function cargaContratual(fragmento, excecoes) {
    if (excecoes[fragmento] != null) return excecoes[fragmento];
    const achado = equipeRaw.find(r => r[0] && r[0].toLowerCase().startsWith(fragmento.toLowerCase()));
    return achado?.[12] === 'Temporário' ? 6 : 8;
  }
  const CARGA_EXCECOES_ROTACAO = { 'Thiago': 8 }; // PJ tratado como LiveMode/8h por decisão do gestor
  // Horário-base de cada turma — escalonado pra cobrir ~08h às 00h/02h; é só o ponto de partida,
  // o fallback abaixo ajusta conforme os eventos reais do dia.
  const HORA_BASE_TURMA_A_FRAG = { 'Bernardo': ['08:00','16:00'], 'Rodrigo Cesar': ['13:00','19:00'], 'Fabio': ['15:00','21:00'], 'Thiago': ['16:00','00:00'], 'Alan': ['18:00','00:00'] };
  const HORA_BASE_TURMA_B_FRAG = { 'Lucas': ['08:00','16:00'], 'Rodrigo Alcantara': ['12:00','18:00'], 'Matheus': ['16:00','00:00'], 'Bruno': ['18:00','02:00'] };
  function montarTurma(horaBaseFrag) {
    return Object.entries(horaBaseFrag).map(([frag, horaBase]) => ({
      frag, nome: resolverNomeRotacao(frag), carga: cargaContratual(frag, CARGA_EXCECOES_ROTACAO), horaBase,
    })).filter(p => p.nome);
  }
  const turmaA = montarTurma(HORA_BASE_TURMA_A_FRAG);
  const turmaB = montarTurma(HORA_BASE_TURMA_B_FRAG);
  const nomesRotacao = new Set([...turmaA, ...turmaB].map(p => p.nome));
  const ANCORA_TURMA_A = new Date(2026, 7, 29); // sábado 29/08/2026 — Turma A trabalha esse FDS

  function sabadoDaSemana(d) { const r = new Date(d); if (r.getDay() === 0) r.setDate(r.getDate() - 1); return r; }
  function turmaDoFimDeSemana(d) {
    const sab = sabadoDaSemana(d);
    const diffDias = Math.round((sab - ANCORA_TURMA_A) / 86400000);
    const semanas = Math.round(diffDias / 7);
    return (((semanas % 2) + 2) % 2 === 0) ? 'A' : 'B';
  }
  // Retorna { turmaServico, turmaFolga } nos fins de semana, ou null em dia de semana (a regra não
  // muda nada de segunda a sexta — cada um mantém o turno individual detectado, como já era antes).
  function turmasDoDia(d) {
    if (d.getDay() !== 0 && d.getDay() !== 6) return null;
    const deServico = turmaDoFimDeSemana(d) === 'A' ? turmaA : turmaB;
    const deFolga = deServico === turmaA ? turmaB : turmaA;
    return { deServico, deFolga };
  }
  function toMinRot(h) { const [hh, mm] = h.split(':').map(Number); return hh * 60 + (mm || 0); }
  function fmtMinRot(min) { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  // Calcula o horário final de cada pessoa da turma de serviço num dia específico, esticando os de
  // 6h quando sobra evento sem cobertura — até 3 rodadas (cada rodada resolve pelo menos 1 buraco,
  // sem isso poderia rodar pra sempre se nada mais puder ser esticado).
  function calcularEscalaTurmaDoDia(turmaServico, eventosDoDia) {
    const pessoas = turmaServico.map(p => ({ ...p, ent: p.horaBase[0], sai: p.horaBase[1], estendido: false }));
    const comHorario = eventosDoDia.filter(ev => ev.hora);
    for (let rodada = 0; rodada < 3; rodada++) {
      const semCobertura = comHorario.filter(ev => !pessoas.some(p => estaDeServico(p.ent, p.sai, ev.hora, ev.horaFim)));
      if (!semCobertura.length) break;
      let esticou = false;
      for (const ev of semCobertura) {
        let candidato = null, menorDist = Infinity;
        for (const p of pessoas) {
          if (p.carga !== 6 || p.estendido) continue;
          const dist = Math.abs(toMinRot(ev.hora) - toMinRot(p.sai));
          if (dist <= 180 && dist < menorDist) { menorDist = dist; candidato = p; }
        }
        if (candidato) {
          candidato.sai = fmtMinRot(toMinRot(candidato.sai) + 120); // +2h no fim, nunca mais que isso
          candidato.estendido = true;
          esticou = true;
        }
      }
      if (!esticou) break;
    }
    return pessoas;
  }

  // Início do histórico "completo" — início da Copa 2026, quando a escala virou completa e passou a
  // rodar de verdade (antes disso os dados são esparsos/incompletos). Usado tanto na análise síncrona
  // da página quanto no endpoint assíncrono de folgas — ver conversa com o Guilherme em 31/07/2026.
  const HISTORICO_INICIO = new Date(hoje.getFullYear(), 5, 1); // 01/06
  const diasDesdeInicio = Math.max(1, Math.round((hoje - HISTORICO_INICIO) / 86400000));

  // ── Endpoint de análise assíncrona (chamado pelo cliente em background) ──
  if (req.method === 'GET' && req.query.action === 'analisar') {
    try {
      const existingKeysA = new Set(escalaRaw.filter(r=>r[0]&&r[2]).map(r=>`${r[0]}|${r[2]}`));
      function jaPreenchidoA(df, nome) { return existingKeysA.has(`${df}|${nome}`); }
      const h60dias = new Date(hoje); h60dias.setDate(hoje.getDate()-60);
      // Bug real encontrado em 31/07/2026: comparar "DD/MM" como texto puro (r[0]>=fmtData(...)) dá
      // errado toda vez que a janela cruza um mês — "15/07" vira "maior" que "01/08" como string,
      // porque o dia vem antes do mês no formato. Isso zerava turnosA pra todo mundo sempre que os
      // últimos 60 dias cruzavam 2+ meses. Corrigido comparando por mês*100+dia (numérico).
      const dfParaNum = df => { const p = df.split('/'); return parseInt(p[1],10)*100 + parseInt(p[0],10); };
      const numH60 = dfParaNum(fmtData(h60dias)), numHoje = dfParaNum(fmtData(hoje));
      const escalaTudo = escalaRaw.filter(r=>r[0] && dfParaNum(r[0])>=numH60 && dfParaNum(r[0])<=numHoje);
      const escalaHistA = escalaTudo.filter(r=>r[3]&&r[4]&&r[5]!=='Folga');
      const turnosA = {};
      ativos.forEach(p => {
        const regs = escalaHistA.filter(r=>r[2]===p[0]);
        if(!regs.length) { turnosA[p[0]]=null; return; }
        const freq={};
        regs.forEach(r=>{const k=`${r[3]}|${r[4]}`;freq[k]=(freq[k]||0)+1;});
        const [ent,sai] = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
        turnosA[p[0]] = { ent, sai };
      });
      // Histórico completo desde HISTORICO_INICIO (01/06 — ver topo da função) — não só 60 dias. Dá
      // pra IA visão real de quem já folgou muito/pouco e quem já acumulou banco/hora extra.
      // Map em vez de escalaRaw.find() repetido — evita varrer ~740 linhas a cada um dos ~62 dias x
      // ~13 pessoas (o scan linear repetido foi o que causou timeout na primeira versão desta análise).
      const escalaMapA = new Map();
      escalaRaw.forEach(r => { if (r[0] && r[2]) escalaMapA.set(`${r[0]}|${r[2]}`, r); });
      const ausenciasAprovadasA = ausenciasRaw.filter(a => statusAusencia(a[0])==='aprovado');
      const ausenciasPorPessoaA = {};
      ativos.forEach(p => { ausenciasPorPessoaA[p[0]] = ausenciasAprovadasA.filter(a => a[1]===p[0]); });
      function tipoAusenciaAprovadaNoDia(df, nome) {
        const a = (ausenciasPorPessoaA[nome]||[]).find(a => dentroPeriodoAus(a[4], a[5], df));
        return a ? a[2] : null;
      }
      const historicoA = {};
      ativos.filter(p=>turnosA[p[0]]).forEach(p => {
        const tipoContrato = p[12] || '';
        let diasTrabalhados=0, diasFolga=0, diasOutraAusencia=0, diasDesdeUltimaFolga=diasDesdeInicio;
        let bancoAcum=0, extra100Acum=0, extra50Acum=0, noturnoAcum=0;
        for (let i=diasDesdeInicio; i>=0; i--) {
          const d=new Date(hoje); d.setDate(hoje.getDate()-i);
          const df=fmtData(d);
          const reg = escalaMapA.get(`${df}|${p[0]}`);
          const tipoAus = tipoAusenciaAprovadaNoDia(df, p[0]);
          const isFolga = (reg && (reg[5]==='Folga'||reg[5]==='Folga/Ausente')) || tipoAus==='Folga programada' || tipoAus==='Folga direcionada';
          if (isFolga) { diasFolga++; diasDesdeUltimaFolga = i; }
          else if (tipoAus==='Férias' || tipoAus==='Atestado médico' || tipoAus==='Troca de horário') { diasOutraAusencia++; }
          else if (reg && reg[3] && reg[4]) {
            diasTrabalhados++;
            if (tipoContrato) {
              const durBruta = duracaoHoras(reg[3], reg[4]);
              const semBanco = d.getDay()===0 || feriadosDoAno(d.getFullYear()).has(df);
              const calc = calcularDia(durBruta, tipoContrato, semBanco);
              bancoAcum += calc.banco; extra100Acum += calc.extra100; extra50Acum += calc.extra50;
              noturnoAcum += horasNoturnas(reg[3], reg[4]) * 0.20;
            }
          }
        }
        historicoA[p[0]] = {
          consecutivos: diasDesdeUltimaFolga, diasTrabalho: diasTrabalhados, totalDiasHistorico: diasDesdeInicio,
          diasFolga, diasOutraAusencia,
          bancoAcum: Math.round(bancoAcum*10)/10, extra100Acum: Math.round(extra100Acum*10)/10,
          extra50Acum: Math.round(extra50Acum*10)/10, noturnoAcum: Math.round(noturnoAcum*10)/10,
          extrasTotal: Math.round((extra100Acum+extra50Acum+noturnoAcum)*10)/10,
          semTipoContrato: !tipoContrato,
        };
      });
      const fadigaA = historicoA; // nome mantido pra compatibilidade com o retorno do endpoint
      // Carga de eventos Airtable
      const eventosA = await getEventosPeriodo(fmtAirtable(inicio), fmtAirtable(fim));
      const cargaPorDia = [];
      for(let i=0;i<diasSpan;i++) {
        const d=new Date(inicio); d.setDate(inicio.getDate()+i);
        const df=fmtData(d); const dataAT=fmtAirtable(d);
        cargaPorDia.push({df, diaSem:['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()], eventos:eventosA.filter(e=>e.data===dataAT).length});
      }
      // Chamada IA para folgas — agora com o histórico completo desde 01/06 (dias trabalhados, folgas
      // já tiradas, banco de horas e hora extra acumulados), não só um resumo de 60 dias.
      // Pessoas identificadas por ID numérico no prompt (não por nome): o modelo pequeno da Groq não
      // segue de forma confiável "responda com o nome completo" — devolvia só o primeiro nome (ex:
      // "Rodrigo"), ambíguo entre Rodrigo Alcantara e Rodrigo Cesar. ID elimina essa ambiguidade.
      const listaPessoasA = ativos.filter(p=>turnosA[p[0]]);
      const fadigaResumo = listaPessoasA.map((p,idx)=>{
        const f=historicoA[p[0]]||{};
        return `${idx+1}. ${p[0]}: ${f.consecutivos||0} dias sem folga agora, ${f.diasTrabalho||0} trabalhados / ${f.diasFolga||0} folgas desde 01/06 (${f.totalDiasHistorico} dias de histórico), banco+extras acumulados: ${f.extrasTotal||0}h${f.semTipoContrato?' (sem tipo de contrato — extras não calculados)':''}`;
      }).join('\n');
      const cargaResumo = cargaPorDia.map(d=>`${d.df}(${d.diaSem}):${d.eventos}ev`).join(' ');
      // Chamada de IA isolada no seu próprio try/catch — se ela falhar ou vier com JSON malformado
      // (modelo pequeno, acontece), o histórico real (fadigaA/turnos/cargaPorDia) já calculado acima
      // ainda é devolvido normalmente; só a sugestão de folga fica vazia com erroIA preenchido. Antes
      // um erro aqui derrubava a resposta inteira com 500, escondendo até os dados reais da tela.
      let folgas = [], erroIA = null;
      try {
        const rFolga = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.GROQ_API_KEY}`},
          body:JSON.stringify({model:'openai/gpt-oss-20b',max_tokens:1000,messages:[{role:'user',content:`Gestor de TV ao vivo, Copa do Mundo 2026. Sugira folgas para os próximos ${diasSpan} dias, começando em ${fmtData(inicio)}.

EQUIPE (ID. Nome: histórico desde 01/06):
${fadigaResumo}

CARGA DE EVENTOS NO PERÍODO: ${cargaResumo}

REGRAS (em ordem de prioridade):
1. Quem tem mais "banco+extras acumulados" e mais "dias sem folga agora" tem prioridade pra folgar primeiro — está pagando um débito real de horas.
2. Meta: pelo menos 1 folga a cada 7 dias corridos pra cada pessoa dentro do período — ninguém deve terminar o período tão sem-folga quanto começou.
3. Quem já tem MUITAS folgas acumuladas desde 01/06 em relação ao histórico total (>30% dos dias) pode folgar menos agora — distribuir de forma justa ao longo do tempo, não só olhando o período atual.
4. Não mais de 30% da equipe de folga no mesmo dia.
5. Dias com mais de 8 eventos: evitar folgar quem cobre horário noturno.

Identifique cada pessoa pelo ID numérico da lista acima, NUNCA pelo nome. Responda SOMENTE JSON, compacto, sem texto antes/depois. "motivo" no máximo 6 palavras:
{"folgas":[{"id":3,"data":"DD/MM","motivo":"razão curta"}]}`}]})
        });
        const dFolga = await rFolga.json();
        if (!rFolga.ok || dFolga.error) {
          erroIA = dFolga.error?.message || `Erro ${rFolga.status} na chamada à IA`;
        } else {
          const txt = dFolga.choices?.[0]?.message?.content?.trim()||'{"folgas":[]}';
          const parsed = JSON.parse(txt.replace(/```json|```/g,'').trim());
          folgas = (parsed.folgas||[])
            .map(f => ({ nome: listaPessoasA[(f.id|0)-1]?.[0], data: f.data, motivo: f.motivo }))
            .filter(f => f.nome && f.data && !jaPreenchidoA(f.data, f.nome));
        }
      } catch(eIA) {
        erroIA = 'Resposta da IA em formato inválido: ' + eIA.message;
      }
      return res.status(200).json({ ok:true, fadiga:fadigaA, folgas, cargaPorDia, turnos:turnosA, erroIA });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Normaliza data para DD/MM independente do formato
  function normalizarDf(raw) {
    if(!raw) return '';
    const s = String(raw).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) { const p=s.split('-'); return p[2].slice(0,2).padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
    if(/^\d{1,2}\/\d{1,2}/.test(s)) { const p=s.split('/'); return p[0].padStart(2,'0')+'/'+p[1].padStart(2,'0'); }
    return s;
  }

  // Normaliza todo escalaRaw de uma vez
  const escalaNorm = escalaRaw.map(r => [normalizarDf(r[0]||''), r[1]||'', r[2]||'', r[3]||'', r[4]||'', r[5]||'']);

  // ExistingKeys com datas normalizadas
  const existingKeysNorm = new Set(escalaNorm.filter(r=>r[0]&&r[2]).map(r=>`${r[0]}|${r[2]}`));
  function jaPreenchido(df, nome) { return existingKeysNorm.has(`${normalizarDf(df)}|${nome}`); }

  // Detectar turno de cada pessoa: pega o ÚLTIMO turno registrado (sem filtro de data)
  // Itera de trás pra frente para pegar o mais recente
  const turnos = {};
  const escalaNormRev = [...escalaNorm].reverse();
  ativos.forEach(p => {
    // Busca última entrada com horários definidos e não folga
    const reg = escalaNormRev.find(r => r[2]===p[0] && r[3] && r[4] && r[5]!=='Folga' && r[5]!=='Férias' && r[5]!=='Dispensa Médica');
    if(!reg) { turnos[p[0]] = null; return; }
    // Para copa do mundo, verificar se tem padrão mais frequente nos últimos 30 registros
    const regsRecentes = escalaNorm.filter(r=>r[2]===p[0]&&r[3]&&r[4]&&r[5]!=='Folga').slice(-30);
    if(regsRecentes.length >= 3) {
      const freq={};
      regsRecentes.forEach(r=>{const k=`${r[3]}|${r[4]}`;freq[k]=(freq[k]||0)+1;});
      const [ent,sai] = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
      turnos[p[0]] = { ent, sai };
    } else {
      turnos[p[0]] = { ent: reg[3], sai: reg[4] };
    }
  });

  // Fadiga: contar dias trabalhados desde HISTORICO_INICIO (01/06) usando datas normalizadas —
  // mesma janela usada no endpoint assíncrono de folgas, pra não ter dois números diferentes na tela.
  function dfParaData(df) {
    const p = df.split('/');
    return new Date(hoje.getFullYear(), parseInt(p[1])-1, parseInt(p[0]));
  }
  function dentroJanela(df) {
    try { const dt=dfParaData(df); return dt>=HISTORICO_INICIO&&dt<=hoje; } catch { return false; }
  }
  const escalaTudo = escalaNorm.filter(r=>r[0]&&dentroJanela(r[0]));

  function calcularFadiga(nomePessoa) {
    let consecutivos=0, totalDiasHistorico=0, folgasHistorico=0;
    for(let i=0;i<=diasDesdeInicio;i++) {
      const d=new Date(hoje); d.setDate(hoje.getDate()-i);
      const df=fmtData(d);
      const reg=escalaTudo.find(r=>r[0]===df&&r[2]===nomePessoa);
      if(!reg) continue;
      totalDiasHistorico++;
      if(reg[5]==='Folga'||(!reg[3]&&!reg[4])) folgasHistorico++;
    }
    consecutivos=0;
    for(let i=0;i<=diasDesdeInicio;i++) {
      const d=new Date(hoje); d.setDate(hoje.getDate()-i);
      const df=fmtData(d);
      const reg=escalaTudo.find(r=>r[0]===df&&r[2]===nomePessoa);
      if(!reg) break;
      if(reg[5]==='Folga'||(!reg[3]&&!reg[4])) break;
      consecutivos++;
    }
    return { consecutivos, totalDiasHistorico, folgasHistorico, diasTrabalho: totalDiasHistorico-folgasHistorico };
  }

  const fadiga = {};
  ativos.filter(p=>turnos[p[0]]).forEach(p=>{ fadiga[p[0]] = calcularFadiga(p[0]); });

  if (req.method === 'POST' && req.query.action === 'quick') {
    try {
      const escalaAtual = await getSheet('Escala!A2:F2000');
      const escalaNormQ = escalaAtual.map(r => [normalizarDf(r[0]||''), r[1]||'', r[2]||'', r[3]||'', r[4]||'', r[5]||'']);
      const existingQ = new Set(escalaNormQ.filter(r=>r[0]&&r[2]).map(r=>`${r[0]}|${r[2]}`));
      // Detecta turno de cada ativo
      const turnosQ = {};
      const revQ = [...escalaNormQ].reverse();
      ativos.forEach(p => {
        const regsP = escalaNormQ.filter(r=>r[2]===p[0]&&r[3]&&r[4]&&r[5]!=='Folga'&&r[5]!=='Férias').slice(-30);
        if(!regsP.length){ const last=revQ.find(r=>r[2]===p[0]&&r[3]&&r[4]); turnosQ[p[0]]=last?{ent:last[3],sai:last[4]}:null; return; }
        const freq={};
        regsP.forEach(r=>{const k=r[3]+'|'+r[4];freq[k]=(freq[k]||0)+1;});
        const best=Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0].split('|');
        turnosQ[p[0]]={ent:best[0],sai:best[1]};
      });
      const linhas=[];
      for(let i=1;i<=14;i++){
        const d=new Date(hoje); d.setDate(hoje.getDate()+i);
        const df=fmtData(d);
        ativos.forEach(p=>{
          const t=turnosQ[p[0]];
          if(!t) return;
          if(existingQ.has(df+'|'+p[0])) return;
          if(temAusenciaAprovada(df,p[0])) return;
          linhas.push([df,'',p[0],t.ent,t.sai,'Gerado IA']);
        });
      }
      if(linhas.length===0) return res.status(200).json({ok:true,gravadas:0,mensagem:'Todos os dias já preenchidos'});
      await appendSheet('Escala!A:F', linhas);
      return res.status(200).json({ok:true, gravadas:linhas.length});
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  if (req.method === 'POST') {
    try {
      // Revalida contra a planilha mais recente no momento da gravação, para garantir que nada seja sobrescrito
      const escalaAtual = await getSheet('Escala!A2:F2000');
      const existingKeysAgora = new Set(escalaAtual.filter(r=>r[0]&&r[2]).map(r=>`${r[0]}|${r[2]}`));
      const body = req.body||{};
      // Força a regra de rotação de FDS a sobrescrever linha já existente das 9 pessoas da rotação —
      // opção explícita (checkbox na tela), usada só quando o fim de semana já tinha dado antigo
      // bloqueando a regra nova. Ausência aprovada (ex: Folga Programada) nunca é sobrescrita, com
      // ou sem essa opção — ver temAusenciaAprovada abaixo, que roda sempre primeiro.
      const forcarRotacao = !!body.forcarRotacao;
      let eventosRotacao = [];
      try { eventosRotacao = await getEventosPeriodo(fmtAirtable(inicio), fmtAirtable(fim)); } catch {}
      const linhasNovas = [];
      const linhasAtualizar = [];
      for(let i=0;i<diasSpan;i++){
        const d=new Date(inicio); d.setDate(inicio.getDate()+i);
        const df=fmtData(d);
        const turmasHoje = turmasDoDia(d);
        const escalaTurmaHoje = turmasHoje
          ? calcularEscalaTurmaDoDia(turmasHoje.deServico, eventosRotacao.filter(ev => ev.data === fmtAirtable(d)))
          : null;
        ativos.forEach(p=>{
          if (temAusenciaAprovada(df,p[0])) return;
          const ehRotacao = turmasHoje && nomesRotacao.has(p[0]);
          const jaTemLinha = existingKeysAgora.has(`${df}|${p[0]}`);
          if (jaTemLinha && !(ehRotacao && forcarRotacao)) return;
          // Regra de rotação de fim de semana — só pra quem está numa das 2 turmas, só sáb/dom.
          if (ehRotacao) {
            let linha = null;
            if (turmasHoje.deFolga.some(m => m.nome === p[0])) {
              linha = [df,'',p[0],'','','Folga'];
            } else {
              const pessoa = escalaTurmaHoje.find(m => m.nome === p[0]);
              if (pessoa && !conflitaComDisponibilidade(p[0], d, pessoa.ent, pessoa.sai)) {
                linha = [df,'',p[0], pessoa.ent, pessoa.sai, pessoa.estendido ? 'Rotação FDS (+2h)' : 'Rotação FDS'];
              }
            }
            if (!linha) return;
            if (jaTemLinha) {
              const idx = escalaAtual.findIndex(r => r[0]===df && r[2]===p[0]);
              if (idx >= 0) linhasAtualizar.push({ linha: idx + 2, valores: linha });
            } else {
              linhasNovas.push(linha);
            }
            return;
          }
          const t=turnos[p[0]];
          if(!t) return;
          const key = `${df}|${p[0]}`;
          const aj = body.ajustes?.[key];
          // Verificar se é uma folga sugerida pela IA
          const folgaSugerida = (body.folgas||[]).find(f=>f.nome===p[0]&&f.data===df);
          if(folgaSugerida) {
            linhasNovas.push([df,'',p[0],'','','Folga']);
          } else {
            const entFinal = aj?aj.ent:t.ent, saiFinal = aj?aj.sai:t.sai;
            // Bate com uma janela de indisponibilidade (ex: aula) dessa pessoa nesse dia da semana —
            // não grava nada, deixa o dia em branco de propósito pra alguém resolver manualmente em
            // vez de criar um turno que ela não pode cumprir.
            if (conflitaComDisponibilidade(p[0], d, entFinal, saiFinal)) return;
            linhasNovas.push([df,'',p[0], entFinal, saiFinal, aj?'Ajustado IA':'Gerado IA']);
          }
        });
      }
      if (linhasNovas.length === 0 && linhasAtualizar.length === 0) {
        return res.status(200).json({ ok:true, gravadas:0, mensagem:'Nada novo para gravar — todos os dias já estavam preenchidos.' });
      }
      // Atualiza linha por linha as que já existiam (só entra aqui com forcarRotacao ligado)
      for (const { linha, valores } of linhasAtualizar) {
        await setSheet(`Escala!A${linha}:F${linha}`, [valores]);
      }
      // Só ADICIONA as linhas novas, nunca substitui o intervalo existente
      if (linhasNovas.length) await appendSheet('Escala!A:F', linhasNovas);
      return res.status(200).json({ ok:true, gravadas:linhasNovas.length, atualizadas:linhasAtualizar.length });
    } catch(e) {
      return res.status(500).json({error:e.message});
    }
  }

  try {
  // Eventos do Airtable carregados de forma lazy (não bloqueia o carregamento da página)
  let eventos = [];
  try { eventos = await getEventosPeriodo(fmtAirtable(inicio), fmtAirtable(fim)); } catch(e) { console.warn('Airtable indisponível:', e.message); }

  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const diasProcessados = [];
  let totalLacunas = 0, totalAjustes = 0, totalJaPreenchidos = 0;

  for(let i=0;i<diasSpan;i++){
    const d = new Date(inicio); d.setDate(inicio.getDate()+i);
    const df = fmtData(d);
    const dataAT = fmtAirtable(d);
    const evsDia = eventos.filter(e=>e.data===dataAT);
    const isFds = d.getDay()===0||d.getDay()===6;

    // Escala existente — usa escalaNorm para garantir formato consistente
    const escalaExistente = escalaNorm
      .filter(r => r[0]===df && r[2] && ativos.some(p=>p[0]===r[2]))
      .map(r => ({ nome:r[2], ent:r[3]||'', sai:r[4]||'', obs:r[5]||'', existente:true }));

    // Pendentes: ativos com turno identificado, sem nada na planilha, sem ausência aprovada nesse dia,
    // e sem bater numa janela de indisponibilidade (ex: faculdade) — esses ficam de fora do preview
    // porque também não serão gravados (ver ?action=POST acima). Quem está numa das 2 turmas de
    // rotação de fim de semana usa a regra própria (folga completa ou horário calculado da turma
    // de serviço) em vez do turno individual detectado — só sáb/dom, sem afetar dia de semana.
    const turmasHoje = turmasDoDia(d);
    const escalaTurmaHoje = turmasHoje ? calcularEscalaTurmaDoDia(turmasHoje.deServico, evsDia) : null;

    const escalaPendenteNormal = ativos
      .filter(p=>!nomesRotacao.has(p[0]) && turnos[p[0]] && !jaPreenchido(df, p[0]) && !temAusenciaAprovada(df, p[0]) && !conflitaComDisponibilidade(p[0], d, turnos[p[0]].ent, turnos[p[0]].sai))
      .map(p=>({nome:p[0], ent:turnos[p[0]].ent, sai:turnos[p[0]].sai, existente:false}));

    const escalaPendenteRotacao = [];
    if (turmasHoje) {
      turmasHoje.deFolga.forEach(m => {
        if (!jaPreenchido(df, m.nome) && !temAusenciaAprovada(df, m.nome)) {
          escalaPendenteRotacao.push({ nome: m.nome, ent: '', sai: '', existente: false });
        }
      });
      escalaTurmaHoje.forEach(pessoa => {
        if (!jaPreenchido(df, pessoa.nome) && !temAusenciaAprovada(df, pessoa.nome) && !conflitaComDisponibilidade(pessoa.nome, d, pessoa.ent, pessoa.sai)) {
          escalaPendenteRotacao.push({ nome: pessoa.nome, ent: pessoa.ent, sai: pessoa.sai, existente: false });
        }
      });
    }

    const escalaPendente = [...escalaPendenteNormal, ...escalaPendenteRotacao];
    const escalaCompleta = [...escalaExistente, ...escalaPendente];

    const lacunasAntes = evsDia.filter(ev=>ev.hora&&!escalaCompleta.some(p=>p.ent&&p.sai&&estaDeServico(p.ent,p.sai,ev.hora,ev.horaFim)));
    totalLacunas += lacunasAntes.length;
    totalJaPreenchidos += escalaExistente.length;

    let resultado = { escala: escalaCompleta, ajustes: [], lacunasResolvidas: 0 };
    // Ajuste por IA removido do carregamento inicial — feito via endpoint async

    diasProcessados.push({
      d, df, dataAT, evsDia, isFds,
      diaSem: DIAS_PT[d.getDay()],
      escala: resultado.escala,
      ajustes: resultado.ajustes,
      lacunasAntes: lacunasAntes.length,
      lacunasResolvidas: 0,
    });
  }

  const ajustesJSON = {};
  diasProcessados.forEach(dia => {
    dia.escala.forEach(p => {
      if(p.ajustado) ajustesJSON[`${dia.df}|${p.nome}`] = {ent:p.ent, sai:p.sai};
    });
  });

  // sugestoesJSON vazio — folgas sugeridas carregam assincronamente via ?action=analisar
  const sugestoesJSON = {};
  const sugestoesTexto = '[]';

  const totalAGravar = diasProcessados.reduce((s,dia) => s + dia.escala.filter(p=>!p.existente).length, 0);

  // Cabeçalho da tabela — uma coluna por colaborador com turno detectado (mesma ordem das linhas)
  const cabecalho = ativos.filter(p=>turnos[p[0]]).map(p=>
    `<th style="padding:6px 8px;text-align:center;font-size:9px;font-weight:600;color:var(--text3);text-transform:uppercase;background:var(--input);border-bottom:1px solid var(--border);white-space:nowrap">${p[0].split(' ')[0]}</th>`
  ).join('');

  // Painel de fadiga por pessoa
  const fadigaCards = ativos.filter(p=>turnos[p[0]]).map(p=>{
    const f = fadiga[p[0]]||{};
    const nivel = f.consecutivos>=7?'red':f.consecutivos>=5?'amber':'green';
    const cores = {red:['#1f1010','#991b1b','#fc8181'],amber:['#1f1a0d','#3d3010','#f6ad55'],green:['#0d2010','#166534','#68d391']};
    const [bg,border,cor] = cores[nivel];
    const folgas14 = diasProcessados.filter(dia => sugestoesJSON[`${dia.df}|${p[0]}`]).map(dia=>dia.df);
    return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px">
      <div style="font-size:18px">${nivel==='red'?'🔴':nivel==='amber'?'🟡':'🟢'}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${p[0].split(' ')[0]}</div>
        <div style="font-size:10px;color:${cor}">${f.consecutivos||0} dias seguidos · ${f.diasTrabalho||0} trab. / ${f.folgasHistorico||0} folgas desde 01/06</div>
        ${folgas14.length?`<div style="font-size:9px;color:#68d391;margin-top:2px">💤 Folgas sugeridas: ${folgas14.join(', ')}</div>`:''}
      </div>
    </div>`;
  }).join('');

  // Integrar folgas sugeridas na tabela (marcadas em roxo)
  const linhasTabelaComFolgas = diasProcessados.map(dia => {
    const pessoasHtml = ativos.filter(p=>turnos[p[0]]).map(p=>{
      const esc = dia.escala.find(e=>e.nome===p[0]);
      const folgaSugerida = sugestoesJSON[`${dia.df}|${p[0]}`];
      if(folgaSugerida) return `<td style="padding:4px 6px;text-align:center;font-size:10px;font-weight:600;background:#1a0d2e">
        <div style="color:#c084fc">💤 Folga</div>
        <div style="font-size:8px;color:#9f7aea">${folgaSugerida.motivo||'IA'}</div>
      </td>`;
      if(!esc || (!esc.ent && !esc.sai)) return `<td data-df="${dia.df}" data-nome="${p[0]}" style="padding:4px 6px;text-align:center;font-size:10px;color:var(--text3)">—</td>`;
      const ajustado = esc.ajustado;
      const jaExistia = esc.existente;
      return `<td data-df="${dia.df}" data-nome="${p[0]}" style="padding:4px 6px;text-align:center;font-size:10px;font-weight:600;white-space:nowrap;${ajustado?'background:var(--ajustado-bg);':jaExistia?'background:var(--muted);':''}">
        ${ajustado?`<div style="font-size:9px;color:var(--text3);text-decoration:line-through">${esc.entAntes}–${esc.saiAntes}</div>`:''}
        <div style="color:${ajustado?'#f6ad55':jaExistia?'var(--text2)':'#7dd3fc'}">${esc.ent}–${esc.sai}</div>
        ${ajustado?`<div style="font-size:8px;color:#f6ad55">✱ ajustado</div>`:''}
        ${jaExistia?`<div style="font-size:8px;color:var(--text3)">já preenchido</div>`:''}
      </td>`;
    }).join('');
    const lacunasRestantes = dia.lacunasAntes - dia.lacunasResolvidas;
    return `<tr style="background:${dia.isFds?'var(--fds-bg)':''}">
      <td style="padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap">
        <div style="font-size:11px;font-weight:700;color:${dia.isFds?'#f6ad55':'var(--text)'}">${dia.diaSem} ${dia.df}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:1px">${dia.evsDia.length} eventos${dia.evsDia[0]?' · '+dia.evsDia[0].hora:''}</div>
        ${dia.ajustes.length>0?`<div style="font-size:9px;color:#f6ad55;margin-top:1px">✱ ${dia.ajustes.length} ajuste${dia.ajustes.length>1?'s':''}</div>`:''}
        ${lacunasRestantes>0?`<div style="font-size:9px;color:#fc8181;margin-top:1px">⚠ ${lacunasRestantes} sem cobertura</div>`:''}
      </td>
      ${pessoasHtml}
    </tr>`;
  }).join('');

  const ajustesResumoHtml = diasProcessados.filter(d=>d.ajustes.length>0).map(dia=>
    dia.ajustes.map(aj=>`
      <div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start">
        <div style="min-width:60px;font-size:10px;font-weight:600;color:var(--text2)">${dia.df}</div>
        <div>
          <div style="font-size:11px;color:var(--text)"><span style="color:#f6ad55;font-weight:600">${aj.nome}</span> · <span style="text-decoration:line-through;color:var(--text3)">${aj.entAntes}–${aj.saiAntes}</span> → <span style="color:#f6ad55;font-weight:700">${aj.entDepois}–${aj.saiDepois}</span></div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${aj.motivo}</div>
        </div>
      </div>`).join('')
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Gerar Escala IA</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#e53e3e">
<style>
:root{--bg:#f5f5f5;--header:#1a1a1a;--card:#fff;--border:#e5e5e5;--text:#1a1a1a;--text2:#555;--text3:#888;--input:#fff;--btn-border:#ccc;--muted:#f0f0f0;--fds-bg:#fff7ed;--ajustado-bg:#fffbeb;}
html.dark{--bg:#1c1f26;--header:#161920;--card:#242836;--border:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--input:#1e2230;--btn-border:#3d4660;--muted:#10131a;--fds-bg:#1a1f2e;--ajustado-bg:#1f1a0d;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
</style>
</head><body>
<div style="background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100;border-bottom:1px solid var(--border)">
  <a href="/api/escalas?v=semana" style="width:28px;height:28px;background:var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text);font-size:12px;font-weight:700;text-decoration:none">P</a>
  <div>
    <div style="font-size:14px;font-weight:600;color:#fff">Pulse — Escala IA ✨</div>
    <div style="font-size:11px;color:var(--text3)">${fmtData(inicio)} a ${fmtData(fim)} · ${totalAjustes} ajustes automáticos · ${totalJaPreenchidos} já preenchidos (preservados) · ${totalLacunas - totalAjustes > 0 ? (totalLacunas - totalAjustes)+' lacunas restantes' : 'cobertura completa ✓'}</div>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
    <label style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:4px">De:
      <input type="date" id="inpInicio" value="${fmtAirtable(inicio)}" style="background:var(--card);border:1px solid var(--btn-border);border-radius:5px;padding:3px 6px;font-size:11px;color:var(--text);font-family:inherit" onchange="mudarPeriodo()">
    </label>
    <label style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:4px">até:
      <input type="date" id="inpFim" value="${fmtAirtable(fim)}" style="background:var(--card);border:1px solid var(--btn-border);border-radius:5px;padding:3px 6px;font-size:11px;color:var(--text);font-family:inherit" onchange="mudarPeriodo()">
    </label>
    <button id="tt" onclick="toggleTheme()" style="border:1px solid var(--btn-border);border-radius:5px;padding:3px 8px;font-size:14px;background:none;cursor:pointer">&#127769;</button>
    <a href="/api/escalas?v=semana" style="background:none;border:1px solid var(--btn-border);border-radius:5px;padding:4px 10px;font-size:11px;color:var(--text2);text-decoration:none">← Escala</a>
  </div>
</div>
<div style="max-width:1400px;margin:0 auto;padding:16px 20px">
  <div style="background:#1a2744;border:1px solid #2a4080;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#93c5fd">
    ℹ️ A geração nunca sobrescreve o que já está preenchido. Dias marcados como <span style="color:var(--text2);font-weight:600">"já preenchido"</span> são preservados.
  </div>
  ${totalAGravar === 0 ? `<div style="background:#1f1010;border:1px solid #991b1b;border-radius:8px;padding:12px 16px;margin-bottom:14px">
    <div style="font-weight:700;color:#fc8181;margin-bottom:6px">⚠️ Nenhum turno para gerar</div>
    <div style="font-size:12px;color:#fc8181">
      Histórico detectado: <strong>${escalaNorm.filter(r=>r[2]&&r[3]&&r[4]).length} linhas</strong> no total.
      Colaboradores com turno identificado: <strong>${Object.values(turnos).filter(Boolean).length}/${ativos.length}</strong>.<br>
      ${escalaNorm.filter(r=>r[2]&&r[3]&&r[4]).length === 0 ? '👉 Execute o <a href="/api/import-escala" style="color:#fca5a5">import da escala</a> de junho primeiro.' : ''}
      ${Object.values(turnos).filter(Boolean).length === 0 && escalaNorm.length > 0 ? '👉 Dados encontrados mas turno não identificado. Primeiras datas: '+escalaNorm.slice(0,3).map(r=>r[0]).join(', ') : ''}
    </div>
  </div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Dias gerados</div><div style="font-size:24px;font-weight:700">${diasSpan}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${fmtData(inicio)} → ${fmtData(fim)}</div></div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Linhas novas</div><div style="font-size:24px;font-weight:700">${totalAGravar}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${totalJaPreenchidos} já existentes, preservadas</div></div>
    <div style="background:${totalAjustes>0?'#1f1a0d':'var(--card)'};border:1px solid ${totalAjustes>0?'#3d3010':'var(--border)'};border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Ajustes IA</div><div style="font-size:24px;font-weight:700;color:${totalAjustes>0?'#f6ad55':'var(--text)'}">${totalAjustes}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">turnos ajustados</div></div>
    <div style="background:${totalLacunas-totalAjustes>0?'#1f1010':'#0d2010'};border:1px solid ${totalLacunas-totalAjustes>0?'#3d2020':'#0d2010'};border-radius:8px;padding:12px 14px"><div style="font-size:9px;color:var(--text3);font-weight:600;text-transform:uppercase;margin-bottom:4px">Lacunas restantes</div><div style="font-size:24px;font-weight:700;color:${totalLacunas-totalAjustes>0?'#fc8181':'#68d391'}">${totalLacunas-totalAjustes}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${totalLacunas-totalAjustes>0?'sem cobertura':'cobertura completa'}</div></div>
  </div>
  ${ajustesResumoHtml?`<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:10px">✱ Ajustes realizados pela IA</div>${ajustesResumoHtml}</div>`:''}

  <!-- Painel de fadiga e folgas — carregado assincronamente -->
  <div id="painel-fadiga" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:12px;font-weight:700;color:var(--text)">💤 Análise de fadiga + sugestões de folga</span>
      <span id="fadiga-status" style="font-size:11px;color:var(--text3)">Analisando escala histórica e Airtable...</span>
      <div id="fadiga-spinner" style="width:14px;height:14px;border:2px solid var(--btn-border);border-top-color:#63b3ed;border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0"></div>
    </div>
    <div id="fadiga-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:12px"></div>
    <div id="fadiga-footer" style="display:none;margin-top:8px;font-size:10px;color:var(--text3)">🟢 ok · 🟡 5–6 dias seguidos · 🔴 7+ dias seguidos. Folgas roxas 💤 na tabela = sugeridas pela IA.</div>
  </div>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>

  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:16px">
    <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text2)">Proposta de escala</span>
      <span style="background:#1a2744;color:#63b3ed;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600">${totalAGravar} linhas novas</span>
      <span id="badge-folgas" style="display:none;background:#1a0d2e;color:#c084fc;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600"></span>
      ${totalJaPreenchidos>0?`<span style="background:var(--muted);color:var(--text2);border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600">cinza = já preenchido</span>`:''}
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse" id="tabela-escala">
        <thead><tr><th style="padding:6px 10px;text-align:left;font-size:9px;font-weight:600;color:var(--text3);text-transform:uppercase;background:var(--input);border-bottom:1px solid var(--border);min-width:110px">Dia</th>${cabecalho}</tr></thead>
        <tbody id="tbody-escala">${linhasTabelaComFolgas}</tbody>
      </table>
    </div>
  </div>
  <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px">
    <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text3);cursor:pointer">
      <input type="checkbox" id="chk-forcar-rotacao" style="width:auto;margin:0">
      🔁 Forçar regra de rotação de fim de semana — sobrescreve o que já estava preenchido pras 9 pessoas da rotação (nunca sobrescreve ausência aprovada/Folga Programada)
    </label>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">Compartilhar escala com a equipe</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px" id="btn-desc">Grava ${totalAGravar} linhas novas · folgas sugeridas pela IA incluídas automaticamente</div>
      </div>
      <button onclick="confirmar()" id="btn" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;cursor:pointer">Compartilhar com a equipe ✓</button>
    </div>
  </div>
</div>
<script>
function toggleTheme(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');var btn=document.getElementById('tt');if(btn)btn.textContent=dk?'☀️':'🌙';}
function mudarPeriodo(){
  var ini=document.getElementById('inpInicio').value, fim=document.getElementById('inpFim').value;
  if(!ini||!fim) return;
  if(fim<ini){ alert('A data final não pode ser antes da data de início'); return; }
  location.href='/api/gerar-escala?inicio='+ini+'&fim='+fim;
}
var INICIO_ISO = '${fmtAirtable(inicio)}';
var FIM_ISO = '${fmtAirtable(fim)}';
var AJUSTES = ${JSON.stringify(ajustesJSON)};
var FOLGAS_IA = [];
var TURNOS_BASE = ${JSON.stringify(Object.fromEntries(ativos.filter(p=>turnos[p[0]]).map(p=>[p[0],turnos[p[0]]])))};
var DATAS = ${JSON.stringify(diasProcessados.map(d=>({df:d.df,diaSem:d.diaSem,isFds:d.isFds,eventos:d.evsDia.length})))};

// Carrega análise assíncrona
(async function(){
  try {
    var ctrl = new AbortController();
    var timeoutId = setTimeout(function(){ ctrl.abort(); }, 45000);
    var r;
    try {
      r = await fetch('/api/gerar-escala?action=analisar&inicio='+INICIO_ISO+'&fim='+FIM_ISO, {credentials:'include', signal: ctrl.signal});
    } finally {
      clearTimeout(timeoutId);
    }
    var d = await r.json();
    if(!d.ok) throw new Error(d.error);

    FOLGAS_IA = d.folgas||[];
    var fadiga = d.fadiga||{};

    // Renderiza cards de fadiga
    var html = Object.entries(fadiga).map(function(entry){
      var nome=entry[0], f=entry[1];
      var nivel=f.consecutivos>=7?'red':f.consecutivos>=5?'amber':'green';
      var cores={red:['#1f1010','#991b1b','#fc8181'],amber:['#1f1a0d','#3d3010','#f6ad55'],green:['#0d2010','#166534','#68d391']};
      var c=cores[nivel];
      var folgasDessaPessoa=FOLGAS_IA.filter(function(fg){return fg.nome===nome;}).map(function(fg){return fg.data;});
      var extrasTxt = f.semTipoContrato ? 'sem tipo de contrato' : ('banco+extras: '+(f.extrasTotal||0)+'h');
      return '<div style="background:'+c[0]+';border:1px solid '+c[1]+';border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px">'
        +'<div style="font-size:18px">'+(nivel==='red'?'🔴':nivel==='amber'?'🟡':'🟢')+'</div>'
        +'<div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--text)">'+nome.split(' ')[0]+'</div>'
        +'<div style="font-size:10px;color:'+c[2]+'">'+f.consecutivos+' dias sem folga · '+f.diasTrabalho+' trab. / '+(f.diasFolga||0)+' folgas desde 01/06</div>'
        +'<div style="font-size:9px;color:var(--text3)">'+extrasTxt+'</div>'
        +(folgasDessaPessoa.length?'<div style="font-size:9px;color:#68d391;margin-top:2px">💤 Folga sugerida: '+folgasDessaPessoa.join(', ')+'</div>':'')
        +'</div></div>';
    }).join('');
    document.getElementById('fadiga-cards').innerHTML = html;
    document.getElementById('fadiga-spinner').style.display='none';
    document.getElementById('fadiga-footer').style.display='block';
    var statusEl = document.getElementById('fadiga-status');
    if (d.erroIA) {
      statusEl.textContent = '⚠ IA de folgas indisponível agora: '+d.erroIA+' — histórico acima ainda é real, só a sugestão automática não rodou.';
      statusEl.style.color = '#fc8181';
    } else {
      statusEl.textContent = Object.keys(fadiga).length+' colaboradores analisados · '+FOLGAS_IA.length+' folgas sugeridas';
    }

    // Atualiza badge e tabela com folgas
    if(FOLGAS_IA.length) {
      var badge=document.getElementById('badge-folgas');
      badge.textContent='💤 '+FOLGAS_IA.length+' folgas sugeridas';
      badge.style.display='inline';
      // Marcar células de folga na tabela
      FOLGAS_IA.forEach(function(fg){
        var tds = document.querySelectorAll('[data-df="'+fg.data+'"][data-nome="'+fg.nome+'"]');
        tds.forEach(function(td){
          td.style.background='#1a0d2e';
          td.innerHTML='<div style="color:#c084fc;font-size:10px;font-weight:600">💤 Folga</div><div style="font-size:8px;color:#9f7aea">'+fg.motivo+'</div>';
        });
      });
    }
  } catch(e) {
    document.getElementById('fadiga-spinner').style.display='none';
    var msg = (e.name==='AbortError') ? 'Demorou demais (45s) e foi cancelado — tenta recarregar a página' : e.message;
    document.getElementById('fadiga-status').textContent='Erro na análise: '+msg;
    document.getElementById('fadiga-status').style.color='#fc8181';
  }
})();

async function confirmar(){
  if(!confirm('Compartilhar esta escala com toda a equipe?\\n\\nInclui '+FOLGAS_IA.length+' folgas sugeridas pela IA.\\nO que já estava preenchido não será alterado.')) return;
  var btn=document.getElementById('btn');
  btn.textContent='Compartilhando...';btn.disabled=true;btn.style.background='#374151';
  try{
    var forcarRotacao = document.getElementById('chk-forcar-rotacao')?.checked || false;
    var r=await fetch('/api/gerar-escala?inicio='+INICIO_ISO+'&fim='+FIM_ISO,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({ajustes:AJUSTES,folgas:FOLGAS_IA,forcarRotacao:forcarRotacao})});
    var d=await r.json();
    if(d.ok){btn.textContent='✓ Compartilhado!';btn.style.background='#166534';setTimeout(()=>window.location='/api/escalas?v=semana',1500);}
    else{btn.textContent='Compartilhar com a equipe ✓';btn.disabled=false;btn.style.background='#1d4ed8';alert('Erro: '+d.error);}
  }catch(e){btn.textContent='Compartilhar com a equipe ✓';btn.disabled=false;btn.style.background='#1d4ed8';alert('Erro de conexão');}
}
</script>
</body></html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  return res.status(200).send(html);
  } catch(err) {
    console.error('gerar-escala GET erro:', err.message, err.stack);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1c1f26;color:#fc8181;padding:40px">
      <h2>Erro ao gerar escala</h2><pre style="font-size:13px;color:#a0aec0;white-space:pre-wrap">${err.message}\n\n${err.stack||''}</pre>
      <a href="/api/escalas" style="color:#63b3ed">← Voltar para a Escala</a>
    </body></html>`);
  }
}
