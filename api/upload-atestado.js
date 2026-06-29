// api/upload-atestado.js — Upload de atestado para Google Drive usando token do usuário
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0, 32); }

// Lê sessão definitiva: nome~~accessToken~~refreshToken|hash|ts
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
    // Formato: nome~~accessToken~~refreshToken
    const parts = data.split('~~');
    const nome = parts[0] || '';
    const accessToken = parts[1] || '';
    const refreshToken = parts[2] || '';
    if (!nome) return null;
    return { nome, accessToken, refreshToken };
  } catch { return null; }
}

// Renova o access_token usando o refresh_token
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

    // Usar token do usuário — sem problema de quota
    let userToken = session.accessToken;

    // Testa se o token ainda é válido
    if (userToken) {
      const testRes = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + userToken);
      const testData = await testRes.json();
      if (testData.error) {
        // Token expirado — renova
        userToken = await renovarToken(session.refreshToken);
      }
    }

    if (!userToken) {
      // Sem token do usuário — redireciona para login forçando novo consentimento
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente para usar o upload.' });
    }

    const safeName = `Atestado_${session.nome.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}_${fileName}`;

    // Upload multipart em requisição única usando token do usuário
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

    if (!uploadData.id) {
      throw new Error('Upload error: ' + JSON.stringify(uploadData));
    }

    // Torna o arquivo público (leitura)
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
