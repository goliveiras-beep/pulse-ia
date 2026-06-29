// api/upload-atestado.js — Upload de atestado para Google Drive
export const config = { maxDuration: 30 };
import { createHash, createSign } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const nome = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now()-parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome+ts)) return null;
    return { nome };
  } catch { return null; }
}

async function getDriveToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwt = `${header}.${payload}.${sig}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token error: ' + JSON.stringify(d));
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

    const token = await getDriveToken();
    const safeName = `Atestado_${session.nome.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}_${fileName}`;

    // FIX: usar multipart upload em requisição única em vez de duas chamadas separadas
    // Isso evita o erro de quota na criação do metadata
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
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${delimiter}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      }
    );

    const uploadData = await uploadRes.json();

    // FIX: se a resposta veio com erro de quota mas o arquivo pode ter sido salvo,
    // tenta buscar pelo nome na pasta para confirmar
    let fileId = uploadData.id;

    if (!fileId) {
      // Tenta encontrar o arquivo que pode ter sido criado mesmo com erro
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(safeName)}'+and+'${folderId}'+in+parents&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        fileId = searchData.files[0].id;
      }
    }

    if (!fileId) {
      throw new Error('Upload error: ' + JSON.stringify(uploadData));
    }

    // Torna o arquivo público (leitura)
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
    } catch (e) {
      console.warn('Permissão pública não aplicada:', e.message);
    }

    const url = `https://drive.google.com/file/d/${fileId}/view`;
    return res.status(200).json({ ok: true, url, id: fileId });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
