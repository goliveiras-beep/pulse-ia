// lib/routes/registros-tecnicos.js — Registros técnicos da Central (fase 1: Registro de alterações
// do patch de RF). Pedido do Guilherme em 2026-10-20: trazer pro Pulse os artefatos "Registro de
// alterações do patch de RF" e "Manutenção das antenas" (esta última é a fase 2, ainda não feita).
// Dados na aba PatchRF da planilha; o técnico responsável é escolhido numa caixa de seleção com a equipe
// da contratante (lib/tecnicos.js), como no artefato original.
// Colaborador e gestor registram; perfil "view" só enxerga; só gestor remove registro.
import { sheetsRequest, garantirLinhasSheet } from '../google-auth.js';
import { menuItens } from '../menu.js';
import { TECNICOS_CONTRATANTE } from '../tecnicos.js';
import {
  QIN, DEVICES, UNITS, PORTS, DISCONNECTED, OTHER, TIPOS, TOTAL_ENTRADAS,
  validarRegistro, entradasForaDoPadrao,
} from '../patch-rf-map.js';
import { createHash, timingSafeEqual } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ABA = 'PatchRF';
const RANGE_DADOS = `${ABA}!A2:K5000`;
const CABECALHO = ['Data e hora', 'Técnico', 'Tipo', 'Dispositivo', 'Entrada', 'De', 'Para', 'Motivo', 'Observações', 'Registrado em', 'Removido'];
const COOKIE_NAME = 'pulse_session';

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }
function assinaturaBate(a, b) { const ba = Buffer.from(a), bb = Buffer.from(b); return ba.length === bb.length && timingSafeEqual(ba, bb); }
function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => { const p = c.trim().split('='); cookies[p.shift()] = p.join('='); });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const last = d.lastIndexOf('|'), sec = d.lastIndexOf('|', last - 1);
    const data = d.slice(0, sec), h = d.slice(sec + 1, last), ts = d.slice(last + 1);
    if (Date.now() - parseInt(ts, 10) > 7 * 24 * 3600 * 1000) return null;
    if (!assinaturaBate(h, hash(data + ts))) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    return nome ? { nome } : null;
  } catch { return null; }
}

// Equipe (13 col): 0=nome, 8=perfil, 10=status
async function getUsuario(nome) {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:M200')}`);
    const r = (d.values || []).find(x => x[0] === nome && (x[10] || 'ativo').toLowerCase() === 'ativo');
    return r ? { nome, perfil: r[8] || 'colaborador' } : null;
  } catch { return null; }
}

async function criarAba() {
  await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
    requests: [{ addSheet: { properties: { title: ABA, gridProperties: { rowCount: 2000, columnCount: CABECALHO.length } } } }],
  });
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!A1:K1`)}?valueInputOption=RAW`, 'PUT', { values: [CABECALHO] });
}

// Lê os registros; se a aba ainda não existe, cria (uma falha aqui não pode derrubar a function)
async function lerLinhas() {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(RANGE_DADOS)}`);
    return d.values || [];
  } catch (e) {
    if (!/Unable to parse range|not found/i.test(e.message)) throw e;
    await criarAba();
    return [];
  }
}

function linhaParaRegistro(r, i) {
  return {
    linha: i + 2, ts: r[0] || '', tecnico: r[1] || '', tipo: r[2] || '', dispositivo: r[3] || '',
    entrada: Number(r[4]) || 1, de: r[5] || '', para: r[6] || '', motivo: r[7] || '', obs: r[8] || '',
    criadoEm: r[9] || '', removido: r[10] || '',
  };
}

// Grava uma ou mais linhas no fim da aba. Não usa values.append (bug de alinhamento já visto na Escala).
async function gravarLinhas(regs, totalExistente) {
  const valores = regs.map(r => [r.ts, r.tecnico, r.tipo, r.dispositivo, r.entrada, r.de, r.para, r.motivo, r.obs, r.criadoEm, '']);
  const primeira = 2 + totalExistente;
  const ultima = primeira + valores.length - 1;
  await garantirLinhasSheet(SHEET_ID, ABA, ultima);
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!A${primeira}:K${ultima}`)}?valueInputOption=RAW`, 'PUT', { values: valores });
  return regs.map((r, k) => ({ ...r, linha: primeira + k, removido: '' }));
}

function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function jsonSeguro(o) { return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');
  const usuario = await getUsuario(session.nome);
  if (!usuario) return res.redirect(302, '/api/app');
  const isGestor = usuario.perfil === 'gestor';
  const isView = usuario.perfil === 'view';

  if (req.method === 'POST') {
    const action = req.query.action || '';
    const body = req.body || {};
    try {
      if (action === 'registrar') {
        if (isView) return res.status(403).json({ error: 'Essa conta é somente leitura.' });
        const reg = {
          ts: String(body.ts || ''), tecnico: String(body.tecnico || ''), tipo: String(body.tipo || ''),
          dispositivo: String(body.dispositivo || ''), entrada: Number(body.entrada),
          de: String(body.de || ''), para: String(body.para || ''),
          motivo: String(body.motivo || '').trim(), obs: String(body.obs || '').trim(),
        };
        if (!TECNICOS_CONTRATANTE.includes(reg.tecnico)) return res.status(400).json({ error: 'Selecione o técnico responsável.' });
        const erro = validarRegistro(reg);
        if (erro) return res.status(400).json({ error: erro });
        reg.ts = new Date(reg.ts).toISOString();
        reg.criadoEm = new Date().toISOString();
        const linhas = await lerLinhas();
        const [novo] = await gravarLinhas([reg], linhas.length);
        return res.status(200).json({ ok: true, registros: [novo] });
      }

      if (action === 'normalizar') {
        if (isView) return res.status(403).json({ error: 'Essa conta é somente leitura.' });
        const tecnico = String(body.tecnico || '');
        if (!TECNICOS_CONTRATANTE.includes(tecnico)) return res.status(400).json({ error: 'Selecione o técnico responsável.' });
        const linhas = await lerLinhas();
        const fora = entradasForaDoPadrao(linhas.map(linhaParaRegistro));
        if (!fora.length) return res.status(200).json({ ok: true, registros: [] });
        const agora = new Date().toISOString();
        const regs = fora.map(f => ({
          ts: agora, tecnico, tipo: 'Normalização ao padrão', dispositivo: f.dispositivo, entrada: f.entrada,
          de: f.de, para: f.para, motivo: 'Normalização ao mapa oficial padrão', obs: '', criadoEm: agora,
        }));
        const gravados = await gravarLinhas(regs, linhas.length);
        return res.status(200).json({ ok: true, registros: gravados });
      }

      if (action === 'remover') {
        if (!isGestor) return res.status(403).json({ error: 'Só o gestor pode remover registros.' });
        const linha = Number(body.linha);
        if (!Number.isInteger(linha) || linha < 2) return res.status(400).json({ error: 'Linha inválida.' });
        const linhas = await lerLinhas();
        const r = linhas[linha - 2];
        // confere que a linha ainda é a mesma que a tela mostrou (a posição pode ter mudado)
        if (!r || r[0] !== body.ts || r[3] !== body.dispositivo || String(r[4]) !== String(body.entrada)) {
          return res.status(409).json({ error: 'O registro mudou. Recarregue a página e tente de novo.' });
        }
        const marca = `${usuario.nome} em ${new Date().toISOString()}`;
        await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA}!K${linha}`)}?valueInputOption=RAW`, 'PUT', { values: [[marca]] });
        return res.status(200).json({ ok: true, removido: marca });
      }

      return res.status(400).json({ error: 'Ação desconhecida.' });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  let registros = [];
  let erroLeitura = '';
  try {
    registros = (await lerLinhas()).map(linhaParaRegistro).filter(r => r.dispositivo);
  } catch (e) {
    erroLeitura = String(e.message || e);
  }

  const dados = {
    usuario: { nome: usuario.nome, perfil: usuario.perfil, isGestor, isView },
    mapa: { QIN, DEVICES, UNITS, PORTS, DISCONNECTED, OTHER, TIPOS, TOTAL: TOTAL_ENTRADAS },
    registros,
  };


  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - Registros técnicos</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#e53e3e">
<style>
:root{--bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--text:#1a1a1a;--text2:#555;--text3:#888;--header:#161920;
  --ok:#0e7c7b;--ok-bg:#d7efee;--bad:#b3261e;--bad-bg:#f7dedc;--blue:#1d4ed8;}
html.dark{--bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--header:#0f1117;
  --ok:#3fb8b6;--ok-bg:#16393a;--bad:#f07a70;--bad-bg:#45201d;--blue:#63b3ed;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}.hs{font-size:11px;color:#999}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer}
.menu-item{display:block;padding:9px 14px;font-size:12px;color:var(--text);white-space:nowrap;text-decoration:none}
.menu-item:hover{background:var(--bg3)}
.wrap{max-width:1100px;margin:0 auto;padding:20px}
.tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border)}
.tab{padding:9px 16px;font-size:13px;font-weight:600;color:var(--text3);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;margin-bottom:-1px;text-decoration:none;display:inline-block}
.tab.on{color:var(--text);border-bottom-color:#e53e3e}
.pagetitle{font-size:19px;font-weight:700;margin-bottom:4px}
.lead{font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:14px;max-width:80ch}
.status{font-size:18px;font-weight:700;margin:10px 0 6px}.status.ok{color:var(--ok)}.status.bad{color:var(--bad)}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--text2);margin-bottom:10px;align-items:center}
.dot{width:11px;height:11px;border-radius:50%;border:3px solid var(--ok);display:inline-block;margin-right:5px;vertical-align:-1px}
.dot.alt{border-color:var(--bad)}
.rack{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:grid;gap:6px;margin-bottom:22px}
.unit{display:grid;grid-template-columns:150px 1fr;background:var(--card);border:1px solid var(--border);border-radius:4px}
.uname{padding:8px 12px;border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:center}
.uname b{font-size:13.5px}.uname small{color:var(--text3);font-size:11px}
.jacks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.jack{display:grid;grid-template-columns:auto 1fr;gap:1px 9px;align-items:center;padding:8px 10px;border:none;border-right:1px dashed var(--border);background:none;color:var(--text);text-align:left;font:inherit;min-width:0;cursor:pointer}
.jack:last-child{border-right:0}.jack:hover{background:var(--ok-bg)}
.jack[disabled]{cursor:default}.jack[disabled]:hover{background:none}
.jack .ring{grid-row:span 2;width:20px;height:20px;border-radius:50%;border:5px solid var(--ok);background:var(--bg)}
.jack.alt{background:var(--bad-bg)}.jack.alt .ring{border-color:var(--bad)}
.jack .in{font-size:12px;font-weight:700}
.jack .src{font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jack .pad{grid-column:2;font-size:10.5px;font-weight:600;color:var(--bad);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jack.empty{opacity:.35;cursor:default}.jack.empty:hover{background:none}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:22px}
.card h2{font-size:15px;margin-bottom:12px}
form.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.full{grid-column:1/-1}
label{display:block;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
input,select,textarea{width:100%;font:inherit;font-size:13px;color:var(--text);background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px 10px}
textarea{min-height:64px;resize:vertical}input[readonly]{opacity:.75}
.hint{color:var(--text3);font-size:11.5px;margin-top:3px}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.btn{font:inherit;font-size:13px;font-weight:600;border-radius:6px;padding:9px 16px;border:1px solid var(--ok);background:var(--ok);color:#fff;cursor:pointer}
html.dark .btn{color:#0b1f1f}
.btn.ghost{background:transparent;color:var(--ok)}.btn.danger{border-color:var(--bad);background:var(--bad);color:#fff}
.btn:disabled{opacity:.45;cursor:not-allowed}
.msg{font-size:13px}.msg.err{color:var(--bad)}.msg.ok{color:var(--ok)}
.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
.tablewrap{overflow-x:auto;border:1px solid var(--border);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:820px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);background:var(--bg3)}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;border-radius:3px;padding:1px 7px;font-size:11px;font-weight:600;background:var(--bg3);color:var(--text2)}
.tag.norm{background:var(--ok-bg);color:var(--ok)}
.mini{background:none;border:none;color:var(--bad);font-size:11.5px;font-weight:600;cursor:pointer;text-decoration:underline}
.empty-state{padding:26px;text-align:center;color:var(--text3);font-size:13px}
.notice{padding:10px 14px;border-left:4px solid #d97706;background:var(--bg3);border-radius:4px;font-size:13px;margin-bottom:16px}
.soon{padding:40px 20px;text-align:center;color:var(--text3);font-size:14px;background:var(--card);border:1px dashed var(--border);border-radius:10px}
@media(max-width:820px){.unit{grid-template-columns:1fr}.uname{border-right:0;border-bottom:1px solid var(--border);flex-direction:row;gap:10px;align-items:baseline}
  .jacks{grid-template-columns:repeat(2,minmax(0,1fr))}.jack:nth-child(2n){border-right:0}form.grid,.filters{grid-template-columns:1fr}.wrap{padding:12px}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">P</div>
  <div><div class="ht">Pulse</div><div class="hs">Registros técnicos</div></div>
  <div class="hr">
    <button id="tt" class="btn-sm" onclick="(function(){var dk=document.documentElement.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');document.getElementById('tt').textContent=dk?'☀️':'🌙';})()" style="font-size:14px;padding:3px 8px">🌙</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        ${menuItens(isGestor)}
      </div>
    </div>
  </div>
</div>
<div class="wrap">
  <div class="tabs">
    <a class="tab on" href="/api/registros-tecnicos">Patch de RF</a>
    <a class="tab" href="/api/antenas">Antenas</a>
  </div>

  <div id="tab-patch">
    <div class="pagetitle">Registro de alterações do patch de RF</div>
    <p class="lead">CPD de recepção satelital. Toda mudança de cabo entre os Quintech e os IRDs/Demods deve ser registrada aqui, com quem fez e o motivo. O técnico registrado é a pessoa logada.</p>
    ${erroLeitura ? `<div class="notice">Não consegui ler os registros agora (${escHtml(erroLeitura)}). Recarregue a página.</div>` : ''}
    ${isView ? '<div class="notice">Sua conta é somente leitura: você vê o estado do patch e o histórico, mas não registra alterações.</div>' : ''}
    <div id="status" class="status ok"></div>
    <div class="legend">
      <span><i class="dot"></i>No padrão do mapa</span>
      <span><i class="dot alt"></i><b style="color:var(--bad)">Fora do padrão</b></span>
      ${isView ? '' : '<span>Clique numa entrada para registrar uma mudança nela.</span>'}
    </div>
    <div id="rack" class="rack"></div>

    ${isView ? '' : `<section class="card" id="form-card">
      <h2>Registrar alteração</h2>
      <form id="form" class="grid" novalidate>
        <div><label for="tecnico">Técnico responsável</label><select id="tecnico" required><option value="">Selecione</option>${TECNICOS_CONTRATANTE.map(n => `<option>${escHtml(n)}</option>`).join('')}</select></div>
        <div><label for="quando">Data e hora da alteração</label><input id="quando" type="datetime-local" required></div>
        <div><label for="disp">Dispositivo</label><select id="disp"></select></div>
        <div><label for="entrada">Entrada</label><select id="entrada"></select></div>
        <div><label for="de">Conexão anterior</label><select id="de"></select><div class="hint" id="de-hint"></div></div>
        <div><label for="para">Nova conexão</label><select id="para"></select><div class="hint" id="para-hint"></div></div>
        <div><label for="tipo">Tipo</label><select id="tipo"></select></div>
        <div><label for="motivo">Motivo</label><input id="motivo" maxlength="300" placeholder="Ex.: falha no IRD3, cobertura de evento, teste de nível"></div>
        <div class="full"><label for="obs">Observações</label><textarea id="obs" maxlength="1000" placeholder="Opcional"></textarea></div>
        <div class="full actions">
          <button class="btn" type="submit" id="salvar">Registrar alteração</button>
          <button class="btn ghost" type="button" id="padrao">Normalizar ao padrão</button>
          <button class="btn ghost" type="button" id="padrao-cancel" hidden>Cancelar</button>
          <span id="msg" class="msg" role="status" aria-live="polite"></span>
        </div>
        <div class="full hint">Normalizar ao padrão devolve de uma vez todas as entradas alteradas ao mapa oficial e registra uma linha por entrada. Para normalizar só uma entrada, escolha-a acima, coloque a conexão do padrão em Nova conexão e use o tipo "Normalização ao padrão".</div>
      </form>
    </section>`}

    <section class="card">
      <div class="actions" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">Histórico</h2>
        <button class="btn ghost" type="button" id="csv">Exportar CSV</button>
      </div>
      <div class="filters">
        <div><label for="f-tec">Técnico</label><input id="f-tec" placeholder="Buscar nome"></div>
        <div><label for="f-disp">Dispositivo</label><select id="f-disp"></select></div>
        <div><label for="f-de">De</label><input id="f-de" type="date"></div>
        <div><label for="f-ate">Até</label><input id="f-ate" type="date"></div>
      </div>
      <div class="tablewrap"><table>
        <thead><tr><th>Data e hora</th><th>Técnico</th><th>Dispositivo</th><th>De</th><th>Para</th><th>Tipo</th><th>Motivo</th>${isGestor ? '<th></th>' : ''}</tr></thead>
        <tbody id="tbody"></tbody>
      </table></div>
      <div class="hint" id="trunc"></div>
    </section>
  </div>

</div>
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
window.__RT=${jsonSeguro(dados)};
</script>
<script src="/registros-tecnicos.js?v=3"></script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(html);
}
