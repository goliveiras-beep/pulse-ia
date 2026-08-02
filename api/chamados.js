// api/chamados.js — Abertura e gestão de chamados de equipamento (defeito, manutenção,
// perda/extravio, dano). Acessível a gestor e colaborador; ações de gestão são gestor-only.
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
import { createHash } from 'crypto';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const COOKIE_NAME = 'pulse_session';
const COOKIE_MAX = 60 * 60 * 24 * 7;

function hash(s) { return createHash('sha256').update(s + 'pulse2026').digest('hex').slice(0,32); }
function parseCookies(cookieHeader) {
  const cookies = {};
  (cookieHeader||'').split(';').forEach(c => {
    const cookieParts = c.trim().split('=');
    const k = cookieParts.shift();
    cookies[k] = cookieParts.join('=');
  });
  return cookies;
}
function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  try {
    const d = Buffer.from(token, 'base64').toString('utf8');
    const lastPipe = d.lastIndexOf('|');
    const secondPipe = d.lastIndexOf('|', lastPipe - 1);
    const data = d.slice(0, secondPipe);
    const h = d.slice(secondPipe + 1, lastPipe);
    const ts = d.slice(lastPipe + 1);
    if (Date.now() - parseInt(ts, 10) > COOKIE_MAX * 1000) return null;
    if (h !== hash(data + ts)) return null;
    if (data.startsWith('~~OAUTH~~')) return null;
    const nome = data.split('~~')[0];
    if (!nome) return null;
    return { nome };
  } catch { return null; }
}

async function getSheet(range) {
  try { const d = await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}`); return d.values || []; }
  catch { return []; }
}
async function setSheet(range, values) {
  await sheetsRequest(SHEET_ID, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', { values });
}
async function proximaLinhaLivre(sheetName) {
  const atual = await getSheet(`${sheetName}!A2:A5000`);
  return atual.length + 2;
}
async function inserirLinhas(sheetName, colUltima, linhas, linhaInicial) {
  const fim = linhaInicial + linhas.length - 1;
  await setSheet(`${sheetName}!A${linhaInicial}:${colUltima}${fim}`, linhas);
}
function getBRT() {
  const a = new Date();
  return new Date(a.getTime() + ((-3*60) - a.getTimezoneOffset()) * 60000);
}
function fmtTimestamp(d) {
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const TIPOS_PROBLEMA = ['Defeito', 'Manutenção preventiva', 'Perda/Extravio', 'Dano', 'Outro'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Urgente'];
const STATUS_CHAMADO = ['Aberto', 'Em andamento', 'Aguardando peça', 'Finalizado', 'Cancelado'];
const STATUS_FECHADO = ['Finalizado', 'Cancelado'];

// Renova o access_token do gestor a partir do refresh_token salvo na env — mesmo padrão usado
// em upload-atestado.js, upload centralizado (não é a conta pessoal de quem está anexando).
async function getGestorDriveToken() {
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

// Acha (ou cria, na primeira vez) a subpasta "Chamados" dentro da mesma pasta do Drive que já
// recebe os atestados — mantém os anexos de manutenção separados por tipo, sem precisar de uma
// env var nova. Reconsultado a cada upload (sem cache entre invocações da function).
async function garantirSubpastaChamados(gestorToken) {
  const parentId = process.env.DRIVE_ATESTADOS_FOLDER_ID;
  if (!parentId) throw new Error('DRIVE_ATESTADOS_FOLDER_ID não configurado');
  const q = encodeURIComponent(`name='Chamados' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${gestorToken}` },
  });
  const listData = await listRes.json();
  if (listData.files?.[0]?.id) return listData.files[0].id;
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${gestorToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chamados', mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error('Erro ao criar subpasta Chamados: ' + JSON.stringify(createData));
  return createData.id;
}

// Dentro de "Chamados", garante uma subpasta com o ID do chamado (ex: "CHM-0007") — assim os
// anexos de cada chamado ficam agrupados, em vez de todos misturados numa pasta só.
async function garantirSubpastaChamado(gestorToken, chamadosFolderId, chamadoId) {
  const q = encodeURIComponent(`name='${chamadoId}' and mimeType='application/vnd.google-apps.folder' and '${chamadosFolderId}' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${gestorToken}` },
  });
  const listData = await listRes.json();
  if (listData.files?.[0]?.id) return listData.files[0].id;
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${gestorToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: chamadoId, mimeType: 'application/vnd.google-apps.folder', parents: [chamadosFolderId] }),
  });
  const createData = await createRes.json();
  if (!createData.id) throw new Error('Erro ao criar subpasta do chamado ' + chamadoId + ': ' + JSON.stringify(createData));
  return createData.id;
}

// Garante a subpasta (mesma lógica de garantirSubpastaChamados) e devolve o link direto pra ela,
// pra mostrar um "Abrir pasta no Drive" na lista — assim a pasta já existe mesmo antes do primeiro
// anexo, em vez de só aparecer depois que alguém sobe um arquivo. Retorna null se o Drive do gestor
// não estiver configurado (não trava a página de chamados por isso).
async function obterUrlPastaAnexos() {
  try {
    const gestorToken = await getGestorDriveToken();
    const folderId = await garantirSubpastaChamados(gestorToken);
    return `https://drive.google.com/drive/folders/${folderId}`;
  } catch (e) {
    console.error('obterUrlPastaAnexos falhou:', e.message);
    return null;
  }
}

async function registrarMovimentacaoEquipamento({ id, equipamento, de, para, responsavel, observacao, tipo }) {
  const linha = await proximaLinhaLivre('MovimentacoesEquipamento');
  await inserirLinhas('MovimentacoesEquipamento', 'H', [[
    fmtTimestamp(getBRT()), id, equipamento, de || '—', para || '—', responsavel, observacao || '', tipo
  ]], linha);
}

// Expande a grade da aba Chamados antes de escrever numa coluna nova (senão a API rejeita
// escrita fora dos limites atuais — mesmo bug já corrigido em Equipamentos) e escreve o
// cabeçalho se estiver faltando.
async function garantirColunaChamados(sheets, letra, indiceColuna, nomeCabecalho) {
  try {
    const atual = await getSheet(`Chamados!${letra}1:${letra}1`);
    if (atual[0]?.[0]) return;
    const chSheetMeta = sheets.find(s => s.properties.title === 'Chamados');
    const colAtual = chSheetMeta?.properties.gridProperties?.columnCount || 12;
    if (colAtual < indiceColuna) {
      await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: chSheetMeta.properties.sheetId, gridProperties: { columnCount: indiceColuna } },
            fields: 'gridProperties.columnCount'
          }
        }]
      });
    }
    await setSheet(`Chamados!${letra}1`, [[nomeCabecalho]]);
  } catch {
    // linhas sem essa coluna continuam com o campo tratado como vazio na leitura
  }
}

async function garantirAbaChamados() {
  const spreadsheet = await sheetsRequest(SHEET_ID, '');
  const sheets = spreadsheet.sheets || [];
  const temChamados = sheets.some(s => s.properties.title === 'Chamados');
  if (!temChamados) {
    await sheetsRequest(SHEET_ID, ':batchUpdate', 'POST', {
      requests: [{ addSheet: { properties: { title: 'Chamados', gridProperties: { rowCount: 2000, columnCount: 19 } } } }]
    });
    await setSheet('Chamados!A1:S1', [[
      'ID', 'ID Equipamento', 'Equipamento', 'Tipo de Problema', 'Prioridade', 'Descrição',
      'Status', 'Aberto Por', 'Data Abertura', 'Responsável pelo Reparo', 'Data Última Atualização', 'Solução',
      'Peças/Componentes Utilizados', 'Valor do Serviço (R$)',
      'Como Foi Feito', 'Início da Intervenção', 'Fim da Intervenção', 'Equipe Envolvida', 'Anexos'
    ]]);
  } else {
    await garantirColunaChamados(sheets, 'M', 13, 'Peças/Componentes Utilizados');
    await garantirColunaChamados(sheets, 'N', 14, 'Valor do Serviço (R$)');
    // Campos de detalhamento de manutenção (o que/como foi feito) — adicionados em 31/07/2026
    // pra dar origem ao Relatório de Manutenção (?action=relatorio).
    await garantirColunaChamados(sheets, 'O', 15, 'Como Foi Feito');
    await garantirColunaChamados(sheets, 'P', 16, 'Início da Intervenção');
    await garantirColunaChamados(sheets, 'Q', 17, 'Fim da Intervenção');
    await garantirColunaChamados(sheets, 'R', 18, 'Equipe Envolvida');
    // Anexos: lista "nome::url | nome::url" de arquivos enviados ao Drive (fotos, notas fiscais,
    // comprovantes) via ?action=upload-anexo — fica como registro permanente do chamado.
    await garantirColunaChamados(sheets, 'S', 19, 'Anexos');
  }
}

function proximoChamadoId(chamadosRaw) {
  let max = 0;
  for (const r of chamadosRaw) {
    const m = String(r[0]||'').match(/^CHM-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'CHM-' + String(max + 1).padStart(4, '0');
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const equipeRaw = await getSheet('Equipe!A2:L200');
  const usuario = equipeRaw.find(r => r[0] === session.nome);
  if (!usuario || (usuario[10]||'ativo') !== 'ativo') {
    if (req.method === 'GET') return res.redirect(302, '/api/app');
    return res.status(403).json({ error: 'Acesso negado' });
  }
  const isGestor = usuario[8] === 'gestor';
  const nomesEquipe = equipeRaw.filter(r => r[0] && (r[10]||'ativo') === 'ativo').map(r => r[0]).sort((a,b) => a.localeCompare(b,'pt'));

  await garantirAbaChamados();

  if (req.method === 'GET') {
    const [chamadosRaw, equipamentosRaw] = await Promise.all([
      getSheet('Chamados!A2:S2000'),
      getSheet('Equipamentos!A2:O3000'),
    ]);
    if (req.query.action === 'relatorio') {
      const row = chamadosRaw.find(r => r[0] === req.query.id);
      if (!row) return res.status(404).send('Chamado não encontrado');
      return renderRelatorio(res, row);
    }
    const pastaAnexosUrl = await obterUrlPastaAnexos();
    return renderChamados(res, session, isGestor, chamadosRaw, equipamentosRaw, nomesEquipe, pastaAnexosUrl);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // Upload de anexo (multipart) — checado antes de tocar em req.body, que só vem parseado
  // automaticamente pra JSON/urlencoded; multipart fica como stream bruto (mesmo padrão de
  // upload-atestado.js).
  if (req.query.action === 'upload-anexo') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return res.status(400).json({ error: 'Envie multipart/form-data' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const boundary = contentType.split('boundary=')[1]?.split(';')[0]?.trim();
      if (!boundary) return res.status(400).json({ error: 'Boundary não encontrado' });

      const sep = Buffer.from(`\r\n--${boundary}`);
      let fileBuffer = null, fileName = 'anexo', mimeType = 'application/octet-stream';
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
      if (!fileBuffer || fileBuffer.length < 10) return res.status(400).json({ error: 'Arquivo não encontrado no upload' });

      const chamadosRaw = await getSheet('Chamados!A2:S2000');
      const idx = chamadosRaw.findIndex(r => r[0] === id);
      if (idx < 0) return res.status(404).json({ error: 'Chamado não encontrado' });

      const gestorToken = await getGestorDriveToken();
      const chamadosFolderId = await garantirSubpastaChamados(gestorToken);
      const folderId = await garantirSubpastaChamado(gestorToken, chamadosFolderId, id);
      const safeName = `${session.nome.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}_${fileName}`;

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
      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gestorToken}`,
          'Content-Type': `multipart/related; boundary=${delimiter}`,
          'Content-Length': String(multipartBody.length),
        },
        body: multipartBody,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.id) throw new Error('Upload error: ' + JSON.stringify(uploadData));

      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/permissions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${gestorToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
      } catch (e) { console.warn('Permissão pública não aplicada:', e.message); }

      const url = `https://drive.google.com/file/d/${uploadData.id}/view`;
      const linha = idx + 2;
      const anexosAtuais = chamadosRaw[idx][18] || '';
      const anexosNovos = anexosAtuais ? `${anexosAtuais} | ${fileName}::${url}` : `${fileName}::${url}`;
      await setSheet(`Chamados!S${linha}`, [[anexosNovos]]);

      return res.status(200).json({ ok: true, url, anexos: anexosNovos });
    } catch (err) {
      console.error('upload-anexo ERRO:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  const { action } = req.body || {};

  if (action === 'abrir') {
    const { idEquipamento, tipoProblema, prioridade, descricao } = req.body || {};
    if (!idEquipamento?.trim()) return res.status(400).json({ error: 'Selecione um equipamento' });
    if (!TIPOS_PROBLEMA.includes(tipoProblema)) return res.status(400).json({ error: 'Tipo de problema inválido' });
    if (!PRIORIDADES.includes(prioridade)) return res.status(400).json({ error: 'Prioridade inválida' });
    if (!descricao?.trim()) return res.status(400).json({ error: 'Descreva o problema' });

    const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');
    const idxEquip = equipamentosRaw.findIndex(r => r[0] === idEquipamento.trim());
    if (idxEquip < 0) return res.status(404).json({ error: 'Equipamento não encontrado' });
    const equipRow = equipamentosRaw[idxEquip];
    const nomeEquip = equipRow[2] || '';
    const statusAnterior = equipRow[5] || 'Operacional';
    const linhaEquip = idxEquip + 2;

    const chamadosRaw = await getSheet('Chamados!A2:S2000');
    const id = proximoChamadoId(chamadosRaw);
    const agora = fmtTimestamp(getBRT());
    const linha = await proximaLinhaLivre('Chamados');
    await inserirLinhas('Chamados', 'N', [[
      id, idEquipamento.trim(), nomeEquip, tipoProblema, prioridade, descricao.trim(),
      'Aberto', session.nome, agora, '', agora, '', '', ''
    ]], linha);

    await setSheet(`Equipamentos!F${linhaEquip}:H${linhaEquip}`, [['Em manutenção', equipRow[6]||'', agora]]);
    await registrarMovimentacaoEquipamento({
      id: idEquipamento.trim(), equipamento: nomeEquip, de: statusAnterior, para: 'Em manutenção',
      responsavel: session.nome, observacao: `Chamado ${id} aberto: ${tipoProblema} — ${descricao.trim()}`, tipo: 'status'
    });

    return res.status(200).json({ ok: true, id, msg: `Chamado ${id} aberto para ${nomeEquip}` });
  }

  if (action === 'pegar') {
    // Qualquer pessoa autenticada pode pegar um chamado pra si — não precisa ser gestor pra
    // assumir a execução do reparo. Se ainda estava só "Aberto", assumir já conta como começar
    // a olhar o problema, então avança pra "Em andamento" sozinho.
    const { id } = req.body || {};
    const chamadosRaw = await getSheet('Chamados!A2:S2000');
    const idx = chamadosRaw.findIndex(r => r[0] === id);
    if (idx < 0) return res.status(404).json({ error: 'Chamado não encontrado' });
    const row = chamadosRaw[idx];
    const linha = idx + 2;
    const agora = fmtTimestamp(getBRT());
    const novoStatus = row[6] === 'Aberto' ? 'Em andamento' : (row[6] || 'Aberto');
    await setSheet(`Chamados!G${linha}:K${linha}`, [[novoStatus, row[7]||'', row[8]||'', session.nome, agora]]);
    return res.status(200).json({ ok: true, msg: `Chamado ${id} atribuído a você` });
  }

  if (action === 'atualizar') {
    const { id, novoStatus, responsavel, solucao, pecasUtilizadas, valorReparo, comoFeito, inicioIntervencao, fimIntervencao, equipeEnvolvida } = req.body || {};
    if (!STATUS_CHAMADO.includes(novoStatus)) return res.status(400).json({ error: 'Status inválido' });

    const chamadosRaw = await getSheet('Chamados!A2:S2000');
    const idx = chamadosRaw.findIndex(r => r[0] === id);
    if (idx < 0) return res.status(404).json({ error: 'Chamado não encontrado' });
    const row = chamadosRaw[idx];
    // Só gestor ou quem já é o responsável atual pelo chamado pode gerenciá-lo.
    if (!isGestor && row[9] !== session.nome) {
      return res.status(403).json({ error: 'Só o gestor ou quem está com o chamado pode gerenciá-lo' });
    }
    const linha = idx + 2;
    const agora = fmtTimestamp(getBRT());

    // Colunas O-R (Como Foi Feito / Início / Fim / Equipe Envolvida) — detalhamento da manutenção,
    // usado pelo Relatório de Manutenção (?action=relatorio). Adicionado em 31/07/2026.
    await setSheet(`Chamados!G${linha}:R${linha}`, [[
      novoStatus, row[7]||'', row[8]||'', responsavel??row[9]??'', agora, solucao??row[11]??'',
      pecasUtilizadas??row[12]??'', valorReparo??row[13]??'',
      comoFeito??row[14]??'', inicioIntervencao??row[15]??'', fimIntervencao??row[16]??'', equipeEnvolvida??row[17]??''
    ]]);

    if (STATUS_FECHADO.includes(novoStatus)) {
      const equipamentosRaw = await getSheet('Equipamentos!A2:O3000');
      const idxEquip = equipamentosRaw.findIndex(r => r[0] === row[1]);
      if (idxEquip >= 0) {
        const equipRow = equipamentosRaw[idxEquip];
        const linhaEquip = idxEquip + 2;
        if (equipRow[5] === 'Em manutenção') {
          await setSheet(`Equipamentos!F${linhaEquip}:H${linhaEquip}`, [['Operacional', equipRow[6]||'', agora]]);
          await registrarMovimentacaoEquipamento({
            id: row[1], equipamento: row[2], de: 'Em manutenção', para: 'Operacional',
            responsavel: session.nome, observacao: `Chamado ${id} ${novoStatus.toLowerCase()}`, tipo: 'status'
          });
        }
      }
    }

    return res.status(200).json({ ok: true, msg: `Chamado ${id} atualizado` });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
}

// ── Renderização ──────────────────────────────────────────────────────────

function shellCSS() {
  return `
:root{
  --bg:#f5f5f5;--bg2:#fafafa;--bg3:#f0f0f0;--card:#fff;--border:#e5e5e5;--border2:#f0f0f0;
  --text:#1a1a1a;--text2:#555;--text3:#888;--text4:#bbb;
  --header:#161920;--blue:#1d4ed8;
  --blue-m-bg:#eff6ff;--blue-m-v:#1d4ed8;
  --badge-green-bg:#dcfce7;--badge-green-c:#166534;
  --badge-red-bg:#fee2e2;--badge-red-c:#991b1b;
  --badge-amber-bg:#fef3c7;--badge-amber-c:#92400e;
  --badge-gray-bg:#eef0f2;--badge-gray-c:#555;
  --shadow-sm:0 1px 2px rgba(20,20,20,.05);
  --shadow:0 1px 2px rgba(20,20,20,.04), 0 6px 16px -8px rgba(20,20,20,.10);
}
html.dark{
  --bg:#1c1f26;--bg2:#242836;--bg3:#2d3140;--card:#242836;--border:#2d3748;--border2:#2d3748;
  --text:#e2e8f0;--text2:#a0aec0;--text3:#718096;--text4:#4a5568;
  --header:#0f1117;--blue:#63b3ed;
  --blue-m-bg:#1a2744;--blue-m-v:#63b3ed;
  --badge-green-bg:#0d2010;--badge-green-c:#68d391;
  --badge-red-bg:#1f1010;--badge-red-c:#fc8181;
  --badge-amber-bg:#2d1f00;--badge-amber-c:#f6ad55;
  --badge-gray-bg:#2d3140;--badge-gray-c:#a0aec0;
  --shadow-sm:0 1px 2px rgba(0,0,0,.35);
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 6px 18px -8px rgba(0,0,0,.5);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text)}
a{text-decoration:none;color:inherit}
.header{background:var(--header);padding:12px 20px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.logo{width:32px;height:32px;border-radius:8px;background:#e53e3e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.ht{font-size:14px;font-weight:700;color:#fff}
.hs{font-size:11px;color:#666}
.hr{margin-left:auto;display:flex;gap:6px;align-items:center}
.btn-sm{border:1px solid #3d4660;border-radius:5px;padding:4px 10px;font-size:11px;color:#a0aec0;background:none;cursor:pointer;text-decoration:none}
.btn-sm:hover{border-color:#6b7280;color:#e2e8f0}
.menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12px;color:var(--text);text-decoration:none;white-space:nowrap}
.menu-item:hover{background:var(--bg3)}
.wrap{max-width:1300px;margin:0 auto;padding:16px 20px}
.badge{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:600;white-space:nowrap}
.badge.green{background:var(--badge-green-bg);color:var(--badge-green-c)}
.badge.red{background:var(--badge-red-bg);color:var(--badge-red-c)}
.badge.amber{background:var(--badge-amber-bg);color:var(--badge-amber-c)}
.badge.blue{background:var(--blue-m-bg);color:var(--blue-m-v)}
.badge.gray{background:var(--badge-gray-bg);color:var(--badge-gray-c)}
.badge.urgente{animation:pulsar 1.2s ease-in-out infinite}
@keyframes pulsar{0%,100%{opacity:1}50%{opacity:.55}}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow-sm);display:flex;align-items:center;gap:12px}
.stat .ic{font-size:20px;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--bg3)}
.stat .n{font-size:24px;font-weight:800;line-height:1}
.stat .l{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-top:3px;font-weight:600}
.toolbar{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;box-shadow:var(--shadow-sm)}
.toolbar input,.toolbar select{border:1px solid var(--border);border-radius:7px;padding:8px 11px;font-size:12px;background:var(--bg2);color:var(--text);outline:none}
.btn{border:1px solid var(--border);border-radius:7px;padding:8px 13px;font-size:12px;background:var(--card);color:var(--text);cursor:pointer;transition:background .15s}
.btn:hover{background:var(--bg3)}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.tbl-wrap{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow-x:auto;box-shadow:var(--shadow-sm)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:11px 12px;color:var(--text3);text-transform:uppercase;font-size:10px;letter-spacing:.04em;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--bg2)}
td{padding:10px 12px;border-bottom:1px solid var(--border2);vertical-align:middle}
tbody tr:hover{background:var(--bg2)}
tr:last-child td{border-bottom:none}
.desc-cell{max-width:220px;white-space:normal}
.acoes button{border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:11px;background:var(--bg2);color:var(--text);cursor:pointer}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
.modal-bg.open{display:flex}
.modal{background:var(--card);border-radius:14px;padding:22px;width:420px;max-width:calc(100vw - 32px);max-height:85vh;overflow-y:auto;box-shadow:var(--shadow)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;font-weight:600;color:var(--text3);margin-bottom:4px;text-transform:uppercase}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 9px;font-size:13px;background:var(--bg2);color:var(--text);outline:none}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
`;
}

function menuHTML(isGestor) {
  const itensGestor = isGestor ? `
        <a href="/api/escalas?v=semana" class="menu-item">&#128197; Escala</a>
        <a href="/api/equipe-view" class="menu-item">&#128101; Equipe</a>
        <a href="/api/ausencias" class="menu-item">&#128198; Ausências</a>
        <a href="/api/banco-horas" class="menu-item">&#128202; Banco de horas</a>
        <a href="/api/equipamentos" class="menu-item">&#128230; Equipamentos</a>
  ` : '';
  return `
    <button id="tt" class="btn-sm" onclick="(function(){var h=document.documentElement;var dk=h.classList.toggle('dark');localStorage.setItem('pulse-theme',dk?'dark':'light');})()" style="font-size:14px;padding:3px 8px">&#127769;</button>
    <div style="position:relative">
      <button id="menu-btn" onclick="toggleMenu(event)" aria-label="Menu" class="btn-sm" style="font-size:15px;padding:4px 10px;line-height:1">&#9776;</button>
      <div id="menu-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:210px;overflow:hidden;z-index:200">
        <a href="/api/app" class="menu-item">&#127968; Início</a>${itensGestor}
        <a href="/api/repositorio" class="menu-item">&#128193; Central de Conhecimento</a>
        <a href="/api/chamados" class="menu-item">&#127915; Chamados</a>
        <div style="height:1px;background:var(--border);margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit" class="menu-item" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>
      </div>
    </div>`;
}

function headerHTML(nome, isGestor, sub) {
  return `
<div class="header">
  <div class="logo">P</div>
  <div>
    <div class="ht">Chamados</div>
    <div class="hs">${esc(sub)}</div>
  </div>
  <div class="hr">${menuHTML(isGestor)}</div>
</div>`;
}

function baseHTML(titulo, conteudo, scriptExtra = '') {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>(function(){var d=localStorage.getItem("pulse-theme");if(d==="dark")document.documentElement.classList.add("dark");})()</script>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse - ${esc(titulo)}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>${shellCSS()}</style>
</head>
<body>
${conteudo}
<script>
function toggleMenu(e){if(e)e.stopPropagation();var d=document.getElementById('menu-dropdown');d.style.display=d.style.display==='block'?'none':'block';}
document.addEventListener('click',function(e){var d=document.getElementById('menu-dropdown'),btn=document.getElementById('menu-btn');if(d&&d.style.display==='block'&&!d.contains(e.target)&&e.target!==btn){d.style.display='none';}});
${scriptExtra}
</script>
</body>
</html>`;
}

function renderChamados(res, session, isGestor, chamadosRaw, equipamentosRaw, nomesEquipe, pastaAnexosUrl) {
  const chamados = chamadosRaw.filter(r => r[0]).map(r => ({
    id: r[0], idEquipamento: r[1]||'', equipamento: r[2]||'', tipoProblema: r[3]||'', prioridade: r[4]||'Baixa',
    descricao: r[5]||'', status: r[6]||'Aberto', abertoPor: r[7]||'', dataAbertura: r[8]||'',
    responsavel: r[9]||'', dataAtualizacao: r[10]||'', solucao: r[11]||'',
    pecasUtilizadas: r[12]||'', valorReparo: r[13]||'',
    comoFeito: r[14]||'', inicioIntervencao: r[15]||'', fimIntervencao: r[16]||'', equipeEnvolvida: r[17]||'',
    anexos: r[18]||''
  })).reverse();

  const equipamentosOpcoes = equipamentosRaw.filter(r => r[0]).map(r => ({ id: r[0], nome: r[2]||'', alocacao: r[6]||'' }));

  const abertos = chamados.filter(c => c.status === 'Aberto').length;
  const andamento = chamados.filter(c => c.status === 'Em andamento' || c.status === 'Aguardando peça').length;
  const urgentes = chamados.filter(c => c.prioridade === 'Urgente' && !STATUS_FECHADO.includes(c.status)).length;
  const finalizados = chamados.filter(c => c.status === 'Finalizado').length;

  const kpiHTML = [
    `<div class="stat"><div class="ic" style="background:var(--blue-m-bg)">🎫</div><div><div class="n">${abertos}</div><div class="l">Abertos</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-amber-bg)">🔧</div><div><div class="n" style="color:var(--badge-amber-c)">${andamento}</div><div class="l">Em andamento</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-red-bg)">🔥</div><div><div class="n" style="color:var(--badge-red-c)">${urgentes}</div><div class="l">Urgentes em aberto</div></div></div>`,
    `<div class="stat"><div class="ic" style="background:var(--badge-green-bg)">✅</div><div><div class="n" style="color:var(--badge-green-c)">${finalizados}</div><div class="l">Finalizados</div></div></div>`,
  ].join('');

  const conteudo = `
${headerHTML(session.nome, isGestor, `${chamados.length} chamados registrados`)}
<div class="wrap">
  <div class="summary">${kpiHTML}</div>

  <div class="toolbar">
    <input id="busca" placeholder="🔍 Buscar por equipamento, tipo ou descrição..." style="flex:1;min-width:220px" oninput="filtrar()">
    <select id="f-status" onchange="filtrar()"><option value="">Todo status</option>${STATUS_CHAMADO.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
    <select id="f-prioridade" onchange="filtrar()"><option value="">Toda prioridade</option>${PRIORIDADES.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
    <button class="btn primary" onclick="abrirNovoChamado()">+ Abrir chamado</button>
  </div>

  <div class="tbl-wrap">
    <table id="tabela">
      <thead><tr>
        <th>ID</th><th>Equipamento</th><th>Tipo</th><th>Prioridade</th><th>Status</th>
        <th>Descrição</th><th>Aberto por</th><th>Quando</th><th>Responsável</th><th>Ações</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</div>

<div class="modal-bg" id="modal-abrir"><div class="modal">
  <h3>Abrir chamado</h3>
  <div class="field"><label>Equipamento</label><input id="c-equip-busca" list="lista-equip" placeholder="Digite o ID ou nome..." oninput="selecionarEquip()"></div>
  <datalist id="lista-equip">${equipamentosOpcoes.map(e=>`<option value="${esc(e.id)} — ${esc(e.nome)} (${esc(e.alocacao)})">`).join('')}</datalist>
  <div class="field"><label>Tipo de problema</label><select id="c-tipo">${TIPOS_PROBLEMA.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
  <div class="field"><label>Prioridade</label><select id="c-prioridade">${PRIORIDADES.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
  <div class="field"><label>Descrição do problema</label><textarea id="c-descricao" rows="3"></textarea></div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarAbrir()">Abrir chamado</button></div>
</div></div>

<div class="modal-bg" id="modal-gerenciar"><div class="modal">
  <h3>Gerenciar chamado</h3>
  <div class="field"><label>Status</label><select id="g-status">${STATUS_CHAMADO.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
  <div class="field"><label>Responsável pelo reparo</label><select id="g-responsavel"><option value="">— Ninguém —</option>${nomesEquipe.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div>
  <div class="field"><label>Peças/componentes utilizados</label><textarea id="g-pecas" rows="2" placeholder="Ex: 2x rolamento X, cabo Y..."></textarea></div>
  <div class="field"><label>Valor do serviço de reparo (R$)</label><input id="g-valor" type="number" step="0.01" min="0" placeholder="0,00"></div>
  <div class="field"><label>O que foi feito / Solução</label><textarea id="g-solucao" rows="3"></textarea></div>
  <div class="field"><label>Como foi feito (procedimento)</label><textarea id="g-comofeito" rows="3" placeholder="Ex: desligamento sequencial, troca do módulo X, teste de sinal..."></textarea></div>
  <div class="field" style="display:flex;gap:8px">
    <div style="flex:1"><label>Início</label><input id="g-inicio" type="text" placeholder="HH:MM"></div>
    <div style="flex:1"><label>Fim</label><input id="g-fim" type="text" placeholder="HH:MM"></div>
  </div>
  <div class="field"><label>Equipe envolvida</label><input id="g-equipe" placeholder="Ex: João, Maria, Pedro"></div>
  <div class="field">
    <label>Anexos (fotos, notas fiscais, comprovantes...)</label>
    <div id="link-pasta-anexos" style="margin-bottom:6px"></div>
    <div id="g-anexos-lista" style="margin-bottom:6px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="g-anexo-file" type="file" multiple style="flex:1;min-width:140px">
      <input id="g-anexo-pasta" type="file" webkitdirectory multiple style="display:none">
      <button type="button" class="btn" onclick="document.getElementById('g-anexo-pasta').click()" title="Selecionar uma pasta inteira (só funciona no navegador de computador)">📁 Pasta</button>
      <button type="button" id="btn-enviar-anexo" class="btn" onclick="enviarAnexo()">Enviar</button>
    </div>
    <div id="g-anexo-selecionados" style="font-size:11px;color:var(--text3);margin-top:4px"></div>
  </div>
  <div class="modal-actions"><button class="btn" onclick="fecharModais()">Cancelar</button><button class="btn primary" onclick="salvarGerenciar()">Salvar</button></div>
</div></div>
`;

  const script = `
const CHAMADOS = ${JSON.stringify(chamados)};
const EQUIP_MAP = ${JSON.stringify(Object.fromEntries(equipamentosOpcoes.map(e => [e.id, e.nome])))};
const IS_GESTOR = ${isGestor ? 'true' : 'false'};
const MEU_NOME = ${JSON.stringify(session.nome)};
const STATUS_FECHADO_C = ${JSON.stringify(STATUS_FECHADO)};
const PASTA_ANEXOS_URL = ${JSON.stringify(pastaAnexosUrl)};
if (PASTA_ANEXOS_URL) {
  document.getElementById('link-pasta-anexos').innerHTML = '<a href="'+PASTA_ANEXOS_URL+'" target="_blank" rel="noopener" style="font-size:12px;color:var(--blue)">📁 Abrir pasta de anexos no Drive</a>';
}
let idAtual = null;
let equipSelecionado = '';

function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function prioCls(p){ return p==='Baixa'?'blue':p==='Média'?'amber':'red'; }
function statusCls(s){ return s==='Aberto'?'blue':s==='Finalizado'?'green':s==='Cancelado'?'gray':'amber'; }

function linhaHTML(c){
  var prioBadge = '<span class="badge '+prioCls(c.prioridade)+(c.prioridade==='Urgente'?' urgente':'')+'">'+escHtml(c.prioridade)+'</span>';
  var podeGerenciar = IS_GESTOR || c.responsavel === MEU_NOME;
  var botoes = '';
  if (!c.responsavel) botoes += '<button onclick="pegarChamado(\\''+c.id+'\\')">🙋 Pegar pra mim</button>';
  if (podeGerenciar) botoes += '<button onclick="abrirGerenciar(\\''+c.id+'\\')">Gerenciar</button>';
  botoes += '<button onclick="window.open(\\'/api/chamados?action=relatorio&id='+c.id+'\\',\\'_blank\\')">📄 Relatório</button>';
  return '<tr>'
    + '<td>'+escHtml(c.id)+(c.anexos?' <span title="'+(c.anexos.split(\' | \').length)+' anexo(s)" style="font-size:11px">📎'+c.anexos.split(\' | \').length+'</span>':'')+'</td>'
    + '<td>'+escHtml(c.equipamento)+' <span style="color:var(--text3);font-size:10px">'+escHtml(c.idEquipamento)+'</span></td>'
    + '<td>'+escHtml(c.tipoProblema)+'</td>'
    + '<td>'+prioBadge+'</td>'
    + '<td><span class="badge '+statusCls(c.status)+'">'+escHtml(c.status)+'</span></td>'
    + '<td class="desc-cell">'+escHtml(c.descricao)+'</td>'
    + '<td>'+escHtml(c.abertoPor)+'</td>'
    + '<td>'+escHtml(c.dataAbertura)+'</td>'
    + '<td>'+escHtml(c.responsavel||'—')+'</td>'
    + '<td class="acoes">'+(botoes||'—')+'</td>'
    + '</tr>';
}

function filtrar(){
  var busca = document.getElementById('busca').value.toLowerCase();
  var fs = document.getElementById('f-status').value;
  var fp = document.getElementById('f-prioridade').value;
  var filtrados = CHAMADOS.filter(function(c){
    if (fs && c.status !== fs) return false;
    if (fp && c.prioridade !== fp) return false;
    if (busca && !(c.equipamento+' '+c.tipoProblema+' '+c.descricao+' '+c.idEquipamento).toLowerCase().includes(busca)) return false;
    return true;
  });
  document.getElementById('tbody').innerHTML = filtrados.map(linhaHTML).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:20px">Nenhum chamado encontrado</td></tr>';
}

async function pegarChamado(id){
  var r = await fetch('/api/chamados', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pegar',id:id})});
  var d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao pegar chamado');
  location.reload();
}

function fecharModais(){ document.querySelectorAll('.modal-bg').forEach(function(m){ m.classList.remove('open'); }); idAtual = null; }

function abrirNovoChamado(){
  document.getElementById('c-equip-busca').value = '';
  equipSelecionado = '';
  document.getElementById('c-descricao').value = '';
  document.getElementById('modal-abrir').classList.add('open');
}
function selecionarEquip(){
  var v = document.getElementById('c-equip-busca').value;
  var m = v.match(/^(EQP-\\d+)/);
  equipSelecionado = m ? m[1] : '';
}
async function salvarAbrir(){
  if (!equipSelecionado || !EQUIP_MAP[equipSelecionado]) return alert('Selecione um equipamento válido da lista');
  var body = {
    action: 'abrir',
    idEquipamento: equipSelecionado,
    tipoProblema: document.getElementById('c-tipo').value,
    prioridade: document.getElementById('c-prioridade').value,
    descricao: document.getElementById('c-descricao').value,
  };
  var r = await fetch('/api/chamados', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d = await r.json();
  if (!r.ok) return alert(d.error||'Erro ao abrir chamado');
  location.reload();
}

function abrirGerenciar(id){
  idAtual = id;
  var c = CHAMADOS.find(function(x){ return x.id === id; });
  if (!c) return;
  document.getElementById('g-status').value = c.status;
  document.getElementById('g-responsavel').value = c.responsavel;
  document.getElementById('g-pecas').value = c.pecasUtilizadas;
  document.getElementById('g-valor').value = c.valorReparo;
  document.getElementById('g-solucao').value = c.solucao;
  document.getElementById('g-comofeito').value = c.comoFeito||'';
  document.getElementById('g-inicio').value = c.inicioIntervencao||'';
  document.getElementById('g-fim').value = c.fimIntervencao||'';
  document.getElementById('g-equipe').value = c.equipeEnvolvida||'';
  document.getElementById('g-anexo-file').value = '';
  document.getElementById('g-anexo-pasta').value = '';
  document.getElementById('g-anexo-selecionados').textContent = '';
  renderAnexos(c.anexos||'');
  document.getElementById('modal-gerenciar').classList.add('open');
}
function renderAnexos(anexosStr){
  var el = document.getElementById('g-anexos-lista');
  if (!anexosStr){ el.innerHTML = '<span style="font-size:11px;color:var(--text3)">Nenhum anexo ainda</span>'; return; }
  el.innerHTML = anexosStr.split(' | ').map(function(par){
    var partes = par.split('::'), nome = partes[0]||'arquivo', url = partes[1]||'#';
    return '<a href="'+url+'" target="_blank" rel="noopener" style="display:block;font-size:12px;color:var(--blue);margin-bottom:3px">📎 '+escHtml(nome)+'</a>';
  }).join('');
}
function mostrarSelecionados(){
  var f1 = document.getElementById('g-anexo-file').files;
  var f2 = document.getElementById('g-anexo-pasta').files;
  var n = (f1.length ? f1.length : f2.length);
  document.getElementById('g-anexo-selecionados').textContent = n ? n+' arquivo(s) selecionado(s)' : '';
}
document.getElementById('g-anexo-file').addEventListener('change', mostrarSelecionados);
document.getElementById('g-anexo-pasta').addEventListener('change', mostrarSelecionados);

// Sobe UM arquivo/blob já pronto pro chamado idAtual — usado tanto pelo botão "Enviar" manual
// quanto pelo salvamento automático de arquivos pendentes e do PDF do relatório.
async function uploadUmArquivo(blobOuFile, nomeArquivo){
  var fd = new FormData();
  fd.append('arquivo', blobOuFile, nomeArquivo);
  var r = await fetch('/api/chamados?action=upload-anexo&id='+idAtual, { method:'POST', body: fd });
  var d = await r.json();
  if (!r.ok) throw new Error(d.error||'Erro ao enviar "'+nomeArquivo+'"');
  return d.anexos;
}

async function enviarAnexo(){
  var f1 = document.getElementById('g-anexo-file');
  var f2 = document.getElementById('g-anexo-pasta');
  var files = Array.prototype.slice.call(f1.files.length ? f1.files : f2.files);
  if (!files.length) return alert('Escolha um ou mais arquivos, ou uma pasta, primeiro');
  var btn = document.getElementById('btn-enviar-anexo');
  btn.disabled = true;
  var anexosFinal = '';
  for (var i = 0; i < files.length; i++){
    btn.textContent = 'Enviando '+(i+1)+'/'+files.length+'...';
    try{
      anexosFinal = await uploadUmArquivo(files[i], files[i].name);
      renderAnexos(anexosFinal);
    } catch(e) { alert(e.message); }
  }
  var c = CHAMADOS.find(function(x){ return x.id===idAtual; });
  if (c && anexosFinal) c.anexos = anexosFinal;
  f1.value = ''; f2.value = '';
  document.getElementById('g-anexo-selecionados').textContent = '';
  btn.disabled = false; btn.textContent = 'Enviar';
}

// Monta o mesmo conteúdo do Relatório de Manutenção (?action=relatorio) e gera um PDF no
// navegador (jsPDF via CDN — sem depender de headless browser no servidor), pra subir junto
// no Drive quando o chamado é encerrado.
function gerarPdfRelatorio(c, body){
  var doc = new window.jspdf.jsPDF();
  var y = 18;
  function linha(texto, tamanho){
    doc.setFontSize(tamanho||10);
    var partes = doc.splitTextToSize(texto, 180);
    partes.forEach(function(p){
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(p, 14, y); y += 6;
    });
  }
  linha('Relatório de Manutenção — '+c.id, 16); y += 2;
  linha('Equipamento: '+c.equipamento+' ('+c.idEquipamento+')');
  linha('Tipo: '+c.tipoProblema+'    Prioridade: '+c.prioridade+'    Status: '+body.novoStatus);
  linha('Aberto por: '+c.abertoPor+', em '+c.dataAbertura);
  linha('Responsável: '+(body.responsavel||'—')); y += 4;
  if (body.solucao) { linha('O QUE FOI FEITO:', 12); linha(body.solucao); y += 2; }
  if (body.comoFeito) { linha('COMO FOI FEITO:', 12); linha(body.comoFeito); y += 2; }
  if (body.inicioIntervencao || body.fimIntervencao) linha('Horário da intervenção: '+(body.inicioIntervencao||'?')+' às '+(body.fimIntervencao||'?'));
  if (body.equipeEnvolvida) linha('Equipe envolvida: '+body.equipeEnvolvida);
  if (body.pecasUtilizadas) linha('Peças/componentes utilizados: '+body.pecasUtilizadas);
  if (body.valorReparo) linha('Valor do serviço: R$ '+body.valorReparo);
  return doc.output('blob');
}

async function salvarGerenciar(){
  var body = {
    action: 'atualizar', id: idAtual,
    novoStatus: document.getElementById('g-status').value,
    responsavel: document.getElementById('g-responsavel').value,
    pecasUtilizadas: document.getElementById('g-pecas').value,
    valorReparo: document.getElementById('g-valor').value,
    solucao: document.getElementById('g-solucao').value,
    comoFeito: document.getElementById('g-comofeito').value,
    inicioIntervencao: document.getElementById('g-inicio').value,
    fimIntervencao: document.getElementById('g-fim').value,
    equipeEnvolvida: document.getElementById('g-equipe').value,
  };
  var btnSalvar = document.querySelector('#modal-gerenciar .btn.primary');
  if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = 'Salvando...'; }
  try {
    // Passo 1: sobe qualquer arquivo já escolhido (arquivo ou pasta) que ainda não tenha sido enviado
    var f1 = document.getElementById('g-anexo-file'), f2 = document.getElementById('g-anexo-pasta');
    if (f1.files.length || f2.files.length) await enviarAnexo();

    // Passo 2: se o chamado está sendo fechado (Finalizado/Cancelado), gera o PDF do relatório e sobe também
    if (STATUS_FECHADO_C.indexOf(body.novoStatus) !== -1) {
      var c = CHAMADOS.find(function(x){ return x.id===idAtual; }) || {};
      try {
        var pdfBlob = gerarPdfRelatorio(c, body);
        await uploadUmArquivo(pdfBlob, 'Relatorio_'+c.id+'.pdf');
      } catch(e) { console.error('Falha ao gerar/subir PDF do relatório:', e.message); }
    }

    // Passo 3: salva os campos de status/texto normalmente
    var r = await fetch('/api/chamados', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d = await r.json();
    if (!r.ok) { alert(d.error||'Erro ao atualizar chamado'); return; }
    location.reload();
  } finally {
    if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = 'Salvar'; }
  }
}

filtrar();
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(baseHTML('Chamados', conteudo, script));
}

// ── Relatório de manutenção (?action=relatorio&id=CHM-xxxx) ────────────────
// Página independente (não usa o shell/menu do resto do Pulse) pensada pra ser impressa, salva
// como PDF ou copiada pro corpo de um email — é a saída da manutenção detalhada (o que/como foi
// feito, início/fim, equipe) registrada no chamado. Envio automático por email (Resend) fica pra
// quando a conta estiver configurada; por enquanto o botão "Enviar por email" abre um rascunho no
// cliente de email da própria pessoa (mailto:) com o relatório já no corpo — funciona hoje, sem
// precisar de nenhuma infraestrutura nova.
function renderRelatorio(res, row) {
  const c = {
    id: row[0], idEquipamento: row[1]||'', equipamento: row[2]||'', tipoProblema: row[3]||'',
    prioridade: row[4]||'', descricao: row[5]||'', status: row[6]||'', abertoPor: row[7]||'',
    dataAbertura: row[8]||'', responsavel: row[9]||'', dataAtualizacao: row[10]||'', solucao: row[11]||'',
    pecasUtilizadas: row[12]||'', valorReparo: row[13]||'',
    comoFeito: row[14]||'', inicioIntervencao: row[15]||'', fimIntervencao: row[16]||'', equipeEnvolvida: row[17]||'',
    anexos: row[18]||''
  };

  const linha = (label, valor) => valor ? `<tr><td class="lbl">${esc(label)}</td><td>${esc(valor).replace(/\n/g,'<br>')}</td></tr>` : '';

  const corpoTexto = [
    `RELATÓRIO DE MANUTENÇÃO — ${c.id}`, '',
    `Equipamento: ${c.equipamento} (${c.idEquipamento})`,
    `Tipo: ${c.tipoProblema}    Prioridade: ${c.prioridade}    Status: ${c.status}`,
    `Aberto por: ${c.abertoPor}, em ${c.dataAbertura}`,
    `Responsável: ${c.responsavel||'—'}    Última atualização: ${c.dataAtualizacao}`, '',
    c.solucao ? `O QUE FOI FEITO:\n${c.solucao}\n` : '',
    c.comoFeito ? `COMO FOI FEITO:\n${c.comoFeito}\n` : '',
    (c.inicioIntervencao || c.fimIntervencao) ? `Horário da intervenção: ${c.inicioIntervencao||'?'} às ${c.fimIntervencao||'?'}\n` : '',
    c.equipeEnvolvida ? `Equipe envolvida: ${c.equipeEnvolvida}\n` : '',
    c.pecasUtilizadas ? `Peças/componentes utilizados: ${c.pecasUtilizadas}\n` : '',
    c.valorReparo ? `Valor do serviço: R$ ${c.valorReparo}\n` : '',
    c.anexos ? `Anexos:\n${c.anexos.split(' | ').map(par => { const [n, u] = par.split('::'); return `- ${n}: ${u}`; }).join('\n')}\n` : '',
  ].filter(Boolean).join('\n');

  const conteudo = `
<div class="pg">
  <div class="topo no-print">
    <button class="btn" onclick="window.close()">← Fechar</button>
    <button class="btn primary" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
  </div>
  <div class="folha">
    <h1>Relatório de Manutenção</h1>
    <div class="idgrande">${esc(c.id)}</div>
    <table class="dados">
      ${linha('Equipamento', `${c.equipamento} (${c.idEquipamento})`)}
      ${linha('Tipo', c.tipoProblema)}
      ${linha('Prioridade', c.prioridade)}
      ${linha('Status', c.status)}
      ${linha('Aberto por', `${c.abertoPor} — ${c.dataAbertura}`)}
      ${linha('Responsável', c.responsavel)}
      ${linha('Última atualização', c.dataAtualizacao)}
    </table>
    <h2>O que foi feito</h2>
    <p class="txt">${esc(c.solucao||'—').replace(/\n/g,'<br>')}</p>
    <h2>Como foi feito</h2>
    <p class="txt">${esc(c.comoFeito||'—').replace(/\n/g,'<br>')}</p>
    <table class="dados">
      ${linha('Início da intervenção', c.inicioIntervencao)}
      ${linha('Fim da intervenção', c.fimIntervencao)}
      ${linha('Equipe envolvida', c.equipeEnvolvida)}
      ${linha('Peças/componentes utilizados', c.pecasUtilizadas)}
      ${linha('Valor do serviço', c.valorReparo ? `R$ ${c.valorReparo}` : '')}
    </table>
    ${c.anexos ? `<h2>Anexos</h2><ul class="txt">${c.anexos.split(' | ').map(par => { const [n, u] = par.split('::'); return `<li><a href="${esc(u||'#')}" target="_blank" rel="noopener">${esc(n||'arquivo')}</a></li>`; }).join('')}</ul>` : ''}
  </div>
  <div class="folha no-print">
    <h2 style="margin-top:0">Enviar por email</h2>
    <p style="font-size:12px;color:#666;margin-bottom:10px">Abre um rascunho no seu próprio email com o relatório no corpo — envio automático ainda não está configurado.</p>
    <input id="destinatarios" placeholder="destinatario1@empresa.com, destinatario2@empresa.com" style="width:100%;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:13px;margin-bottom:10px">
    <button class="btn primary" onclick="enviarEmail()">📧 Abrir rascunho de email</button>
  </div>
</div>`;

  const script = `
function enviarEmail(){
  var dest = document.getElementById('destinatarios').value.trim();
  var assunto = ${JSON.stringify('Relatório de Manutenção — ' + c.id + ' — ' + c.equipamento)};
  var corpo = ${JSON.stringify(corpoTexto)};
  var url = 'mailto:' + encodeURIComponent(dest) + '?subject=' + encodeURIComponent(assunto) + '&body=' + encodeURIComponent(corpo);
  window.location.href = url;
}
`;

  const css = `
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0;color:#1a1a1a;margin:0;padding:20px}
.pg{max-width:720px;margin:0 auto}
.topo{display:flex;gap:10px;justify-content:flex-end;margin-bottom:14px}
.btn{border:1px solid #ddd;border-radius:6px;padding:7px 13px;font-size:12px;background:#fff;color:#1a1a1a;cursor:pointer}
.btn.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff;font-weight:600}
.folha{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:28px 32px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
h1{font-size:20px;margin-bottom:2px}
.idgrande{font-size:13px;color:#888;margin-bottom:18px;font-weight:600}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:18px 0 6px}
.txt{font-size:14px;line-height:1.5;white-space:pre-wrap}
table.dados{width:100%;border-collapse:collapse;margin-top:6px}
table.dados td{padding:6px 4px;font-size:13px;border-bottom:1px solid #f0f0f0;vertical-align:top}
table.dados td.lbl{color:#888;width:200px;font-weight:600}
@media print{ .no-print{display:none!important} body{background:#fff;padding:0} .folha{border:none;box-shadow:none} }
`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório — ${esc(c.id)}</title><style>${css}</style></head>
<body>${conteudo}<script>${script}</script></body></html>`);
}
