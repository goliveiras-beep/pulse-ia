// lib/booking/extract-text.js
// arquivo (PDF/DOCX/TXT/EML) -> texto bruto, pronto pra extracao por IA.
// Ver Especificacao - Modulo de Booking, secao 4.2.

// Limpeza de print de Gmail - obrigatoria (spec 4.2). Quatro dos seis documentos
// de referencia sao impressoes de e-mail do Gmail, e o cabecalho de data/hora do
// print ("25/05/26, 12:56") confunde a extracao da data do evento.
const LINHAS_RUIDO_GMAIL = [
  /^https:\/\/mail\.google\.com\//,
  /^\d{1,2}\/\d{2}\/\d{2},\s+\d{1,2}:\d{2}\s*$/,
  /^\d+\/\d+$/, // paginacao
];

export function limparRuidoGmail(texto) {
  return String(texto)
    .split('\n')
    .filter((linha) => !LINHAS_RUIDO_GMAIL.some((re) => re.test(linha.trim())))
    .join('\n');
}

// Colapsa so espacos horizontais - NUNCA achatar quebra de linha (spec 4.2: achatar
// destroi o alinhamento que separa "AUDIO 1: X" de "AUDIO 2: Y", e o mapa de audio
// vira lixo).
export function colapsarEspacosHorizontais(texto) {
  return String(texto)
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n');
}

export class DocumentoEscaneadoError extends Error {
  constructor(paginasRuins, totalPaginas) {
    super(
      `Documento parece ser um scan/imagem (paginas sem texto: ${paginasRuins.join(', ')} de ${totalPaginas}). ` +
      `Peca o documento original ao fornecedor - nao tente OCR.`
    );
    this.name = 'DocumentoEscaneadoError';
    this.paginasRuins = paginasRuins;
    this.totalPaginas = totalPaginas;
  }
}

// Teste por pagina, nao no documento inteiro (spec 4.2): medir o total deixa
// passar um PDF de 20 paginas em que so uma tem texto de verdade.
const MIN_CHARS_NAO_ESPACO_POR_PAGINA = 40;

export function checarPaginasEscaneadas(paginas) {
  const paginasRuins = [];
  paginas.forEach((texto, i) => {
    const naoEspaco = String(texto).replace(/\s/g, '').length;
    if (naoEspaco < MIN_CHARS_NAO_ESPACO_POR_PAGINA) paginasRuins.push(i + 1);
  });
  if (paginasRuins.length) throw new DocumentoEscaneadoError(paginasRuins, paginas.length);
}

async function textoDePdf(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const paginas = Array.isArray(text) ? text : [text];
  checarPaginasEscaneadas(paginas);
  return paginas.join('\n\n');
}

async function textoDeDocx(buffer) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function textoDeEml(buffer) {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(buffer);
  const corpo = parsed.text || parsed.html || '';
  const anexosDocumento = (parsed.attachments || []).filter((a) =>
    /\.(pdf|docx?)$/i.test(a.filename || '') && a.size > 1024
  );
  const textosAnexos = [];
  for (const anexo of anexosDocumento) {
    try {
      textosAnexos.push(await textoDeArquivo({
        buffer: anexo.content, fileName: anexo.filename, mimeType: anexo.contentType,
      }));
    } catch (e) {
      textosAnexos.push(`[falha ao extrair anexo "${anexo.filename}": ${e.message}]`);
    }
  }
  return [corpo, ...textosAnexos].filter(Boolean).join('\n\n---\n\n');
}

function extensaoDe(fileName, mimeType) {
  const nome = String(fileName || '').toLowerCase();
  if (nome.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (nome.endsWith('.docx') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (nome.endsWith('.eml') || mimeType === 'message/rfc822') return 'eml';
  return 'txt';
}

// arquivo: { buffer: Buffer, fileName: string, mimeType?: string } -> texto limpo, pronto pro prompt.
export async function textoDeArquivo({ buffer, fileName, mimeType }) {
  const ext = extensaoDe(fileName, mimeType);
  let bruto;
  if (ext === 'pdf') bruto = await textoDePdf(buffer);
  else if (ext === 'docx') bruto = await textoDeDocx(buffer);
  else if (ext === 'eml') return limparRuidoGmail(colapsarEspacosHorizontais(await textoDeEml(buffer)));
  else bruto = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);

  return limparRuidoGmail(colapsarEspacosHorizontais(bruto));
}
