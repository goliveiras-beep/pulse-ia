// api/setup-recategorizar-celulares.js — Migração única: move os telefones importados com
// alocação "A definir" para um local próprio "Celulares" (pool de aparelhos avulsos, fora
// dos Kits MoJo completos).
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const NOVO_LOCAL = 'Celulares';

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}
function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtTimestamp(d) {
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function proximaLinhaLivre(sheetName) {
  const atual = await getSheet(`${sheetName}!A2:A5000`);
  return atual.length + 2;
}
async function inserirLinhas(sheetName, colUltima, linhas, linhaInicial) {
  const fim = linhaInicial + linhas.length - 1;
  await setSheet(`${sheetName}!A${linhaInicial}:${colUltima}${fim}`, linhas);
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const log = [];
  try {
    const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');
    const alvos = [];
    equipamentosRaw.forEach((r, i) => {
      if (r[6] === 'A definir') alvos.push({ linha: i + 2, id: r[0], equipamento: r[2] });
    });

    if (alvos.length === 0) {
      return res.status(200).json({ ok: true, log: ['Nenhuma unidade com alocação "A definir" encontrada — nada a fazer.'] });
    }

    const agora = fmtTimestamp(getBRT());
    for (const alvo of alvos) {
      await setSheet(`Equipamentos!G${alvo.linha}:H${alvo.linha}`, [[NOVO_LOCAL, agora]]);
    }
    log.push(`✓ ${alvos.length} unidades movidas de "A definir" para "${NOVO_LOCAL}"`);

    const movLinha = await proximaLinhaLivre('MovimentacoesEquipamento');
    await inserirLinhas('MovimentacoesEquipamento', 'H', [[
      agora, '—', '—', 'A definir', NOVO_LOCAL, 'Sistema (migração)',
      `Recategorização em lote — ${alvos.length} telefones movidos para o local "${NOVO_LOCAL}"`, 'mover'
    ]], movLinha);
    log.push('✓ Movimentação registrada no histórico');

    return res.status(200).json({ ok: true, totalMovido: alvos.length, ids: alvos.map(a => a.id), log });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
