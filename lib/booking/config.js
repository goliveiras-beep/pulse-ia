// lib/booking/config.js
// Configuracao editavel (via tela) de quais campos do Airtable contam como "parametro
// preenchido" pra cada meio de recepcao, na checagem de pendencias (checagem.js). Guardado
// na planilha do Pulse (Google Sheets), aba propria "BookingConfig" - mesmo padrao de
// chave/valor que "PulseConfig" ja usa (ver lib/routes/publicar.js), so que aqui a "chave"
// e o meio e o "valor" e a lista de campos, separados por virgula.
import { sheetsRequest } from '../google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ABA = 'BookingConfig';

// Usado se a aba ainda nao existir ou nao tiver linha pra aquele meio - e o comportamento
// de antes desta tela existir, entao ninguem perde a checagem que ja tinha ao abrir a tela
// pela primeira vez.
export const CAMPOS_PADRAO_POR_MEIO = {
  'Satélite': ['Satélite', 'Transponder', 'Downlink', 'Uplink'],
  SRT: ['SRT Main', 'SRT Backup'],
  Fibra: ['Fibra', 'Bandwidth', 'Origem do Sinal (fibra)'],
  LiveU: ['Mochila LiveU'],
};

// Lista de referencia pra tela de configuracao - todo campo candidato por meio, mesmo os
// que nao estao marcados hoje. Vem da introspeccao real da tabela Booking do Airtable
// (ver sessao de descoberta do schema); TVU/SAT 4K/RTMP ainda nao tem campo dedicado
// conhecido, entao ficam de fora por enquanto.
export const CAMPOS_CANDIDATOS_POR_MEIO = {
  'Satélite': ['Satélite', 'Transponder', 'Modulação', 'Polarização', 'Downlink', 'Uplink', 'Symbol Rate', 'FEC', 'Roll OFF', 'Serviço'],
  SRT: ['SRT Main', 'SRT Backup', 'Bit Rate'],
  Fibra: ['Fibra', 'Bandwidth', 'Origem do Sinal (fibra)'],
  LiveU: ['Mochila LiveU'],
};

async function getSheet(range) {
  try {
    const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch {
    return [];
  }
}

export async function getMapaCamposPorMeio() {
  const linhas = await getSheet(`${ABA}!A2:B20`);
  if (!linhas.length) return { ...CAMPOS_PADRAO_POR_MEIO };

  const mapa = {};
  for (const meio of Object.keys(CAMPOS_CANDIDATOS_POR_MEIO)) {
    const linha = linhas.find((r) => r[0] === meio);
    mapa[meio] = linha ? String(linha[1] || '').split(',').map((s) => s.trim()).filter(Boolean) : (CAMPOS_PADRAO_POR_MEIO[meio] || []);
  }
  return mapa;
}

async function garantirAba() {
  try {
    await sheetsRequest(SHEET_ID, `/values/${ABA}!A1`);
  } catch {
    try {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title: ABA } } }] });
      await sheetsRequest(SHEET_ID, `/values/${ABA}!A1:B1?valueInputOption=USER_ENTERED`, 'PUT', { values: [['meio', 'campos']] });
    } catch {
      // corrida entre duas requisicoes criando a aba ao mesmo tempo - ignora, a aba ja existe
    }
  }
}

// Sobrescreve a configuracao inteira (poucas linhas, mais simples que fazer upsert linha a
// linha) - mapa = { 'Satélite': ['Satélite','Downlink',...], SRT: [...], ... }.
export async function salvarMapaCamposPorMeio(mapa) {
  await garantirAba();
  const linhas = Object.entries(mapa).map(([meio, campos]) => [meio, campos.join(',')]);
  await sheetsRequest(SHEET_ID, `/values/${ABA}!A2:B20?valueInputOption=USER_ENTERED`, 'PUT', {
    values: linhas.length ? linhas : [['', '']],
  });
}
