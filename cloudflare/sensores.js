// cloudflare/sensores.js — leituras dos sensores de temperatura/umidade/CO2 da central (Nextcon IoT), em tempo quase real.
// Os sensores ficam na rede interna da central, que o Pulse (Cloudflare) não enxerga. Quem lê é a "ponte" (um programinha
// que roda DENTRO da rede e manda as leituras pra cá a cada ~10 s). Aqui só guardamos a última leitura de cada sensor e
// um histórico curto. Nenhum IP, senha ou endereço interno passa por aqui: só os números.
//
// Rotas (worker.js):
//   POST /api/sensores/leitura  (Authorization: Bearer SENSOR_TOKEN) { leituras:[{ id, nome, temp, umid, co2, tvoc }] }
//   GET  /api/sensores          (só logado)  → { agora, sensores:{ id:{ id, nome, t, temp, umid, co2, tvoc, hist:[temp...] } } }
const RANGOS = { temp: [-40, 120], umid: [0, 100], co2: [0, 20000], tvoc: [0, 20000] };
const HIST_MAX = 360;   // ~1 h a cada 10 s
// Alerta de temperatura (Guilherme, 2026-11-10): passou de 24 °C → toca um efeito sonoro e fala na Echo da central (Voice Monkey).
// Pra não gastar o plano grátis (200 avisos/mês): avisa UMA vez quando cruza; só avisa de novo se continuar quente depois de
// 30 min, ou se esfriar (abaixo de 23,5) e voltar a passar. No máximo 1 aviso a cada 5 min e 100 por mês, somando todos os sensores.
const LIMITE_ALERTA = 24, LIMITE_REARMA = 23.5, REPETE_MS = 30 * 60000, ENTRE_AVISOS_MS = 5 * 60000, MAX_POR_MES = 100;
const FALADOS = { 'nextcon-1': 'Sensor 1', 'nextcon-2': 'Sensor 2', 'nextcon-3': 'Sensor 3' };
const CHIME_PADRAO = 'soundbank://soundlibrary/alarms/air_horns/air_horn_01';
const falaNum = n => n.toFixed(1).replace('.', ',');
const texto = (v, max) => String(v || '').replace(/[<>]/g, '').slice(0, max);

export class Sensores {
  constructor(state, env) {
    this.state = state; this.env = env || {}; this.dados = {}; this.ctl = {}; this.zbx = null;
    this.pronto = state.blockConcurrencyWhile(async () => { this.dados = (await state.storage.get('dados')) || {}; this.ctl = (await state.storage.get('ctl')) || {}; this.zbx = (await state.storage.get('zbx')) || null; });
  }

  resumo() {
    const out = {};
    for (const [id, s] of Object.entries(this.dados)) {
      if (!s.ult) continue;
      out[id] = { id, nome: s.nome || id, ...s.ult, hist: s.hist.slice(-90).map(h => h[1]).filter(n => n != null) };
    }
    return out;
  }

  // Decide se é hora de avisar (cruzou 24 °C, ou continua quente há 30 min) e manda a Echo falar. Nunca derruba a gravação das leituras.
  async verificarAlertas(agora, ids) {
    const quentes = [];
    for (const id of ids) {
      const s = this.dados[id], temp = s && s.ult && s.ult.temp;
      if (temp == null) continue;
      const c = s.alerta || (s.alerta = { ativo: false, ultimo: 0 });
      if (temp <= LIMITE_REARMA) { c.ativo = false; continue; }
      if (temp < LIMITE_ALERTA) continue;
      if (!c.ativo || agora - c.ultimo >= REPETE_MS) quentes.push({ id, temp, c });
    }
    if (!quentes.length) return;
    const mes = new Date(agora).toISOString().slice(0, 7), ctl = this.ctl;
    if (ctl.mes !== mes) { ctl.mes = mes; ctl.avisos = 0; }
    if (agora - (ctl.ultimo || 0) < ENTRE_AVISOS_MS || ctl.avisos >= MAX_POR_MES) return;
    if (agora - (ctl.tentou || 0) < 60000) return;   // se o Voice Monkey estiver fora do ar, não martela a cada leitura
    ctl.tentou = agora;
    const e = this.env;
    if (!e.VOICEMONKEY_TOKEN || !e.VOICEMONKEY_DEVICE) return;
    const fala = 'Atenção. Temperatura alta no CPD. ' + quentes.map(q => (FALADOS[q.id] || this.dados[q.id].nome || q.id) + ' com ' + falaNum(q.temp) + ' graus').join('. ') + '.';
    const corpo = { token: e.VOICEMONKEY_TOKEN, device: e.VOICEMONKEY_DEVICE, speech: fala, chime: e.VOICEMONKEY_CHIME_TEMP || CHIME_PADRAO, voice: 'Ricardo' };
    if (e.VOICEMONKEY_LANGUAGE) corpo.language = e.VOICEMONKEY_LANGUAGE;
    const ctlAb = new AbortController(), t = setTimeout(() => ctlAb.abort(), 6000);
    try {
      const r = await fetch('https://api-v3.voicemonkey.io/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: ctlAb.signal });
      if (!r.ok) { console.error('sensores: Voice Monkey respondeu', r.status); return; }
      for (const q of quentes) { q.c.ativo = true; q.c.ultimo = agora; }
      ctl.ultimo = agora; ctl.avisos = (ctl.avisos || 0) + 1;
      await this.state.storage.put('ctl', ctl);
    } catch (err) { console.error('sensores: falha ao avisar a Echo', err && err.message); }
    finally { clearTimeout(t); }
  }

  // Alertas do Zabbix do CPD (Bruno), SÓ LEITURA: a ponte consulta o Zabbix pela API (métodos *.get) e manda o resumo pra cá.
  // Nada aqui escreve de volta no Zabbix nem toca a Echo. POST { zabbix:{ versao, hostsTotal, urlBase, problemas:[...] } | { erro } }
  async zabbix(request, agora) {
    if (request.method === 'GET') return Response.json({ agora, zabbix: this.zbx });
    if (request.method !== 'POST') return Response.json({ error: 'método' }, { status: 405 });
    let b; try { b = await request.json(); } catch { return Response.json({ error: 'json' }, { status: 400 }); }
    const z = (b && b.zabbix) || {};
    const num = (v, mn, mx) => { const n = Number(v); return isFinite(n) ? Math.max(mn, Math.min(mx, n)) : 0; };
    if (z.erro) { this.zbx = { t: agora, erro: texto(z.erro, 200), versao: texto(z.versao, 20), problemas: [], hostsTotal: 0, urlBase: '' }; }
    else {
      const lista = Array.isArray(z.problemas) ? z.problemas.slice(0, 300) : [];
      this.zbx = { t: agora, erro: '', versao: texto(z.versao, 20), hostsTotal: num(z.hostsTotal, 0, 100000), urlBase: texto(z.urlBase, 120),
        problemas: lista.map(p => ({ id: texto(p.id, 24), nome: texto(p.nome, 180), sev: num(p.sev, 0, 5), desde: num(p.desde, 0, 4102444800), ack: !!p.ack,
          host: texto(p.host, 90), ip: texto(p.ip, 45), rack: texto(p.rack, 8).toUpperCase(), link: texto(p.link, 220) })) };
    }
    await this.state.storage.put('zbx', this.zbx);
    return Response.json({ ok: true, problemas: this.zbx.problemas.length });
  }

  async fetch(request) {
    await this.pronto;
    const agora = Date.now();
    if (new URL(request.url).pathname === '/zabbix') return this.zabbix(request, agora);
    if (request.method === 'GET') return Response.json({ agora, sensores: this.resumo() });
    if (request.method !== 'POST') return Response.json({ error: 'método' }, { status: 405 });
    let b; try { b = await request.json(); } catch { return Response.json({ error: 'json' }, { status: 400 }); }
    const lista = Array.isArray(b.leituras) ? b.leituras.slice(0, 20) : [];
    let gravou = 0; const tocados = [];
    for (const l of lista) {
      const id = String((l && l.id) || '').toLowerCase();
      if (!/^[a-z0-9_-]{1,24}$/.test(id)) continue;
      const v = { t: agora }; let ok = false;
      for (const k of Object.keys(RANGOS)) {
        const bruto = l[k]; if (bruto === null || bruto === undefined || bruto === '') continue;
        const n = Number(bruto);
        if (isFinite(n) && n >= RANGOS[k][0] && n <= RANGOS[k][1]) { v[k] = n; ok = true; }
      }
      if (!ok) continue;
      const s = this.dados[id] || (this.dados[id] = { nome: '', hist: [] });
      const nome = texto(l.nome, 40); if (nome) s.nome = nome;
      s.ult = v;
      s.hist.push([agora, v.temp == null ? null : v.temp]);
      if (s.hist.length > HIST_MAX) s.hist.splice(0, s.hist.length - HIST_MAX);
      gravou++; tocados.push(id);
    }
    if (gravou) { await this.verificarAlertas(agora, tocados); await this.state.storage.put('dados', this.dados); }
    return Response.json({ ok: true, gravou });
  }
}
