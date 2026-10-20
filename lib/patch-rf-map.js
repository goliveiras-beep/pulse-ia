// lib/patch-rf-map.js — mapa padrão do patch de RF do CPD (Quintech -> IRDs/MediaKinds/Demods)
// e regras de validação/estado atual. Usado por lib/routes/registros-tecnicos.js (servidor) e
// serializado pra tela (cliente), pra existir uma única definição do "padrão".

// Entrada de cada Quintech: [antena, satélite, polarização]
export const QIN = {
  'Q1-1': ['RX01', 'IS35e', 'L'], 'Q1-2': ['RX01', 'IS35e', 'R'],
  'Q1-3': ['RX02', 'SES14', 'L'], 'Q1-4': ['RX02', 'SES14', 'R'],
  'Q2-1': ['RX03', 'SES14', 'L'], 'Q2-2': ['RX03', 'SES14', 'R'],
  'Q2-3': ['RX04', 'IS34', 'V'],  'Q2-4': ['RX04', 'IS34', 'H'],
  'Q3-1': ['RX05', 'D2', 'V'],    'Q3-2': ['RX05', 'D2', 'H'],
  'Q3-3': ['RX06', 'AMZ3', 'V'],  'Q3-4': ['RX06', 'AMZ3', 'H'],
};

// Dispositivos e a saída de Quintech que cada entrada deveria receber (padrão). Notação Qx-e.s =
// Quintech x, entrada e, saída s.
export const DEVICES = [
  { id: 'IRD1', model: 'Ateme DR5000', ins: ['Q1-3.2', 'Q1-4.2', 'Q3-3.2', 'Q3-4.2'] },
  { id: 'IRD2', model: 'Ateme DR5000', ins: ['Q2-1.2', 'Q2-2.2', 'Q3-3.3', 'Q3-4.3'] },
  { id: 'IRD3', model: 'Ateme DR5000', ins: ['Q1-1.2', 'Q1-2.2', 'Q1-3.3', 'Q2-2.3'] },
  { id: 'IRD4', model: 'Ateme DR5000', ins: ['Q1-1.3', 'Q1-2.3', 'Q1-4.3', 'Q2-1.3'] },
  { id: 'IRD5', model: 'Ateme DR5000', ins: ['Q3-3.4', 'Q3-4.4', 'Q2-3.1', 'Q2-4.1'] },
  { id: 'IRD6', model: 'Ateme DR5000', ins: ['Q1-3.4', 'Q2-1.4', 'Q3-1.1', 'Q3-2.1'] },
  { id: 'MK1', model: 'MediaKind 1', ins: ['Q1-1.1'] }, { id: 'MK2', model: 'MediaKind 1', ins: ['Q1-3.1'] },
  { id: 'MK3', model: 'MediaKind 1', ins: ['Q2-2.1'] }, { id: 'MK4', model: 'MediaKind 1', ins: ['Q3-3.1'] },
  { id: 'MK5', model: 'MediaKind 2', ins: ['Q1-2.1'] }, { id: 'MK6', model: 'MediaKind 2', ins: ['Q1-4.1'] },
  { id: 'MK7', model: 'MediaKind 2', ins: ['Q2-1.1'] }, { id: 'MK8', model: 'MediaKind 2', ins: ['Q3-4.1'] },
  { id: 'DEMOD1', model: 'Novelsat', ins: ['Q1-4.4'] }, { id: 'DEMOD2', model: 'Novelsat', ins: ['Q2-2.4'] },
];

// Unidades físicas do rack (cada uma com até 4 conectores)
const portsDe = (ids) => ids.map((id) => ({ dev: id, inp: 1, label: id }));
export const UNITS = [
  { name: 'MediaKind 1', model: 'MediaKind', ports: portsDe(['MK1', 'MK2', 'MK3', 'MK4']) },
  { name: 'MediaKind 2', model: 'MediaKind', ports: portsDe(['MK5', 'MK6', 'MK7', 'MK8']) },
  ...['IRD1', 'IRD2', 'IRD3', 'IRD4', 'IRD5', 'IRD6'].map((id) => ({
    name: id, model: 'Ateme DR5000', ports: [1, 2, 3, 4].map((i) => ({ dev: id, inp: i, label: 'IN' + i })),
  })),
  { name: 'Novelsat', model: 'Demod', ports: portsDe(['DEMOD1', 'DEMOD2']) },
];

export const DISCONNECTED = 'Desconectado';
export const OTHER = 'Outro (descrever nas observações)';
export const TIPOS = ['Alteração de patch', 'Teste ou medição', 'Manutenção', 'Normalização ao padrão'];

export const PORTS = [];
for (const q of ['Q1', 'Q2', 'Q3']) for (let e = 1; e <= 4; e++) for (let s = 1; s <= 4; s++) PORTS.push(`${q}-${e}.${s}`);
const PORTAS_VALIDAS = new Set([...PORTS, DISCONNECTED, OTHER]);

export const TOTAL_ENTRADAS = DEVICES.reduce((n, d) => n + d.ins.length, 0);

export function padraoDe(dev, inp) {
  const d = DEVICES.find((x) => x.id === dev);
  return d ? d.ins[inp - 1] || null : null;
}

// Estado atual de cada entrada: o último registro (por data) manda. Registros removidos não contam.
export function mapaAtual(rows) {
  const m = {};
  const ordem = rows.filter((r) => !r.removido)
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || (a.linha || 0) - (b.linha || 0));
  for (const r of ordem) m[`${r.dispositivo}|${r.entrada}`] = { src: r.para, row: r };
  return m;
}

export function entradasForaDoPadrao(rows) {
  const cur = mapaAtual(rows);
  const fora = [];
  for (const d of DEVICES) {
    d.ins.forEach((pd, k) => {
      const c = cur[`${d.id}|${k + 1}`];
      if (c && c.src !== pd) fora.push({ dispositivo: d.id, entrada: k + 1, de: c.src, para: pd });
    });
  }
  return fora;
}

// Devolve uma mensagem de erro (string) ou null se o registro é válido.
export function validarRegistro(r) {
  const entrada = Number(r.entrada);
  if (!padraoDe(r.dispositivo, entrada)) return 'Dispositivo ou entrada inválidos.';
  if (!TIPOS.includes(r.tipo)) return 'Tipo inválido.';
  if (!PORTAS_VALIDAS.has(r.de)) return 'Conexão anterior inválida.';
  if (!PORTAS_VALIDAS.has(r.para)) return 'Nova conexão inválida.';
  if (r.de === r.para) return 'A nova conexão é igual à anterior.';
  const motivo = String(r.motivo || '').trim();
  if (!motivo) return 'Informe o motivo da alteração.';
  if (motivo.length > 300) return 'Motivo muito longo (máx. 300 caracteres).';
  if (String(r.obs || '').length > 1000) return 'Observações muito longas (máx. 1000 caracteres).';
  const t = Date.parse(r.ts);
  if (!Number.isFinite(t)) return 'Data e hora inválidas.';
  if (t > Date.now() + 10 * 60 * 1000) return 'A data e hora não pode estar no futuro.';
  return null;
}
