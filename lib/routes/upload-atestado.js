// api/upload-atestado.js — Upload centralizado usando token do gestor
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../google-auth.js';

const COOKIE_NAME = 'pulse_session';
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    cookies[k.trim()] = v.join('=');
  });
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts) > 7 * 24 * 3600 * 1000) return null;
    if (h !== hash(data + ts)) return null;
    const sessionParts = data.split('~~');
    const nome = sessionParts[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

// Quem precisa acessar o atestado pelo link direto do Drive: a própria pessoa que enviou
// (pra ver o próprio anexo na tela dela) e os gestores (pra revisar a ausência). Não a
// equipe toda, nem "qualquer pessoa com o link" (achado médio do SentinelaMODE 2026-09-14 —
// dado de saúde/LGPD). Não dá pra restringir por domínio Workspace porque a equipe usa conta
// pessoal do Gmail (mesma limitação já documentada em lib/routes/repositorio.js).
async function getEmailsParaCompartilhar(nomeSolicitante) {
  try {
    const d = await sheetsRequest(SHEET_ID, '/values/Equipe!A2:N200');
    const rows = d.values || [];
    const emails = new Set();
    for (const r of rows) {
      if (!r[0] || !r[9]) continue;
      if (r[0] === nomeSolicitante || r[8] === 'gestor') emails.add(r[9].trim().toLowerCase());
    }
    return [...emails];
  } catch { return []; }
}

async function driveShareUser(fileId, email, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
  });
  if (r.status === 409) return; // já tem essa permissão
  if (!r.ok) console.warn(`Permissão de atestado não aplicada pra ${email}:`, await r.text().catch(() => ''));
}

// Renova o access_token do gestor usando o refresh_token salvo na env
async function getGestorToken() {
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('GOOGLE_DRIVE_REFRESH_TOKEN não configurado. Acesse /api/auth/drive-token para configurar.');

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
  if (!d.access_token) throw new Error('Erro ao renovar token do gestor: ' + JSON.stringify(d));
  return d.access_token;
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido' });

  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Envie multipart/form-data' });
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = contentType.split('boundary=')[1]?.split(';')[0]?.trim();
    if (!boundary) return res.status(400).json({ error: 'Boundary não encontrado' });

    // Parse multipart
    const sep = Buffer.from(`\r\n--${boundary}`);
    let fileBuffer = null, fileName = 'atestado', mimeType = 'application/octet-stream';

    let pos = body.indexOf(Buffer.from(`--${boundary}`));
    while (pos !== -1) {
      const next = body.indexOf(sep, pos + 1);
      const part = body.slice(pos + boundary.length + 4, next === -1 ? body.length : next);
      const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd !== -1) {
        const headers = part.slice(0, headerEnd).toString();
        const data = part.slice(headerEnd + 4);
        if (headers.includes('filename=')) {
          const nameMatch = headers.match(/filename="([^"]+)"/);
          if (nameMatch) fileName = nameMatch[1];
          const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
          if (typeMatch) mimeType = typeMatch[1].trim();
          fileBuffer = data.slice(-2).toString() === '\r\n' ? data.slice(0, -2) : data;
        }
      }
      pos = next;
    }

    if (!fileBuffer || fileBuffer.length < 10) {
      return res.status(400).json({ error: 'Arquivo não encontrado no upload' });
    }

    const folderId = process.env.DRIVE_ATESTADOS_FOLDER_ID;
    if (!folderId) return res.status(500).json({ error: 'DRIVE_ATESTADOS_FOLDER_ID não configurado' });

    // Usa sempre o token do gestor — upload centralizado
    const gestorToken = await getGestorToken();

    const safeName = `Atestado_${session.nome.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}_${fileName}`;

    // Upload multipart em requisição única
    const delimiter = '-------boundary_pulse_upload';
    const metaJson = JSON.stringify({ name: safeName, parents: [folderId] });

    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${delimiter}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metaJson}\r\n` +
        `--${delimiter}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${delimiter}--`),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gestorToken}`,
          'Content-Type': `multipart/related; boundary=${delimiter}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadData.id) throw new Error('Upload error: ' + JSON.stringify(uploadData));

    // Compartilha só com quem precisa ver (quem enviou + gestores) — nunca "anyone".
    try {
      const emails = await getEmailsParaCompartilhar(session.nome);
      await Promise.all(emails.map(email => driveShareUser(uploadData.id, email, gestorToken)));
    } catch (e) {
      console.warn('Permissão de atestado não aplicada:', e.message);
    }

    const url = `https://drive.google.com/file/d/${uploadData.id}/view`;
    return res.status(200).json({ ok: true, url, id: uploadData.id });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
