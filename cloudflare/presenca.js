// cloudflare/presenca.js — quem está passeando no Mapa 3D agora, e o "olha isso" (mostrar um ponto pra central).
// Fica num Durable Object (uma instância só, "central"): o estado mora na memória e todo mundo lê o mesmo, em
// segundos — a planilha não aguenta esse ritmo. Nada aqui é gravado em disco; se o objeto reiniciar, a lista zera
// e se refaz na próxima atualização de cada navegador (a cada ~2 s enquanto alguém passeia).
//
// Rota: /api/presenca (worker.js confere a sessão e repassa com o nome no cabeçalho x-pulse-nome)
//   GET                       → { pessoas:[{ nome, x, z, yaw, avatar, t }], olha:{...}|null }
//   POST { x, z, yaw, avatar } → atualiza a posição de quem chamou
//   POST { sair:true }        → some da lista
//   POST { mostrar:{ x, z, yaw, pitch, rotulo } } → "olha isso" pra quem estiver com o mapa aberto
const VALIDADE = 20000;          // posição sem atualização há 20 s = saiu
const VALIDADE_OLHA = 10 * 60000; // "olha isso" vale 10 min

const num = (v, min, max) => (typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, v)) : null);
const texto = (v, max) => String(v || '').replace(/[<>]/g, '').slice(0, max);

export class Presenca {
  constructor(state) { this.state = state; this.pessoas = new Map(); this.olha = null; }

  lista(agora) {
    for (const [n, p] of this.pessoas) if (agora - p.t > VALIDADE) this.pessoas.delete(n);
    if (this.olha && agora - this.olha.t > VALIDADE_OLHA) this.olha = null;
    return { pessoas: [...this.pessoas.values()], olha: this.olha };
  }

  async fetch(request) {
    const agora = Date.now();
    let nome = ''; try { nome = texto(decodeURIComponent(request.headers.get('x-pulse-nome') || ''), 80); } catch { /* cabeçalho estragado */ }
    if (!nome) return Response.json({ error: 'sem nome' }, { status: 400 });
    if (request.method === 'GET') return Response.json(this.lista(agora));
    if (request.method !== 'POST') return Response.json({ error: 'método' }, { status: 405 });
    let b; try { b = await request.json(); } catch { return Response.json({ error: 'json' }, { status: 400 }); }
    if (b.sair) { this.pessoas.delete(nome); return Response.json(this.lista(agora)); }
    if (b.mostrar) {
      const m = b.mostrar, x = num(m.x, -50, 100), z = num(m.z, -50, 100);
      if (x == null || z == null) return Response.json({ error: 'posição' }, { status: 400 });
      this.olha = { id: agora, de: nome, x, z, yaw: num(m.yaw, -100, 100) || 0, pitch: num(m.pitch, -2, 2) || 0, rotulo: texto(m.rotulo, 80), t: agora };
      return Response.json(this.lista(agora));
    }
    const x = num(b.x, -50, 100), z = num(b.z, -50, 100);
    if (x == null || z == null) return Response.json({ error: 'posição' }, { status: 400 });
    // avatar: só repassa o que parecer o objeto de escolhas do mapa (cores #hex e palavras curtas); o mapa valida de novo
    let avatar = null;
    if (b.avatar && typeof b.avatar === 'object') {
      avatar = {};
      for (const k of ['pele', 'roupa', 'cabelo', 'corCabelo', 'acessorio']) avatar[k] = texto(b.avatar[k], 12);
    }
    this.pessoas.set(nome, { nome, x, z, yaw: num(b.yaw, -100, 100) || 0, avatar, t: agora });
    return Response.json(this.lista(agora));
  }
}
