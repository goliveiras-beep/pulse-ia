// api/setup-equipamentos-lote-externo.js — Importação única do parque externo
// (Kits MoJo 1-6), marcados como Tipo de Parque = Externo.
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

const LOTE_EXTERNO = [
  { local: 'KIT MOJO 1 - Rio de Janeiro', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 15 128GB (Lucas)', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB (Lucas)', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido In-ear Dylan', 1],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabo USB-C - 3mts', 1],
    ['Captação', 'Tripé 1,70m Hidráulica Q620', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
  ]},
  { local: 'KIT MOJO 2 - São Paulo', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 15 PINK 128GB', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido In-ear Dylan', 1],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabo USB-C - 3mts', 1],
    ['Captação', 'Tripé 1,70m Hidráulica Q620', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
  ]},
  { local: 'KIT MOJO 3 - Tênis', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 16 Pro Max Black 512GB', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido In-ear Dylan', 2],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabo USB-C - 3mts', 1],
    ['Captação', 'Tripé 1,70m Hidráulica Q620', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
  ]},
  { local: 'KIT MOJO 4 - Futebol', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 17 Pro Max 256GB', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido In-ear Dylan', 1],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabo USB-C - 3mts', 1],
    ['Captação', 'Tripé 1,70m', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
  ]},
  { local: 'KIT MOJO 5 - Futebol', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 17 Pro Max 256GB', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido In-ear Dylan', 1],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabos USB-C', 1],
    ['Captação', 'Tripé 1,70m Hidráulica Q620', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
  ]},
  { local: 'KIT MOJO 6 - Futebol', itens: [
    ['Mobile/MoJo', 'Mochila Para o KitMojo', 1],
    ['Mobile/MoJo', 'Apple iPhone 17 Pro Max 256GB', 1],
    ['Mobile/MoJo', 'Moto G35 ESIM 128GB', 1],
    ['Mobile/MoJo', 'Neewer PA017 SmartRig', 1],
    ['Mobile/MoJo', 'Iluminador Led Quadrado', 1],
    ['Mobile/MoJo', 'Power Bank AGold BTE-29 10000mAh', 1],
    ['Áudio', 'Fone de ouvido Intra Auricular', 1],
    ['Áudio', 'Microfone Sennheiser E835', 1],
    ['Áudio', 'Hollyland Lark M2', 1],
    ['Áudio', 'Suporte de MIC para LARK', 1],
    ['Áudio', 'Cabo XLR → USB-C', 1],
    ['Periféricos/TI', 'Cabos USB-C', 1],
    ['Captação', 'Tripé 1,70m Hidráulica Q620', 1],
    ['Mobile/MoJo', 'Capa Iphone', 1],
    ['Mobile/MoJo', 'Capa Moto G35', 1],
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
    const equipamentosRaw = await getSheet('Equipamentos!A2:K3000');
    let seq = proximoId(equipamentosRaw) + 1;
    const agora = fmtTimestamp(getBRT());
    const linhas = [];
    const resumoPorLocal = [];

    for (const grupo of LOTE_EXTERNO) {
      let qtdLocal = 0;
      for (const [categoria, equipamento, qtd] of grupo.itens) {
        for (let u = 0; u < qtd; u++) {
          const id = 'EQP-' + String(seq).padStart(4, '0');
          linhas.push([id, categoria, equipamento, '', '', 'Operacional', grupo.local, agora, '', agora, 'Externo']);
          seq++;
          qtdLocal++;
        }
      }
      resumoPorLocal.push(`${grupo.local}: ${qtdLocal} unidades`);
      log.push(`✓ ${grupo.local}: ${qtdLocal} unidades preparadas`);
    }

    if (linhas.length === 0) return res.status(200).json({ ok: true, log: ['Nada a importar'] });

    const linhaInicial = await proximaLinhaLivre('Equipamentos');
    await inserirLinhas('Equipamentos', 'K', linhas, linhaInicial);
    log.push(`✓ ${linhas.length} unidades gravadas em Equipamentos a partir da linha ${linhaInicial}`);

    const movLinha = await proximaLinhaLivre('MovimentacoesEquipamento');
    await inserirLinhas('MovimentacoesEquipamento', 'H', [[
      agora, '—', '—', '—', 'Carga em lote (Externo)', 'Sistema (import lote)',
      `Importação do parque externo (Kits MoJo) — ${resumoPorLocal.join('; ')}`, 'cadastro'
    ]], movLinha);
    log.push('✓ Movimentação de carga registrada no histórico');

    return res.status(200).json({ ok: true, totalImportado: linhas.length, log });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
