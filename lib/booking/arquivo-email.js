// lib/booking/arquivo-email.js
// Arquiva o e-mail (PDF com corpo/metadados) + anexos de um evento de Booking dentro da
// Central de Conhecimento (Google Drive), em Booking/AAAA/Mes/DD - pasta criada só quando
// precisa (não pré-cria o ano inteiro). Pedido do Guilherme em 26/08/2026.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buscarEmailCompleto, baixarAnexo } from './gmail.js';

const REPO_ROOT = process.env.PULSE_REPOSITORY_FOLDER_ID || '1dZkR61MTm8oaHq-Ycxs53bU8fJlb7x_f';
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// A service account (JWT proprio) NAO tem cota de armazenamento - Drive recusa
// files.create fora de Shared Drive com "Service Accounts do not have storage quota"
// (confirmado em producao). Por isso, diferente de repositorio.js, aqui usamos o mesmo
// refresh token do GESTOR que upload-atestado.js ja usa com sucesso pra upload real -
// o arquivo fica com dono de verdade, com cota.
// Cacheado em memória por instância - sem isso, cada e-mail arquivado (checagem.js chama
// isso uma vez por e-mail, em serie) pagava seu proprio round-trip de renovacao de token,
// somando segundos numa checagem com varios e-mails pra arquivar.
let _cacheTokenDrive = null; // {token, exp}
async function getDriveToken() {
  if (_cacheTokenDrive && _cacheTokenDrive.exp > Date.now() + 60_000) return _cacheTokenDrive.token;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('GOOGLE_DRIVE_REFRESH_TOKEN não configurado.');
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
  _cacheTokenDrive = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}

async function acharOuCriarPasta(parentId, nome, token) {
  const q = `'${parentId}' in parents and name='${nome.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const rBusca = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime&fields=files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dBusca = await rBusca.json();
  // se existir mais de uma (duplicata de uma corrida antiga), usa sempre a mais antiga -
  // determinístico, converge pra uma so mesmo com pasta duplicada existente.
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

// cache de pasta-do-dia dentro da MESMA execucao (varios e-mails do mesmo dia nao
// refazem a cadeia de busca/criacao 4x cada) - nao precisa sobreviver entre invocacoes,
// so evita trabalho redundante dentro do limite de tempo de uma chamada so.
const _cachePastaDia = new Map();

// Booking/AAAA/Mes/DD - so cria a pasta do dia quando ha algo pra guardar nele.
async function pastaDoDia(data, token) {
  const ano = String(data.getFullYear());
  const mes = MESES_PT[data.getMonth()];
  const dia = String(data.getDate()).padStart(2, '0');
  const chave = `${ano}-${mes}-${dia}`;
  if (_cachePastaDia.has(chave)) return _cachePastaDia.get(chave);

  const pastaBooking = await acharOuCriarPasta(REPO_ROOT, 'Booking', token);
  const pastaAno = await acharOuCriarPasta(pastaBooking, ano, token);
  const pastaMes = await acharOuCriarPasta(pastaAno, mes, token);
  const pastaDia = await acharOuCriarPasta(pastaMes, dia, token);
  _cachePastaDia.set(chave, pastaDia);
  return pastaDia;
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

// pdf-lib so codifica WinAnsi (Windows-1252) com a fonte padrao Helvetica - qualquer
// caractere fora disso (emoji, simbolo raro, espaco de largura zero - comuns em corpo de
// e-mail real) faz drawText() lancar erro e derruba o arquivamento inteiro. Ja apareceu
// dois motivos DIFERENTES disso em produção: emoji/simbolo fora de WinAnsi, e depois o
// caractere de controle \r (0x0D) que sobra das quebras de linha \r\n do e-mail - WinAnsi
// tambem nao aceita caractere de controle cru, mesmo estando dentro de 0x00-0xFF.
function sanitizarParaPdf(texto) {
  return String(texto)
    .replace(/\r\n/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '--')
    .replace(/…/g, '...')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0B-\x1F]/g, '') // controle cru (inclui \r sobrando) - nao existe em WinAnsi
    .replace(/[^\x00-\xFF]/g, '?'); // qualquer outro fora de WinAnsi (emoji etc.)
}

function quebrarLinha(texto, fonte, tamanho, larguraMax) {
  const linhas = [];
  for (const paragrafo of sanitizarParaPdf(texto).split('\n')) {
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
    ['Evento:', nomeEvento || '(nao identificado)'],
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

  pagina.drawText('Arquivo de E-mail - Booking de Sinal', { x: margem, y, size: 14, font: fonteNegrito });
  y -= 24;
  for (const [rotulo, valor] of cabecalho) {
    novaPaginaSeNecessario();
    pagina.drawText(sanitizarParaPdf(rotulo), { x: margem, y, size: 10, font: fonteNegrito });
    pagina.drawText(sanitizarParaPdf(String(valor).slice(0, 100)), { x: margem + 60, y, size: 10, font: fonteNormal, color: rgb(0.2, 0.2, 0.2) });
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
 * Central de Conhecimento / Booking / AAAA / Mes / DD (data do evento, não do e-mail).
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
