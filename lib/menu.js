// lib/menu.js — lista única do menu ☰ do Pulse. Antes cada página tinha a sua cópia e elas foram
// divergindo (algumas sem Escala, Compasso, Capacidade ou Registros técnicos, e em ordens diferentes);
// agora toda página monta os itens por aqui. Pra incluir ou reordenar um item, mude só ITENS.
import { sheetsRequest } from './google-auth.js';

// [href, ícone (entidade HTML), rótulo, só gestor?]
const ITENS = [
  ['/api/app', '&#127968;', 'Início', false],
  ['/api/escalas?v=semana', '&#128197;', 'Escala', false],
  ['/api/compasso', '&#129517;', 'Compasso', false],
  ['/api/equipe-view', '&#128101;', 'Equipe', true],
  ['/api/ausencias', '&#128198;', 'Ausências', true],
  ['/api/repositorio', '&#128193;', 'Central de Conhecimento', false],
  ['/api/registros-tecnicos', '&#128225;', 'Registros técnicos', false],
  ['/api/maestro-booking-dia', '&#128197;', 'Booking — Grade do dia', false],
  ['/api/banco-horas', '&#128202;', 'Banco de horas', true],
  ['/api/capacidade', '&#128200;', 'Capacidade', true],
  ['/api/equipamentos', '&#128230;', 'Equipamentos', false],
  ['/api/chamados', '&#127915;', 'Chamados', false],
];

// Itens do menu, o separador e o botão Sair. Opções:
//  classe  — classe CSS dos itens ('menu-item' na maioria das páginas)
//  borda   — cor do separador (var(--border) na maioria; a página de antenas usa var(--line))
//  extras  — HTML a anexar no fim do item, por href (ex.: contador de pendências na home)
export function menuItens(isGestor, { classe = 'menu-item', borda = 'var(--border)', extras = {} } = {}) {
  const cls = classe ? ` class="${classe}"` : '';
  const itens = ITENS
    .filter(([, , , soGestor]) => isGestor || !soGestor)
    .map(([href, icone, rotulo]) => `        <a href="${href}"${cls}>${icone} ${rotulo}${extras[href] || ''}</a>`)
    .join('\n');
  return `${itens}
        <div style="height:1px;background:${borda};margin:2px 0"></div>
        <form method="POST" action="/api/app?action=logout" style="margin:0">
          <button type="submit"${cls} style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;color:#dc2626">&#128682; Sair</button>
        </form>`;
}

// Páginas que só sabem o nome da pessoa (as do MAESTRO) descobrem aqui se é gestor. Cache curto pra
// não ler a planilha de Equipe a cada tela.
const cache = new Map();
export async function ehGestor(nome) {
  const agora = Date.now();
  const c = cache.get(nome);
  if (c && agora - c.em < 60000) return c.v;
  let v = false;
  try {
    const d = await sheetsRequest(process.env.GOOGLE_SHEET_ID, `/values/${encodeURIComponent('Equipe!A2:M200')}`);
    const r = (d.values || []).find((x) => x[0] === nome && (x[10] || 'ativo').toLowerCase() === 'ativo');
    v = !!r && r[8] === 'gestor';
  } catch { /* sem a planilha, mostra o menu de colaborador */ }
  cache.set(nome, { v, em: agora });
  return v;
}
