// api/import-escala.js — importação única da escala histórica de Junho/2026
// Protegido por token. Chame: POST /api/import-escala com header Authorization: Bearer <IMPORT_TOKEN>
export const config = { maxDuration: 60 };
import { sheetsRequest } from '../lib/google-auth.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TOKEN    = process.env.IMPORT_TOKEN || 'pulse_import_2026';

// ── Dados da escala de Junho/2026 ─────────────────────────────────────────────
// Formato: [DD/MM, '', nome, entrada, saida, obs]
// obs = 'Folga' para dias de folga, '' para turno normal
const LINHAS = [
// 29/06
['29/06','','Bruno Dias','14:00','02:30',''],
['29/06','','Rafael Gusmão','06:00','14:00',''],
['29/06','','Lucas Malveira','06:00','14:00',''],
['29/06','','Thiago Russo','08:00','16:00',''],
['29/06','','Bernardo Oliva','10:00','18:00',''],
['29/06','','Rodrigo Cesar de Oliveira Pinheiro','14:00','22:00',''],
['29/06','','Matheus Ribeiro dos Santos','16:00','01:00',''],
['29/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['29/06','','Alan Veiga','18:00','00:00',''],
['29/06','','Fabio Silva','23:59','08:00',''],
// 30/06
['30/06','','Bruno Dias','11:30','02:30',''],
['30/06','','Rafael Gusmão','07:00','15:00',''],
['30/06','','Lucas Malveira','07:00','15:00',''],
['30/06','','Thiago Russo','08:00','16:00',''],
['30/06','','Bernardo Oliva','','','Folga'],
['30/06','','Rodrigo Cesar de Oliveira Pinheiro','16:00','00:00',''],
['30/06','','Matheus Ribeiro dos Santos','18:00','02:00',''],
['30/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['30/06','','Alan Veiga','15:00','23:00',''],
['30/06','','Fabio Silva','23:59','00:00',''],
// 01/07
['01/07','','Bruno Dias','11:30','00:30',''],
['01/07','','Rafael Gusmão','07:00','15:00',''],
['01/07','','Lucas Malveira','','','Folga'],
['01/07','','Thiago Russo','07:00','15:00',''],
['01/07','','Bernardo Oliva','08:00','16:00',''],
['01/07','','Rodrigo Cesar de Oliveira Pinheiro','18:00','02:00',''],
['01/07','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['01/07','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['01/07','','Alan Veiga','15:00','23:00',''],
['01/07','','Fabio Silva','23:00','07:00',''],
['01/06','','Rodrigo Alcantara da Rocha','08:00','14:00',''],
['01/06','','Rodrigo Cesar de Oliveira Pinheiro','08:00','14:00',''],
['01/06','','Matheus Ribeiro dos Santos','','','Folga'],
['01/06','','Bernardo Oliva','14:00','22:00',''],
['01/06','','Lucas Malveira','14:00','22:00',''],
['01/06','','Thiago Russo','','','Folga'],
['01/06','','Alan Veiga','10:00','16:00',''],
// 02/06
['02/06','','Rodrigo Alcantara da Rocha','06:00','12:00',''],
['02/06','','Rodrigo Cesar de Oliveira Pinheiro','07:00','13:00',''],
['02/06','','Matheus Ribeiro dos Santos','12:00','20:00',''],
['02/06','','Bernardo Oliva','','','Folga'],
['02/06','','Lucas Malveira','13:00','21:00',''],
['02/06','','Thiago Russo','12:00','20:00',''],
['02/06','','Alan Veiga','16:00','22:00',''],
// 03/06
['03/06','','Rodrigo Alcantara da Rocha','08:00','14:00',''],
['03/06','','Rodrigo Cesar de Oliveira Pinheiro','09:00','15:00',''],
['03/06','','Matheus Ribeiro dos Santos','13:00','21:00',''],
['03/06','','Bernardo Oliva','13:00','21:00',''],
['03/06','','Lucas Malveira','13:00','21:00',''],
['03/06','','Thiago Russo','13:00','21:00',''],
['03/06','','Alan Veiga','08:00','14:00',''],
// 04/06
['04/06','','Rodrigo Alcantara da Rocha','','','Folga'],
['04/06','','Rodrigo Cesar de Oliveira Pinheiro','06:00','12:00',''],
['04/06','','Matheus Ribeiro dos Santos','12:00','20:00',''],
['04/06','','Bernardo Oliva','','','Folga'],
['04/06','','Lucas Malveira','13:00','21:00',''],
['04/06','','Thiago Russo','12:00','20:00',''],
['04/06','','Alan Veiga','07:00','13:00',''],
// 05/06
['05/06','','Rodrigo Alcantara da Rocha','08:00','14:00',''],
['05/06','','Rodrigo Cesar de Oliveira Pinheiro','','','Folga'],
['05/06','','Matheus Ribeiro dos Santos','12:00','20:00',''],
['05/06','','Bernardo Oliva','12:00','20:00',''],
['05/06','','Lucas Malveira','','','Folga'],
['05/06','','Thiago Russo','','','Folga'],
['05/06','','Alan Veiga','08:00','14:00',''],
['05/06','','Fabio Silva','10:00','18:00',''],
// 06/06
['06/06','','Rodrigo Alcantara da Rocha','07:00','15:00',''],
['06/06','','Rodrigo Cesar de Oliveira Pinheiro','08:00','16:00',''],
['06/06','','Matheus Ribeiro dos Santos','17:00','01:00',''],
['06/06','','Bernardo Oliva','17:00','01:00',''],
['06/06','','Thiago Russo','15:00','23:00',''],
['06/06','','Fabio Silva','08:00','16:00',''],
// 07/06
['07/06','','Rodrigo Alcantara da Rocha','06:00','12:00',''],
['07/06','','Rodrigo Cesar de Oliveira Pinheiro','07:00','13:00',''],
['07/06','','Matheus Ribeiro dos Santos','','','Folga'],
['07/06','','Bernardo Oliva','14:00','20:00',''],
['07/06','','Thiago Russo','13:00','20:00',''],
// 08/06
['08/06','','Bruno Dias','12:00','22:00',''],
['08/06','','Rodrigo Alcantara da Rocha','14:00','20:00',''],
['08/06','','Alan Veiga','14:00','20:00',''],
['08/06','','Rodrigo Cesar de Oliveira Pinheiro','10:00','16:00',''],
['08/06','','Thiago Russo','13:00','21:00',''],
['08/06','','Lucas Malveira','10:00','18:00',''],
['08/06','','Bernardo Oliva','12:00','20:00',''],
['08/06','','Matheus Ribeiro dos Santos','13:00','21:00',''],
['08/06','','Fabio Silva','14:00','20:00',''],
// 09/06
['09/06','','Bruno Dias','12:00','22:00',''],
['09/06','','Rodrigo Alcantara da Rocha','10:00','16:00',''],
['09/06','','Alan Veiga','10:00','16:00',''],
['09/06','','Rodrigo Cesar de Oliveira Pinheiro','08:00','14:00',''],
['09/06','','Thiago Russo','14:00','22:00',''],
['09/06','','Lucas Malveira','16:00','00:00',''],
['09/06','','Bernardo Oliva','17:00','01:00',''],
['09/06','','Matheus Ribeiro dos Santos','14:00','22:00',''],
['09/06','','Fabio Silva','14:00','20:00',''],
// 10/06
['10/06','','Bruno Dias','13:30','01:00',''],
['10/06','','Rodrigo Alcantara da Rocha','08:00','14:00',''],
['10/06','','Alan Veiga','08:00','14:00',''],
['10/06','','Lucas Malveira','14:00','20:00',''],
['10/06','','Thiago Russo','10:00','18:00',''],
['10/06','','Rodrigo Cesar de Oliveira Pinheiro','16:00','00:00',''],
['10/06','','Bernardo Oliva','16:00','00:00',''],
['10/06','','Matheus Ribeiro dos Santos','14:00','22:00',''],
['10/06','','Fabio Silva','14:00','20:00',''],
// 11/06
['11/06','','Bruno Dias','11:00','02:45',''],
['11/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['11/06','','Alan Veiga','23:59','08:00',''],
['11/06','','Lucas Malveira','08:00','16:00',''],
['11/06','','Thiago Russo','08:00','16:00',''],
['11/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['11/06','','Bernardo Oliva','16:00','00:00',''],
['11/06','','Matheus Ribeiro dos Santos','16:00','00:00',''],
['11/06','','Fabio Silva','17:00','01:00',''],
// 12/06
['12/06','','Bruno Dias','11:30','01:45',''],
['12/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['12/06','','Alan Veiga','23:59','08:00',''],
['12/06','','Lucas Malveira','08:00','16:00',''],
['12/06','','Thiago Russo','08:00','16:00',''],
['12/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['12/06','','Bernardo Oliva','16:00','00:00',''],
['12/06','','Matheus Ribeiro dos Santos','16:00','00:00',''],
['12/06','','Fabio Silva','17:00','01:00',''],
// 13/06
['13/06','','Bruno Dias','11:30','01:45',''],
['13/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['13/06','','Alan Veiga','23:59','08:00',''],
['13/06','','Lucas Malveira','08:00','16:00',''],
['13/06','','Thiago Russo','08:00','16:00',''],
['13/06','','Rodrigo Cesar de Oliveira Pinheiro','19:00','03:00',''],
['13/06','','Bernardo Oliva','16:00','00:00',''],
['13/06','','Matheus Ribeiro dos Santos','16:00','00:00',''],
['13/06','','Fabio Silva','17:00','01:00',''],
// 14/06
['14/06','','Bruno Dias','11:30','01:45',''],
['14/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['14/06','','Lucas Malveira','07:00','15:00',''],
['14/06','','Thiago Russo','07:00','15:00',''],
['14/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['14/06','','Bernardo Oliva','15:00','23:00',''],
['14/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['14/06','','Fabio Silva','23:00','07:00',''],
// 15/06
['15/06','','Bruno Dias','09:00','01:45',''],
['15/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['15/06','','Alan Veiga','08:00','16:00',''],
['15/06','','Lucas Malveira','07:00','15:00',''],
['15/06','','Thiago Russo','07:00','15:00',''],
['15/06','','Rodrigo Cesar de Oliveira Pinheiro','15:00','23:00',''],
['15/06','','Bernardo Oliva','17:00','01:00',''],
['15/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['15/06','','Fabio Silva','23:59','08:00',''],
// 16/06
['16/06','','Bruno Dias','13:00','04:00',''],
['16/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['16/06','','Alan Veiga','08:00','16:00',''],
['16/06','','Lucas Malveira','07:00','15:00',''],
['16/06','','Thiago Russo','07:00','15:00',''],
['16/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['16/06','','Bernardo Oliva','15:00','23:00',''],
['16/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['16/06','','Fabio Silva','23:59','08:00',''],
// 17/06
['17/06','','Bruno Dias','11:00','02:30',''],
['17/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['17/06','','Alan Veiga','08:00','16:00',''],
['17/06','','Lucas Malveira','07:00','15:00',''],
['17/06','','Thiago Russo','07:00','15:00',''],
['17/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['17/06','','Bernardo Oliva','15:00','23:00',''],
['17/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['17/06','','Fabio Silva','23:59','07:00',''],
// 18/06
['18/06','','Bruno Dias','10:00','01:45',''],
['18/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['18/06','','Alan Veiga','08:00','16:00',''],
['18/06','','Lucas Malveira','07:00','15:00',''],
['18/06','','Thiago Russo','07:00','15:00',''],
['18/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['18/06','','Bernardo Oliva','15:00','23:00',''],
['18/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['18/06','','Fabio Silva','23:00','07:00',''],
// 19/06
['19/06','','Bruno Dias','13:00','04:30',''],
['19/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['19/06','','Alan Veiga','08:00','16:00',''],
['19/06','','Lucas Malveira','07:00','15:00',''],
['19/06','','Thiago Russo','07:00','15:00',''],
['19/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['19/06','','Bernardo Oliva','15:00','23:00',''],
['19/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['19/06','','Fabio Silva','23:00','07:00',''],
// 20/06
['20/06','','Bruno Dias','11:00','04:30',''],
['20/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['20/06','','Alan Veiga','','','Folga'],
['20/06','','Lucas Malveira','07:00','15:00',''],
['20/06','','Thiago Russo','07:00','15:00',''],
['20/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['20/06','','Bernardo Oliva','15:00','23:00',''],
['20/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['20/06','','Fabio Silva','23:00','07:00',''],
// 21/06
['21/06','','Bruno Dias','10:00','01:30',''],
['21/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['21/06','','Alan Veiga','23:59','08:00',''],
['21/06','','Lucas Malveira','07:00','15:00',''],
['21/06','','Thiago Russo','07:00','15:00',''],
['21/06','','Rodrigo Cesar de Oliveira Pinheiro','16:00','00:00',''],
['21/06','','Bernardo Oliva','15:00','23:00',''],
['21/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['21/06','','Fabio Silva','','','Folga'],
// 22/06
['22/06','','Rafael Gusmão','07:00','15:00',''],
['22/06','','Bruno Dias','11:00','03:30',''],
['22/06','','Rodrigo Alcantara da Rocha','','','Folga'],
['22/06','','Alan Veiga','17:00','01:00',''],
['22/06','','Lucas Malveira','07:00','15:00',''],
['22/06','','Thiago Russo','08:00','16:00',''],
['22/06','','Rodrigo Cesar de Oliveira Pinheiro','','','Folga'],
['22/06','','Bernardo Oliva','16:00','00:00',''],
['22/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['22/06','','Fabio Silva','23:00','07:00',''],
// 23/06
['23/06','','Rafael Gusmão','07:00','15:00',''],
['23/06','','Bruno Dias','11:30','02:30',''],
['23/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['23/06','','Alan Veiga','17:00','01:00',''],
['23/06','','Lucas Malveira','07:00','15:00',''],
['23/06','','Thiago Russo','08:00','16:00',''],
['23/06','','Rodrigo Cesar de Oliveira Pinheiro','00:10','08:00',''],
['23/06','','Bernardo Oliva','16:00','00:00',''],
['23/06','','Matheus Ribeiro dos Santos','15:00','23:00',''],
['23/06','','Fabio Silva','23:59','08:00',''],
// 24/06
['24/06','','Rafael Gusmão','08:00','16:00',''],
['24/06','','Bruno Dias','13:00','01:30',''],
['24/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['24/06','','Alan Veiga','20:00','04:00',''],
['24/06','','Lucas Malveira','08:00','16:00',''],
['24/06','','Thiago Russo','08:00','16:00',''],
['24/06','','Rodrigo Cesar de Oliveira Pinheiro','17:00','01:00',''],
['24/06','','Bernardo Oliva','16:00','00:00',''],
['24/06','','Matheus Ribeiro dos Santos','16:00','00:00',''],
['24/06','','Fabio Silva','23:59','08:00',''],
// 25/06
['25/06','','Rafael Gusmão','08:00','16:00',''],
['25/06','','Bruno Dias','14:00','02:30',''],
['25/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['25/06','','Alan Veiga','23:59','08:00',''],
['25/06','','Lucas Malveira','08:00','16:00',''],
['25/06','','Thiago Russo','09:00','17:00',''],
['25/06','','Rodrigo Cesar de Oliveira Pinheiro','16:00','00:00',''],
['25/06','','Bernardo Oliva','16:00','00:00',''],
['25/06','','Matheus Ribeiro dos Santos','17:00','01:00',''],
['25/06','','Fabio Silva','01:00','07:00',''],
// 26/06
['26/06','','Rafael Gusmão','08:00','16:00',''],
['26/06','','Bruno Dias','13:00','03:00',''],
['26/06','','Rodrigo Alcantara da Rocha','23:59','08:00',''],
['26/06','','Alan Veiga','23:59','08:00',''],
['26/06','','Lucas Malveira','08:00','16:00',''],
['26/06','','Thiago Russo','08:00','16:00',''],
['26/06','','Rodrigo Cesar de Oliveira Pinheiro','16:00','00:00',''],
['26/06','','Bernardo Oliva','16:00','00:00',''],
['26/06','','Matheus Ribeiro dos Santos','17:00','01:00',''],
['26/06','','Fabio Silva','01:00','07:00',''],
// 27/06
['27/06','','Rafael Gusmão','08:00','15:00',''],
['27/06','','Bruno Dias','16:00','02:00',''],
['27/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['27/06','','Alan Veiga','20:00','02:00',''],
['27/06','','Lucas Malveira','08:00','15:00',''],
['27/06','','Thiago Russo','09:00','16:00',''],
['27/06','','Rodrigo Cesar de Oliveira Pinheiro','15:00','22:00',''],
['27/06','','Bernardo Oliva','16:00','23:00',''],
['27/06','','Matheus Ribeiro dos Santos','20:00','02:00',''],
['27/06','','Fabio Silva','23:59','05:59',''],
// 28/06
['28/06','','Rafael Gusmão','08:00','15:00',''],
['28/06','','Bruno Dias','13:00','19:30',''],
['28/06','','Rodrigo Alcantara da Rocha','23:00','07:00',''],
['28/06','','Alan Veiga','23:00','07:00',''],
['28/06','','Lucas Malveira','07:00','13:00',''],
['28/06','','Thiago Russo','08:00','15:00',''],
['28/06','','Rodrigo Cesar de Oliveira Pinheiro','15:00','23:00',''],
['28/06','','Bernardo Oliva','13:00','20:00',''],
['28/06','','Matheus Ribeiro dos Santos','','','Folga'],
['28/06','','Fabio Silva','','','Folga'],
];

export default async function handler(req, res) {
  const auth = (req.headers.authorization||'').replace('Bearer ','');
  const tokenOk = auth === TOKEN;

  // Página HTML para facilitar o uso (GET sem token mostra botão)
  if (req.method === 'GET') {
    // Verificar se é gestor pela sessão
    let isGestor = false;
    try {
      const COOKIE_NAME = 'pulse_session';
      const cookies = {};
      (req.headers.cookie||'').split(';').forEach(c=>{const p=c.trim().split('=');cookies[p.shift()]=p.join('=');});
      const token = cookies[COOKIE_NAME];
      if (token) {
        const { createHash } = await import('crypto');
        const hash = s => createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32);
        const d = Buffer.from(token,'base64').toString('utf8');
        const last=d.lastIndexOf('|'), sec=d.lastIndexOf('|',last-1);
        const data=d.slice(0,sec), h=d.slice(sec+1,last), ts=d.slice(last+1);
        if(Date.now()-parseInt(ts,10)<7*24*3600*1000 && h===hash(data+ts) && !data.startsWith('~~OAUTH~~')) {
          const nome = data.split('~~')[0];
          const eq = await sheetsRequest(SHEET_ID,'/values/Equipe!A2:I200').then(d=>d.values||[]);
          const u = eq.find(r=>r[0]===nome);
          isGestor = u?.[8]==='gestor';
        }
      }
    } catch {}

    if (!isGestor) return res.redirect(302, '/api/app');

    return res.status(200).send(`<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pulse — Importar Escala</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#1c1f26;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}</style>
</head><body>
<div style="background:#242836;border:1px solid #2d3748;border-radius:16px;padding:32px;max-width:500px;width:100%;text-align:center">
  <div style="font-size:48px;margin-bottom:16px">📅</div>
  <h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Importar Escala de Junho/2026</h1>
  <p style="font-size:13px;color:#718096;margin-bottom:8px">Importa <strong style="color:#e2e8f0">~204 linhas</strong> de escala histórica (01–28/jun) de 10 colaboradores para a planilha.</p>
  <p style="font-size:12px;color:#4a5568;margin-bottom:24px">Duplicatas são ignoradas automaticamente — pode clicar mais de uma vez com segurança.</p>
  <button id="btn" onclick="importar()" style="background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:14px 32px;font-size:15px;font-weight:600;cursor:pointer;width:100%">▶ Importar agora</button>
  <div id="msg" style="margin-top:16px;font-size:13px;display:none"></div>
  <div style="margin-top:20px"><a href="/api/app" style="font-size:12px;color:#4a5568">← Voltar para o Pulse</a></div>
</div>
<script>
async function importar(){
  var btn=document.getElementById('btn'),msg=document.getElementById('msg');
  btn.textContent='Importando...';btn.disabled=true;btn.style.background='#374151';
  msg.style.display='none';
  try{
    var r=await fetch('/api/import-escala',{method:'POST',headers:{'Authorization':'Bearer ${TOKEN}'}});
    var d=await r.json();
    if(d.ok){
      msg.style.display='block';msg.style.color='#68d391';
      msg.textContent='✓ Concluído! '+d.gravadas+' linhas gravadas'+(d.ignoradas?' · '+d.ignoradas+' já existiam':'')+'.';
      btn.textContent='✓ Importado';btn.style.background='#166534';
    }else{
      msg.style.display='block';msg.style.color='#fc8181';msg.textContent='Erro: '+(d.error||'?');
      btn.textContent='▶ Tentar novamente';btn.disabled=false;btn.style.background='#1d4ed8';
    }
  }catch(e){
    msg.style.display='block';msg.style.color='#fc8181';msg.textContent='Erro de conexão: '+e.message;
    btn.textContent='▶ Tentar novamente';btn.disabled=false;btn.style.background='#1d4ed8';
  }
}
</script>
</body></html>`);
  }

  // POST: executa a importação (token ou cookie de gestor)
  if (req.method === 'POST') {
    if (!tokenOk) {
      // Verificar cookie de gestor como alternativa
      let ok = false;
      try {
        const COOKIE_NAME = 'pulse_session';
        const cookies = {};
        (req.headers.cookie||'').split(';').forEach(c=>{const p=c.trim().split('=');cookies[p.shift()]=p.join('=');});
        const sessionToken = cookies[COOKIE_NAME];
        if (sessionToken) {
          const { createHash } = await import('crypto');
          const hash = s => createHash('sha256').update(s+'pulse2026').digest('hex').slice(0,32);
          const d = Buffer.from(sessionToken,'base64').toString('utf8');
          const last=d.lastIndexOf('|'), sec=d.lastIndexOf('|',last-1);
          const data=d.slice(0,sec), h=d.slice(sec+1,last), ts=d.slice(last+1);
          if(Date.now()-parseInt(ts,10)<7*24*3600*1000 && h===hash(data+ts) && !data.startsWith('~~OAUTH~~')) {
            const nome = data.split('~~')[0];
            const eq = await sheetsRequest(SHEET_ID,'/values/Equipe!A2:I200').then(d=>d.values||[]);
            const u = eq.find(r=>r[0]===nome);
            ok = u?.[8]==='gestor';
          }
        }
      } catch {}
      if (!ok) return res.status(401).json({ error: 'Acesso negado' });
    }

  try {
    const existing = await sheetsRequest(SHEET_ID, '/values/Escala!A2:F5000').then(d => d.values||[]);
    const existingKeys = new Set(existing.filter(r=>r[0]&&r[2]).map(r=>`${r[0]}|${r[2]}`));

    const novas = LINHAS.filter(r => !existingKeys.has(`${r[0]}|${r[2]}`));

    if (novas.length === 0) {
      return res.status(200).json({ ok: true, gravadas: 0, ignoradas: LINHAS.length, msg: 'Todas as linhas já existiam na planilha.' });
    }

    await sheetsRequest(SHEET_ID, `/values/Escala!A:F:append?valueInputOption=USER_ENTERED`, 'POST', { values: novas });

    return res.status(200).json({ ok: true, gravadas: novas.length, total: LINHAS.length, ignoradas: LINHAS.length - novas.length });
  } catch (err) {
    console.error('import-escala ERRO:', err.message);
    return res.status(500).json({ error: err.message });
  }
  } // fecha o bloco POST
}
