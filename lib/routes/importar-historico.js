// lib/routes/importar-historico.js — importação ÚNICA do histórico dos dois artefatos do claude.ai
// (Manutenção das antenas e Registro de alterações do patch de RF) para as abas Antenas, AntenasConfig e
// PatchRF. Só gestor. GET sem parâmetro mostra o que seria importado; GET ?confirmar=1 grava. Pode rodar
// de novo sem duplicar (ids derivados do id de origem; patch deduplicado por data/técnico/entrada).
// Remover este arquivo e lib/importacao/ depois da importação.
import { createHash } from 'crypto';
import { sheetsRequest } from '../google-auth.js';
import { HISTORICO } from '../importacao/historico.js';
import {
  getSession, getContexto, ABA, ABA_CFG, CAB, garantirAba, lerValores, linhaDeDoc, acharLinha, gravarLinha,
  sanitizarDoc, sanitizarSla,
} from './antenas.js';
import { lerLinhas, linhaParaRegistro, gravarLinhas } from './registros-tecnicos.js';
import { validarRegistro } from '../patch-rf-map.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const QUEM = 'Importação dos artefatos (2026-10-21)';
// nome de quem criou no artefato original (id interno do claude.ai -> nome na equipe)
const AUTORES = { u_fYtR0p0q4vkXE5lEyrImIQ: 'Thiago Russo' };

const idAntenas = (idOrigem) => createHash('sha1').update('artefato-antenas:' + idOrigem).digest('hex').slice(0, 20);
const chavePatch = (r) => [r.ts, r.tecnico, r.dispositivo, r.entrada, r.para].join('|');

function prepararChecklist(o) {
  const { idOrigem, ...d } = o;
  const doc = sanitizarDoc(d);
  doc.criadoEm = d.criadoEm || doc.criadoEm;
  doc.criadoPor = AUTORES[d.criadoPor] || doc.criadoPor || QUEM;
  return { id: idAntenas(idOrigem), doc };
}

function prepararAlteracao(o) {
  const reg = {
    ts: new Date(o.ts).toISOString(), tecnico: String(o.tecnico || ''), tipo: o.tipo, dispositivo: o.dispositivo,
    entrada: Number(o.entrada), de: o.de, para: o.para, motivo: String(o.motivo || '').trim(), obs: String(o.obs || '').trim(),
    criadoEm: o.criadoEm || o.ts,
  };
  const erro = validarRegistro(reg);
  return { reg, erro };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.redirect(302, '/api/app');
  const ctx = await getContexto(session.nome);
  if (!ctx || !ctx.usuario.isGestor) return res.status(403).json({ error: 'Só o gestor pode importar o histórico.' });
  const confirmar = req.query.confirmar === '1';

  try {
    const resumo = { confirmar, antenas: [], patchrf: [], sla: null };

    // ---- checklists das antenas ----
    await garantirAba(ABA, CAB);
    const ids = await lerValores(`${ABA}!A2:A3000`);
    let total = ids.length;
    for (const o of HISTORICO.antenas) {
      const { id, doc } = prepararChecklist(o);
      const ja = !!(await acharLinha(id));
      resumo.antenas.push({ origem: o.idOrigem, id, os: doc.ident.os, tipo: doc.tipo, status: doc.status, data: doc.ident.data, jaExiste: ja });
      if (confirmar && !ja) { await gravarLinha(2 + total, linhaDeDoc(id, doc, QUEM)); total++; }
    }

    // ---- prazos (SLA) — só se ainda não houver um salvo ----
    await garantirAba(ABA_CFG, ['Chave', 'Valor']);
    const cfg = await lerValores(`${ABA_CFG}!A2:B20`);
    const temSla = cfg.some((x) => x[0] === 'sla' && x[1]);
    resumo.sla = { jaExiste: temSla, valores: HISTORICO.sla };
    if (confirmar && !temSla) {
      const n = 2 + cfg.length;
      await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(`${ABA_CFG}!A${n}:B${n}`)}?valueInputOption=RAW`, 'PUT',
        { values: [['sla', JSON.stringify(sanitizarSla(HISTORICO.sla))]] });
    }

    // ---- alterações de patch de RF ----
    const linhas = await lerLinhas();
    const existentes = new Set(linhas.map(linhaParaRegistro).map(chavePatch));
    const novos = [];
    for (const o of [...HISTORICO.patchrf].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
      const { reg, erro } = prepararAlteracao(o);
      const ja = existentes.has(chavePatch(reg));
      resumo.patchrf.push({ origem: o.idOrigem, ts: reg.ts, tecnico: reg.tecnico, tipo: reg.tipo, dispositivo: `${reg.dispositivo} IN${reg.entrada}`, de: reg.de, para: reg.para, motivo: reg.motivo, obs: reg.obs, erro, jaExiste: ja });
      if (!erro && !ja) novos.push(reg);
    }
    if (confirmar && novos.length) await gravarLinhas(novos, linhas.length);

    resumo.gravados = confirmar ? { antenas: resumo.antenas.filter((x) => !x.jaExiste).length, patchrf: novos.length, sla: temSla ? 0 : 1 } : null;
    return res.status(200).json(resumo);
  } catch (e) {
    console.error('importar-historico error:', e);
    return res.status(500).json({ error: 'Falha na importação: ' + e.message });
  }
}
