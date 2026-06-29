// api/upload-atestado.js — Upload de atestado para Google Drive usando token do usuário
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
const FOLDER_NAME = 'Atestados Pulse';

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
    const accessToken = sessionParts[1] || '';
    const refreshToken = sessionParts[2] || '';
    if (!nome) return null;
    return { nome, accessToken, refreshToken };
  } catch { return null; }
}

async function renovarToken(refreshToken) {
  if (!refreshToken) return null;
  try {
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
    return d.access_token || null;
  } catch { return null; }
}

async function getValidToken(session) {
  let token = session.accessToken;
  if (token) {
    const test = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
    const data = await test.json();
    if (data.error) token = await renovarToken(session.refreshToken);
  } else {
    token = await renovarToken(session.refreshToken);
  }
  return token;
}

// Busca ou cria a pasta "Atestados Pulse" no Drive do usuário
async function getOrCreateFolder(token) {
  // Busca pasta existente criada pelo app
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Cria a pasta se não existir
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error('Erro ao criar pasta: ' + JSON.stringify(createData));
  return createData.id;
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

    // Valida e renova token
    const userToken = await getValidToken(session);
    if (!userToken) {
      return res.status(401).json({ error: 'Sessão expirada. Faça logout e login novamente.' });
    }

    // Busca ou cria pasta no Drive do usuário
    const folderId = await getOrCreateFolder(userToken);

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
          Authorization: `Bearer ${userToken}`,
          'Content-Type': `multipart/related; boundary=${delimiter}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadData.id) throw new Error('Upload error: ' + JSON.stringify(uploadData));

    // Torna o arquivo público
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
    } catch (e) {
      console.warn('Permissão pública não aplicada:', e.message);
    }

    const url = `https://drive.google.com/file/d/${uploadData.id}/view`;
    return res.status(200).json({ ok: true, url, id: uploadData.id });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
