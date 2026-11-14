// lib/fila-central.js — fila de avisos do ALTO-FALANTE DA CENTRAL (substitui a Echo/Voice Monkey, 2026-11-14).
// Recados de texto, recados em áudio e alarmes entram nesta fila (Durable Object, ver cloudflare/presenca.js). A página
// /api/central-som, aberta num computador/TV da sala, busca a fila a cada 2 s e toca/fala (lib/central-som-page.js).
import { createHmac } from 'crypto';

// Chave do link do alto-falante (a página fica aberta sem login numa máquina da sala). Derivada de um segredo que já existe;
// muda se o GOOGLE_CLIENT_SECRET for trocado. Quem tem o link só OUVE os avisos, não manda nada.
export function chaveAltoFalante() {
  return createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET || 'sem-segredo').update('pulse-central-som-v1').digest('hex').slice(0, 32);
}
export const urlAltoFalante = () => 'https://pulse.livemode.ai/api/central-som?k=' + chaveAltoFalante();

// item: { tipo: 'texto' | 'alarme' | 'audio', texto?, url?, de? }  — retorna true se entrou na fila
export async function empilharNaCentral(item, env = globalThis.PULSE_ENV) {
  try {
    const obj = env.PRESENCA.get(env.PRESENCA.idFromName('central'));
    const r = await obj.fetch('https://presenca/fila', { method: 'POST', body: JSON.stringify(item) });
    return r.ok;
  } catch (e) { console.error('fila-central:', e && e.message); return false; }
}
// O Voice Monkey (Echo) só dispara se alguém ligar de propósito (VOICEMONKEY_ATIVO = "sim" em wrangler.toml). Por padrão está desligado.
export const vmAtivo = (env = process.env) => String(env.VOICEMONKEY_ATIVO || '') === 'sim' && !!(env.VOICEMONKEY_TOKEN && env.VOICEMONKEY_DEVICE);
