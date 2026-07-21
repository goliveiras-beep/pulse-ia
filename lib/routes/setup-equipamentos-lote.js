// api/setup-equipamentos-lote.js — Importação única do lote real de equipamentos
// (Switcher A/B, Estúdio 1/2), complementar ao catálogo placeholder das PDs.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}
async function proximaLinhaLivre(sheetName) {
  const atual = await getSheet(`${sheetName}!A2:A5000`);
  return atual.length + 2;
}
async function inserirLinhas(sheetName, colUltima, linhas, linhaInicial) {
  const fim = linhaInicial + linhas.length - 1;
  await setSheet(`${sheetName}!A${linhaInicial}:${colUltima}${fim}`, linhas);
}
function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtTimestamp(d) {
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const LOTE = [
  { local: 'Switcher A (SWA)', itens: [
    ['Vídeo/Monitoração', 'Monitor 50"', 7],
    ['Switching/Produção', 'Mesa ATEM', 1],
    ['Switching/Produção', 'Clean Switcher', 1],
    ['Vídeo/Monitoração', 'Monitor 24"', 9],
    ['Comunicação/Intercom', 'Painel de comunicação', 6],
    ['Comunicação/Intercom', 'Fone de comunicação', 6],
    ['Periféricos/TI', 'Notebook', 2],
    ['Áudio', 'Caixa de monitoramento Genelec', 4],
    ['Áudio', 'Mesa de áudio Allen & Heath Avantis', 1],
    ['Áudio', 'Mesa de áudio Allen & Heath SQ-5', 1],
    ['Switching/Produção', 'Vmix Tarja', 1],
    ['Switching/Produção', 'Vmix Playout', 1],
    ['Captação', 'Externa', 14],
  ]},
  { local: 'Switcher B (SWB)', itens: [
    ['Vídeo/Monitoração', 'Monitor 50"', 7],
    ['Switching/Produção', 'Mesa ATEM', 1],
    ['Switching/Produção', 'Clean Switcher', 1],
    ['Vídeo/Monitoração', 'Monitor 24"', 9],
    ['Comunicação/Intercom', 'Painel de comunicação', 6],
    ['Comunicação/Intercom', 'Fone de comunicação', 6],
    ['Periféricos/TI', 'Notebook', 2],
    ['Áudio', 'Caixa de monitoramento Genelec', 4],
    ['Áudio', 'Mesa de áudio Allen & Heath Avantis', 1],
    ['Áudio', 'Mesa de áudio Yamaha TF1', 1],
    ['Switching/Produção', 'Vmix Tarja', 1],
    ['Switching/Produção', 'Vmix Playout', 1],
    ['Captação', 'Externa', 14],
  ]},
  { local: 'Estúdio 1', itens: [
    ['Captação', 'Câmera HDC4300', 1],
    ['Captação', 'Câmera PTZ AW-UE70KP', 2],
    ['Captação', 'Dolly', 1],
    ['Captação', 'Tripé', 2],
    ['Vídeo/Monitoração', 'Retorno 65"', 2],
    ['Vídeo/Monitoração', 'Painel de LED 4x3 (em U)', 1],
    ['Switching/Produção', 'Controladora', 1],
    ['Switching/Produção', 'Resolume', 1],
  ]},
  { local: 'Estúdio 2', itens: [
    ['Captação', 'Câmera HDC4300', 3],
    ['Vídeo/Monitoração', 'Monitor 65"', 2],
    ['Áudio', 'Microfone lapela', 4],
    ['Áudio', 'AEQ Olímpia 3', 2],
    ['Áudio', 'Microfone e835s', 4],
    ['Comunicação/Intercom', 'Fone concha', 4],
    ['Vídeo/Monitoração', 'Painel de LED 4x3', 1],
    ['Vídeo/Monitoração', 'Painel de LED 9x16', 1],
    ['Vídeo/Monitoração', 'Teleprompter Autocue', 1],
    ['Captação', 'Dolly', 1],
    ['Captação', 'Tripé', 2],
  ]},
];

function proximoId(equipamentosRaw) {
  let max = 0;
  for (const r of equipamentosRaw) {
    const m = String(r[0]||'').match(/^EQP-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export default async function handler(req, res) {
  if (req.query.token !== 'pulse_setup_2026') {
    return res.status(403).json({ error: 'Token inválido' });
  }

  const log = [];
  try {
    const equipamentosRaw = await getSheet('Equipamentos!A2:J3000');
    let seq = proximoId(equipamentosRaw) + 1;
    const agora = fmtTimestamp(getBRT());
    const linhas = [];
    const resumoPorLocal = [];

    for (const grupo of LOTE) {
      let qtdLocal = 0;
      for (const [categoria, equipamento, qtd] of grupo.itens) {
        for (let u = 0; u < qtd; u++) {
          const id = 'EQP-' + String(seq).padStart(4, '0');
          linhas.push([id, categoria, equipamento, '', '', 'Operacional', grupo.local, agora, '', agora]);
          seq++;
          qtdLocal++;
        }
      }
      resumoPorLocal.push(`${grupo.local}: ${qtdLocal} unidades`);
      log.push(`✓ ${grupo.local}: ${qtdLocal} unidades preparadas`);
    }

    if (linhas.length === 0) return res.status(200).json({ ok: true, log: ['Nada a importar'] });

    const linhaInicial = await proximaLinhaLivre('Equipamentos');
    await inserirLinhas('Equipamentos', 'J', linhas, linhaInicial);
    log.push(`✓ ${linhas.length} unidades gravadas em Equipamentos a partir da linha ${linhaInicial}`);

    const movLinha = await proximaLinhaLivre('MovimentacoesEquipamento');
    await inserirLinhas('MovimentacoesEquipamento', 'H', [[
      agora, '—', '—', '—', 'Carga em lote', 'Sistema (import lote)',
      `Importação do lote real (Switchers + Estúdios) — ${resumoPorLocal.join('; ')}`, 'cadastro'
    ]], movLinha);
    log.push('✓ Movimentação de carga registrada no histórico');

    return res.status(200).json({ ok: true, totalImportado: linhas.length, log });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
