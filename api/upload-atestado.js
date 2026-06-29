// api/upload-atestado.js — Upload de atestado para Google Drive
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';

const COOKIE_NAME = 'pulse_session';
function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }

function getSession(req) {
  const cookies = {};
  (req.headers.cookie||'').split(';').forEach(c=>{const[k,...v]=c.trim().split('=');cookies[k.trim()]=v.join('=');});
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token,'base64').toString('utf8');
    const [nome,h,ts] = d.split('|');
    if (Date.now()-parseInt(ts) > 7*24*3600*1000) return null;
    if (h !== hash(nome+ts)) return null;
    return { nome };
  } catch { return null; }
}

async function getAccessToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  
  const { createSign } = await import('crypto');
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
  return d.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método inválido' });

  try {
    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Envie um arquivo multipart/form-data' });
    }

    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'Boundary não encontrado' });

    // Parse boundary
    const parts = body.toString('binary').split(`--${boundary}`);
    let fileBuffer = null, fileName = 'atestado.pdf', mimeType = 'application/pdf';
    
    for (const part of parts) {
      if (part.includes('Content-Disposition') && part.includes('filename')) {
        const nameMatch = part.match(/filename="([^"]+)"/);
        if (nameMatch) fileName = nameMatch[1];
        const typeMatch = part.match(/Content-Type: ([^\r\n]+)/);
        if (typeMatch) mimeType = typeMatch[1].trim();
        const dataStart = part.indexOf('\r\n\r\n') + 4;
        const dataEnd = part.lastIndexOf('\r\n');
        if (dataStart > 4 && dataEnd > dataStart) {
          fileBuffer = Buffer.from(part.slice(dataStart, dataEnd), 'binary');
        }
      }
    }

    if (!fileBuffer) return res.status(400).json({ error: 'Arquivo não encontrado no upload' });

    // Get Drive access token
    const token = await getAccessToken();
    
    // Create folder "Atestados Pulse" if it doesn't exist, or use DRIVE_FOLDER_ID
    const folderId = process.env.DRIVE_ATESTADOS_FOLDER_ID || 'root';

    // Upload to Drive
    const safeName = `Atestado_${session.nome.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}_${fileName}`;
    
    const metadata = JSON.stringify({ name: safeName, parents: [folderId] });
    const boundary2 = '-------314159265358979323846';
    const uploadBody = [
      `--${boundary2}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary2}`,
      `Content-Type: ${mimeType}`,
      'Content-Transfer-Encoding: base64',
      '',
      fileBuffer.toString('base64'),
      `--${boundary2}--`,
    ].join('\r\n');

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary2}"`,
      },
      body: uploadBody,
    });
    
    const uploadData = await uploadRes.json();
    if (!uploadData.id) throw new Error(JSON.stringify(uploadData));

    // Make file readable by anyone with link
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return res.status(200).json({ ok: true, url: uploadData.webViewLink, id: uploadData.id });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
