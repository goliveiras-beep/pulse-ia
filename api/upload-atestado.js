// api/upload-atestado.js — Upload de atestado via token OAuth do usuário
export const config = { maxDuration: 30 };
import { createHash } from 'crypto';
import { sheetsRequest } from '../lib/google-auth.js';

const COOKIE_NAME = 'pulse_session';
const DRIVE_TOKEN_COOKIE = 'pulse_drive_token';
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
    return { nome, driveToken: cookies[DRIVE_TOKEN_COOKIE] };
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

    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const boundary = contentType.split('boundary=')[1]?.split(';')[0]?.trim();
    if (!boundary) return res.status(400).json({ error: 'Boundary não encontrado' });

    // Parse multipart
    const sep = Buffer.from(`--${boundary}`);
    let fileBuffer = null, fileName = 'atestado', mimeType = 'application/octet-stream';
    let driveToken = null;

    const parts = [];
    let start = 0;
    while (true) {
      const idx = body.indexOf(sep, start);
      if (idx === -1) break;
      if (start > 0) parts.push(body.slice(start, idx - 2));
      start = idx + sep.length + 2;
    }

    for (const part of parts) {
      const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd).toString();
      const data = part.slice(headerEnd + 4);
      
      if (headers.includes('name="driveToken"')) {
        driveToken = data.toString().trim();
      } else if (headers.includes('filename=')) {
        const nameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) fileName = nameMatch[1];
        const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
        if (typeMatch) mimeType = typeMatch[1].trim();
        // Remove trailing CRLF if present
        fileBuffer = data.slice(-2).toString() === '\r\n' ? data.slice(0, -2) : data;
      }
    }

    if (!fileBuffer) return res.status(400).json({ error: 'Arquivo não encontrado' });
    if (!driveToken) return res.status(400).json({ error: 'Token do Drive não encontrado. Faça login novamente.' });

    // Upload to Drive using user's OAuth token
    const folderId = process.env.DRIVE_ATESTADOS_FOLDER_ID;
    const safeName = `Atestado_${session.nome.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}_${fileName}`;
    
    const metadata = { name: safeName };
    if (folderId) metadata.parents = [folderId];

    const boundary2 = 'atestado_boundary_' + Date.now();
    const metaStr = JSON.stringify(metadata);
    const uploadBody = Buffer.concat([
      Buffer.from(`--${boundary2}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaStr}\r\n--${boundary2}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary2}--`),
    ]);

    const uploadRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'Content-Type': `multipart/related; boundary="${boundary2}"`,
        },
        body: uploadBody,
      }
    );

    const uploadData = await uploadRes.json();
    if (!uploadData.id) throw new Error(JSON.stringify(uploadData));

    // Make readable by anyone with link
    await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    return res.status(200).json({ ok: true, url: uploadData.webViewLink, id: uploadData.id });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
