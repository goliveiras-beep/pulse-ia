// lib/booking/gmail.js
// Leitura (so leitura, gmail.readonly) da caixa do Lucas Malveira (lmalveira@livemode.com),
// usada como evidencia tecnica pra checagem de Booking e pros relatorios agendados
// (01_dashboard_diario_encoders.md, 02_plano_semanal_contribuicao_europa.md). Autorizado via
// /api/auth/gmail-token (ver lib/routes/gmail-token.js) - token guardado em
// GMAIL_BOOKING_REFRESH_TOKEN.
let _accessTokenCache = null; // { token, expiraEm }

async function getAccessToken() {
  if (_accessTokenCache && Date.now() < _accessTokenCache.expiraEm) return _accessTokenCache.token;

  const refreshToken = process.env.GMAIL_BOOKING_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('GMAIL_BOOKING_REFRESH_TOKEN não configurado. Autorize em /api/auth/gmail-token.');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Falha ao renovar token do Gmail: ' + JSON.stringify(d));

  _accessTokenCache = { token: d.access_token, expiraEm: Date.now() + (d.expires_in - 60) * 1000 };
  return d.access_token;
}

// Checagem simples de conexao - endereço + total de mensagens, pra confirmar que o token
// funciona sem precisar ler e-mail nenhum de verdade.
export async function testarConexaoGmail() {
  const token = await getAccessToken();
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Gmail API respondeu ${r.status}: ${await r.text().catch(() => '')}`);
  const d = await r.json();
  return { emailAddress: d.emailAddress, totalMensagens: d.messagesTotal };
}

function decodificarHeader(headers, nome) {
  return headers?.find((h) => h.name.toLowerCase() === nome.toLowerCase())?.value || null;
}

/**
 * Busca e-mails pela query de busca do Gmail (mesma sintaxe da caixa de pesquisa, ex.:
 * 'newer_than:7d (SRT OR satellite OR booking)'). Retorna só metadados (assunto, remetente,
 * data, snippet) - nunca o corpo completo, pra não arriscar expor segredo nenhum por engano
 * nos relatorios que consomem isso.
 */
export async function buscarEmails(query, maxResults = 20) {
  const token = await getAccessToken();
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const rList = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!rList.ok) throw new Error(`Gmail API (list) respondeu ${rList.status}: ${await rList.text().catch(() => '')}`);
  const dList = await rList.json();
  const ids = (dList.messages || []).map((m) => m.id);

  const mensagens = await Promise.all(ids.map(async (id) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      id: d.id,
      assunto: decodificarHeader(d.payload?.headers, 'Subject'),
      de: decodificarHeader(d.payload?.headers, 'From'),
      data: decodificarHeader(d.payload?.headers, 'Date'),
      snippet: d.snippet || '',
    };
  }));

  return mensagens.filter(Boolean);
}

// palavras "fortes" do nome do evento (competicao/times), pra cruzar com termos tecnicos -
// "LALIGA | Barcelona X Athletic Club Bilbao" -> ["LALIGA","Barcelona","Athletic","Club","Bilbao"]
function extrairPalavrasChave(nomeEvento) {
  return String(nomeEvento)
    .replace(/[|#]/g, ' ')
    .split(/\s+X\s+|\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
}

const TERMOS_TECNICOS = ['SRT', 'satellite', 'satelite', 'booking', 'parameters', 'parametros', 'signal', 'contribution', 'ETE', 'test', 'downlink', 'frequency'];

/**
 * Busca e-mails que podem ser evidencia tecnica de um evento especifico - cruza palavras do
 * nome do evento (competicao/times) com termos tecnicos comuns de booking. Best-effort: erro
 * na busca nao derruba a checagem, so retorna lista vazia.
 */
export async function buscarEmailsParaEvento(nomeEvento, { janelaDias = 30, maxResults = 5 } = {}) {
  const palavras = extrairPalavrasChave(nomeEvento);
  if (!palavras.length) return [];
  const query = `newer_than:${janelaDias}d (${TERMOS_TECNICOS.join(' OR ')}) (${palavras.map((p) => `"${p}"`).join(' OR ')})`;
  try {
    return await buscarEmails(query, maxResults);
  } catch (e) {
    console.error('buscarEmailsParaEvento falhou:', e.message);
    return [];
  }
}
