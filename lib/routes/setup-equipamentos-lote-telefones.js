// api/setup-equipamentos-lote-telefones.js — Importação única da frota de telefones
// do parque externo (Moto G35 / Galaxy A15 / iPhone), Tipo de Parque = Externo.
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

// modelo, serie (Número de Série), modeloTel (Modelo do Telefone), anatel, imeiEsim, imeiFisico, chip
export const TELEFONES = [
  { modelo: 'Moto G35 5G', serie: 'UP7MBS2L2T', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '353346287768766', imeiFisico: '353346287768758', chip: '' },
  { modelo: 'Moto G35 5G', serie: 'ZF525CGVD7', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '351892175929608', imeiFisico: '351892175929590', chip: '21 99384 8947' },
  { modelo: 'Moto G35 5G', serie: 'ZF525CGJ73', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '353044841990980', imeiFisico: '353044841990972', chip: '21 99292 5967' },
  { modelo: 'Moto G35 5G', serie: 'ZF2BLCZ', modeloTel: 'XT2433-1', anatel: '07104-24-00330', imeiEsim: '351141277509649', imeiFisico: '351141277509631', chip: '21 99379 1889' },
  { modelo: 'Galaxy A15', serie: 'RX8XCC02DAH', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296341212301 / 359061441212304', chip: '21 99175 1844' },
  { modelo: 'Galaxy A15', serie: 'RX8XC029B6W', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296341168966 / 359061441168969', chip: '' },
  { modelo: 'Galaxy A15', serie: 'RX8XB08JX1V', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296340846182 / 359061440846185', chip: '' },
  { modelo: 'Galaxy A15', serie: 'RX8XC023MCK', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296341149982 / 359061441149985', chip: '' },
  { modelo: 'Moto G35 5G', serie: 'ZF525GXGGB', modeloTel: 'XT2344-2', anatel: '07104-24-00330', imeiEsim: '351892178924002', imeiFisico: '351892178923996', chip: '21 99345 9100' },
  { modelo: 'Galaxy A15', serie: 'RQ8X500HF1M', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '352467924067387/ 353420744067383', chip: '21 99126 8225' },
  { modelo: 'Galaxy A15', serie: 'RX8XC0295QA', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296341167166/ 359061441167169', chip: '21 99118 7473' },
  { modelo: 'Galaxy A15', serie: '', modeloTel: '', anatel: '', imeiEsim: 'NÃO POSSUI', imeiFisico: '', chip: '' },
  { modelo: 'Galaxy A15', serie: 'RX8XC02963P', modeloTel: 'SMA155M/DSN', anatel: '19825-23-00953', imeiEsim: 'NÃO POSSUI', imeiFisico: '355296341167281/ 359061441167284', chip: '21 99369 5831' },
  { modelo: 'iPhone 16 Pro Max', serie: 'LGX7HFT9RT', modeloTel: 'MYX03BE/A', anatel: '06810-24-01993', imeiEsim: '350912509772234', imeiFisico: '350912509646347', chip: '' },
  { modelo: 'iPhone 15 Pink 128GB', serie: 'LQWG0QM6G5', modeloTel: 'MTP13BR', anatel: '12757-23-01993', imeiEsim: '351240619080796', imeiFisico: '351240619071209', chip: '' },
  { modelo: 'Moto G35', serie: 'ZF525BMPQB', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '351892174535406', imeiFisico: '351892174535398', chip: '21 99258 7139' },
  { modelo: 'iPhone 6S', serie: 'DV6RV1E7GRY8', modeloTel: 'MKQM2BR/A', anatel: '', imeiEsim: 'NÃO POSSUI', imeiFisico: '35 542807 378214 0', chip: '' },
  { modelo: 'iPhone 17 Pro Max', serie: 'JY3F4763RX', modeloTel: 'MFYP4BE/A', anatel: '', imeiEsim: '35 777814745949 9', imeiFisico: '35 777814 764708 5', chip: '' },
  { modelo: 'iPhone 17 Pro Max', serie: 'J4DK46CWJJ', modeloTel: 'MFYP4BE/A', anatel: '', imeiEsim: '35 790325 289923 6', imeiFisico: '25 790325 251548 5', chip: '21 99290 6527' },
  { modelo: 'Moto G35 5G', serie: 'ZF525BM8PV', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '351892174543061', imeiFisico: '351892174543053', chip: 'Não' },
  { modelo: 'Moto G35 5G', serie: 'ZF525BMPBP', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '351892174546486', imeiFisico: '351892174546478', chip: 'Não' },
  { modelo: 'Moto G35 5G', serie: 'Z525CLNQR', modeloTel: 'XT2433-1', anatel: '07104-24-00330', imeiEsim: '350321974578888 23', imeiFisico: '350321974578870 23', chip: '21 99359 6985' },
  { modelo: 'iPhone 15', serie: 'FNMGG4NYVR', modeloTel: '', anatel: '', imeiEsim: '', imeiFisico: '', chip: '' },
  { modelo: 'Galaxy A15', serie: 'RQ8X500H7SZ', modeloTel: 'SMA155M/DSN', anatel: '', imeiEsim: 'NÃO POSSUI', imeiFisico: '352467924064996/ 353420744064992', chip: 'Não' },
  { modelo: 'Moto G35 5G', serie: 'ZF525JXFKZ', modeloTel: 'XT2433-2', anatel: '07104-24-00330', imeiEsim: '354326941123227', imeiFisico: '', chip: '' },
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

    const linhas = TELEFONES.map(t => {
      const equipamento = t.modeloTel ? `${t.modelo} (${t.modeloTel})` : t.modelo;
      const obsPartes = [];
      if (t.anatel) obsPartes.push(`Anatel: ${t.anatel}`);
      if (t.imeiEsim) obsPartes.push(`IMEI eSIM: ${t.imeiEsim}`);
      if (t.imeiFisico) obsPartes.push(`IMEI Físico: ${t.imeiFisico}`);
      if (t.chip) obsPartes.push(`Chip: ${t.chip}`);
      const id = 'EQP-' + String(seq).padStart(4, '0');
      seq++;
      return [id, 'Mobile/MoJo', equipamento, '', t.serie || '', 'Operacional', 'A definir', agora, obsPartes.join(' | '), agora, 'Externo'];
    });

    const linhaInicial = await proximaLinhaLivre('Equipamentos');
    await inserirLinhas('Equipamentos', 'K', linhas, linhaInicial);
    log.push(`✓ ${linhas.length} telefones gravados em Equipamentos a partir da linha ${linhaInicial}, alocação "A definir"`);

    const movLinha = await proximaLinhaLivre('MovimentacoesEquipamento');
    await inserirLinhas('MovimentacoesEquipamento', 'H', [[
      agora, '—', '—', '—', 'Carga em lote (Externo)', 'Sistema (import lote)',
      `Importação da frota de telefones do parque externo — ${linhas.length} unidades (Moto G35 / Galaxy A15 / iPhone), alocação pendente de definição`, 'cadastro'
    ]], movLinha);
    log.push('✓ Movimentação de carga registrada no histórico');

    return res.status(200).json({ ok: true, totalImportado: linhas.length, log });
  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
