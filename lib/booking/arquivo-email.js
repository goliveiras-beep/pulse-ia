// lib/booking/arquivo-email.js
// Arquiva o e-mail (PDF com corpo/metadados) + anexos de um evento de Booking dentro da
// Central de Conhecimento (Google Drive), em Booking/AAAA/MM/DD - pasta criada só quando
// precisa (não pré-cria o ano inteiro). Pedido do Guilherme em 26/08/2026.
import { createSign } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buscarEmailCompleto, baixarAnexo } from './gmail.js';

const REPO_ROOT = process.env.PULSE_REPOSITORY_FOLDER_ID || '1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f';

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getDriveToken() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const hdr = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const pay = base64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const s = createSign('RSA-SHA256'); s.update(hdr + '.' + pay);
  const sig = s.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Drive token error: ' + JSON.stringify(d));
  return d.access_token;
}

async function acharOuCriarPasta(parentId, nome, token) {
  const q = `'${parentId}' in parents and name='${nome.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const rBusca = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dBusca = await rBusca.json();
  if (dBusca.files?.length) return dBusca.files[0].id;

  const rCria = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const dCria = await rCria.json();
  if (dCria.error) throw new Error(JSON.stringify(dCria.error));
  return dCria.id;
}

// Booking/AAAA/MM/DD - so cria a pasta do dia quando ha algo pra guardar nele.
async function pastaDoDia(data, token) {
  const ano = String(data.getFullYear());
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');

  const pastaBooking = await acharOuCriarPasta(REPO_ROOT, 'Booking', token);
  const pastaAno = await acharOuCriarPasta(pastaBooking, ano, token);
  const pastaMes = await acharOuCriarPasta(pastaAno, mes, token);
  return acharOuCriarPasta(pastaMes, dia, token);
}

async function driveUpload(parentId, fileName, mimeType, buffer, token) {
  const delimiter = '-------boundary_pulse_booking_arquivo';
  const metaJson = JSON.stringify({ name: fileName, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(`--${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${delimiter}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${delimiter}--`),
  ]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${delimiter}`, 'Content-Length': String(body.length) },
    body,
  });
  const d = await r.json();
  if (!d.id) throw new Error('Upload error: ' + JSON.stringify(d));
  return d;
}

function quebrarLinha(texto, fonte, tamanho, larguraMax) {
  const linhas = [];
  for (const paragrafo of String(texto).split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) > larguraMax && atual) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = tentativa;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

// PDF simples (texto), sem tentar reproduzir formatacao HTML do e-mail - so o essencial:
// metadados + corpo em texto puro, legivel, pra fins de auditoria/recuperacao.
async function gerarPdfDoEmail(email, nomeEvento) {
  const doc = await PDFDocument.create();
  const fonteNormal = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const larguraPagina = 595, alturaPagina = 842, margem = 50;
  const larguraTexto = larguraPagina - margem * 2;

  const cabecalho = [
    ['Evento:', nomeEvento || '(não identificado)'],
    ['Assunto:', email.assunto || '(sem assunto)'],
    ['De:', email.de || ''],
    ['Para:', email.para || ''],
    ['Data:', email.data || ''],
  ];

  const linhasCorpo = quebrarLinha(email.corpo || '(sem corpo)', fonteNormal, 10, larguraTexto);

  let pagina = doc.addPage([larguraPagina, alturaPagina]);
  let y = alturaPagina - margem;

  const novaPaginaSeNecessario = () => {
    if (y < margem + 20) { pagina = doc.addPage([larguraPagina, alturaPagina]); y = alturaPagina - margem; }
  };

  pagina.drawText('Arquivo de E-mail — Booking de Sinal', { x: margem, y, size: 14, font: fonteNegrito });
  y -= 24;
  for (const [rotulo, valor] of cabecalho) {
    novaPaginaSeNecessario();
    pagina.drawText(rotulo, { x: margem, y, size: 10, font: fonteNegrito });
    pagina.drawText(String(valor).slice(0, 100), { x: margem + 60, y, size: 10, font: fonteNormal, color: rgb(0.2, 0.2, 0.2) });
    y -= 16;
  }
  y -= 10;
  novaPaginaSeNecessario();
  pagina.drawLine({ start: { x: margem, y }, end: { x: larguraPagina - margem, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 20;

  for (const linha of linhasCorpo) {
    novaPaginaSeNecessario();
    pagina.drawText(linha, { x: margem, y, size: 10, font: fonteNormal });
    y -= 14;
  }

  return Buffer.from(await doc.save());
}

function nomeArquivoSeguro(s) {
  return String(s || 'sem-nome').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/**
 * Arquiva um e-mail (metadado de buscarEmails/buscarEmailsParaEvento, precisa só do .id)
 * relacionado a um evento: gera PDF do e-mail + baixa todos os anexos, sobe tudo pra
 * Central de Conhecimento / Booking / AAAA / MM / DD (data do evento, não do e-mail).
 * Best-effort: erro aqui não deve derrubar a checagem/cron que chamou isso.
 */
export async function arquivarEmailDoEvento({ emailId, nomeEvento, dataEvento }) {
  const email = await buscarEmailCompleto(emailId);
  const token = await getDriveToken();
  const pastaDia = await pastaDoDia(new Date(dataEvento), token);

  const baseNome = nomeArquivoSeguro(`${nomeEvento || 'evento'}_${email.assunto || emailId}`);
  const pdfBuffer = await gerarPdfDoEmail(email, nomeEvento);
  const pdfUpload = await driveUpload(pastaDia, `${baseNome}.pdf`, 'application/pdf', pdfBuffer, token);

  const anexosEnviados = [];
  for (const anexo of email.anexos) {
    try {
      const buffer = await baixarAnexo(emailId, anexo.attachmentId);
      const up = await driveUpload(pastaDia, `${baseNome}_${nomeArquivoSeguro(anexo.filename)}`, anexo.mimeType || 'application/octet-stream', buffer, token);
      anexosEnviados.push({ nome: anexo.filename, driveId: up.id });
    } catch (e) {
      console.error(`arquivarEmailDoEvento: falha no anexo ${anexo.filename}:`, e.message);
    }
  }

  return { pastaDia, pdfDriveId: pdfUpload.id, anexos: anexosEnviados };
}
