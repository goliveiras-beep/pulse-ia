// api/equipe.js — API de gerenciamento de equipe (CRUD)
export const config = { maxDuration: 30 };
import { sheetsRequest } from '../lib/google-auth.js';
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

async function getSheet(range) {
  try { const d=await sheetsRequest(process.env.GOOGLE_SHEET_ID,`/values/${encodeURIComponent(range)}`); return d.values||[]; }
  catch { return []; }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({error:'Não autorizado'});

  // Equipe (9 col — layout mais antigo, diferente do de 13 col usado em equipe-view.js/app.js/banco-horas.js):
  // 0=nome, 1=cargo, 2=nucleo, 3=email, 4=slackId, 5=regime, 6=status, 7=senha (hash), 8=perfil
  const equipeRaw = await getSheet('Equipe!A2:I50');
  const usuario = equipeRaw.find(r=>r[0]===session.nome);
  if (usuario?.[8] !== 'gestor') return res.status(403).json({error:'Acesso negado'});

  const { action } = req.body || req.query;

  if (req.method === 'GET') {
    const equipe = equipeRaw.map((r,i) => ({
      linha: i+2,
      nome: r[0]||'', cargo: r[1]||'', nucleo: r[2]||'',
      email: r[3]||'', slackId: r[4]||'', regime: r[5]||'',
      status: r[6]||'Ativo', temSenha: !!r[7], perfil: r[8]||''
    }));
    return res.status(200).json({ ok:true, equipe });
  }

  if (req.method !== 'POST') return res.status(405).json({error:'Método não permitido'});

  const body = req.body || {};

  if (action === 'adicionar') {
    const { nome, cargo, nucleo, email, slackId, regime, status, perfil } = body;
    if (!nome?.trim()) return res.status(400).json({error:'Nome obrigatório'});
    const jaExiste = equipeRaw.find(r=>r[0]?.toLowerCase()===nome.toLowerCase().trim());
    if (jaExiste) return res.status(400).json({error:'Já existe um colaborador com esse nome'});
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      '/values/Equipe!A1:append?valueInputOption=USER_ENTERED','POST',
      {values:[[nome.trim(), cargo||'', nucleo||'Operações', email||'', slackId||'', regime||'', status||'Ativo', '', perfil||'']]});
    return res.status(200).json({ok:true, msg:`${nome} adicionado à equipe`});
  }

  if (action === 'editar') {
    const { linha, nome, cargo, nucleo, email, slackId, regime, status, perfil } = body;
    if (!linha) return res.status(400).json({error:'Linha não informada'});
    const linhaAtual = equipeRaw[linha-2];
    const senhaHash = linhaAtual?.[7]||'';
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      `/values/Equipe!A${linha}:I${linha}?valueInputOption=USER_ENTERED`,'PUT',
      {values:[[nome||'', cargo||'', nucleo||'', email||'', slackId||'', regime||'', status||'Ativo', senhaHash, perfil||'']]});
    return res.status(200).json({ok:true, msg:`${nome} atualizado`});
  }

  if (action === 'remover') {
    const { linha, nome, definitivo } = body;
    if (!linha) return res.status(400).json({error:'Linha não informada'});
    if (definitivo) {
      const spreadsheet = await sheetsRequest(process.env.GOOGLE_SHEET_ID, '');
      const equipeSheet = spreadsheet.sheets?.find(s=>s.properties.title==='Equipe');
      if (!equipeSheet) return res.status(500).json({error:'Aba não encontrada'});
      await sheetsRequest(process.env.GOOGLE_SHEET_ID, ':batchUpdate', 'POST', {
        requests: [{
          deleteDimension: {
            range: { sheetId: equipeSheet.properties.sheetId, dimension: 'ROWS', startIndex: linha-1, endIndex: linha }
          }
        }]
      });
      return res.status(200).json({ok:true, msg:`${nome} removido definitivamente`});
    } else {
      await sheetsRequest(process.env.GOOGLE_SHEET_ID,
        `/values/Equipe!G${linha}?valueInputOption=USER_ENTERED`,'PUT',
        {values:[['Inativo']]});
      return res.status(200).json({ok:true, msg:`${nome} marcado como inativo`});
    }
  }

  if (action === 'reativar') {
    const { linha, nome } = body;
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      `/values/Equipe!G${linha}?valueInputOption=USER_ENTERED`,'PUT',
      {values:[['Ativo']]});
    return res.status(200).json({ok:true, msg:`${nome} reativado`});
  }

  if (action === 'resetar-senha') {
    const { linha, nome } = body;
    await sheetsRequest(process.env.GOOGLE_SHEET_ID,
      `/values/Equipe!H${linha}?valueInputOption=USER_ENTERED`,'PUT',
      {values:[['']]});
    return res.status(200).json({ok:true, msg:`Senha de ${nome} resetada — próximo acesso cria nova`});
  }

  return res.status(400).json({error:'Ação desconhecida'});
}
