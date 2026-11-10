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
const texto = (v, max) => String(v || '').replace(/[<>]/g, '').slice(0, max);

export class Sensores {
  constructor(state) {
    this.state = state; this.dados = {};
    this.pronto = state.blockConcurrencyWhile(async () => { this.dados = (await state.storage.get('dados')) || {}; });
  }

  resumo() {
    const out = {};
    for (const [id, s] of Object.entries(this.dados)) {
      if (!s.ult) continue;
      out[id] = { id, nome: s.nome || id, ...s.ult, hist: s.hist.slice(-90).map(h => h[1]).filter(n => n != null) };
    }
    return out;
  }

  async fetch(request) {
    await this.pronto;
    const agora = Date.now();
    if (request.method === 'GET') return Response.json({ agora, sensores: this.resumo() });
    if (request.method !== 'POST') return Response.json({ error: 'método' }, { status: 405 });
    let b; try { b = await request.json(); } catch { return Response.json({ error: 'json' }, { status: 400 }); }
    const lista = Array.isArray(b.leituras) ? b.leituras.slice(0, 20) : [];
    let gravou = 0;
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
      gravou++;
    }
    if (gravou) await this.state.storage.put('dados', this.dados);
    return Response.json({ ok: true, gravou });
  }
}
