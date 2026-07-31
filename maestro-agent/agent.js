// agent.js
// Roda uma vez por execução (agendar no Task Scheduler, sem loop interno).
// Pra cada device em devices.json: (1) consulta via SNMP (nome, temperatura, fans),
// decide OK/Crítico localmente, manda pro /api/maestro-ingest; (2) manda uma leitura
// detalhada (decodificação/rede/software) pro /api/maestro-detalhe-ingest; (3) busca
// comandos pendentes em /api/maestro-comandos-pendentes e executa via SNMP SET.
// OIDs calculados a partir de ATEME-DR5000-MIB.smi (ateme=enterprises.27338,
// dr5000=ateme.5).

import snmp from 'net-snmp';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const MAESTRO_BASE_URL = process.env.MAESTRO_BASE_URL || 'https://pulse-ia-six.vercel.app';
const MAESTRO_AGENT_TOKEN = process.env.MAESTRO_AGENT_TOKEN;

// objetos escalares em SNMP precisam do sufixo ".0" pra instância (confirmado
// contra o equipamento real - sem o .0 a resposta é NoSuchInstance).
const OID_UNIT_NAME = '1.3.6.1.4.1.27338.5.2.1.0';
const OID_TEMPERATURE = '1.3.6.1.4.1.27338.5.7.1.0';
const OID_FAN_IS_FAILING = '1.3.6.1.4.1.27338.5.7.2.1.1.2';
// TruthValue do SNMP: true(1) / false(2) - não é booleano de JS, 2 não é "falsy".

// leitura detalhada (dr5000StatusDecodeCurrentProgramVideoDecoded, dr5000Network,
// dr5000Software) - best-effort, cada campo pode vir NoSuchInstance sem travar o resto.
const OID_VIDEO_CODEC = '1.3.6.1.4.1.27338.5.5.2.1.2.2.2.0';
const OID_VIDEO_BITRATE = '1.3.6.1.4.1.27338.5.5.2.1.2.2.5.0';
const OID_VIDEO_WIDTH = '1.3.6.1.4.1.27338.5.5.2.1.2.2.6.0';
const OID_VIDEO_HEIGHT = '1.3.6.1.4.1.27338.5.5.2.1.2.2.7.0';
const OID_VIDEO_FPS_NUM = '1.3.6.1.4.1.27338.5.5.2.1.2.2.10.0';
const OID_VIDEO_FPS_DEN = '1.3.6.1.4.1.27338.5.5.2.1.2.2.11.0';
const OID_NETWORK_NAME_1 = '1.3.6.1.4.1.27338.5.8.1.1.1.2.1';
const OID_NETWORK_ADDRESS_1 = '1.3.6.1.4.1.27338.5.8.1.1.1.5.1';
const OID_NETWORK_GATEWAY_1 = '1.3.6.1.4.1.27338.5.8.1.1.1.7.1';
const OID_SOFTWARE_VERSION = '1.3.6.1.4.1.27338.5.6.1.0';

const VIDEO_CODEC_MAP = { 1: 'unknown', 2: 'h264', 3: 'mp2v' };

// comandos de controle (dr5000ChannelCommand, dr5000ChannelConfigurationInput)
const OID_PRESET_LOAD_INDEX = '1.3.6.1.4.1.27338.5.3.1.2.1.0';
const OID_PRESET_ACTION = '1.3.6.1.4.1.27338.5.3.1.1.0';
const OID_INPUT_TYPE = '1.3.6.1.4.1.27338.5.3.2.2.1.0';
const INPUT_TYPE_ENUM = { ip: 1, asi: 2, sat: 3, ds3: 4, zixi: 5, ultraIp: 6, srt: 7, rist: 8 };

const devices = JSON.parse(readFileSync(path.join(__dirname, 'devices.json'), 'utf8'));

function snmpGet(host, community, oids) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, { timeout: 5000, retries: 1, version: snmp.Version2c });
    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      resolve(varbinds);
    });
  });
}

function snmpWalkFans(host, community, baseOid) {
  return new Promise((resolve) => {
    const session = snmp.createSession(host, community, { timeout: 5000, retries: 1, version: snmp.Version2c });
    const fails = [];
    session.subtree(
      baseOid,
      (varbinds) => {
        for (const vb of varbinds) {
          if (!snmp.isVarbindError(vb)) fails.push(Number(vb.value) === 1);
        }
      },
      () => {
        session.close();
        resolve(fails); // erro ou sem fans -> lista vazia, não bloqueia o resto
      }
    );
  });
}

function snmpSet(host, community, oid, type, value) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community, { timeout: 5000, retries: 1, version: snmp.Version2c });
    session.set([{ oid, type, value }], (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      const vb = varbinds && varbinds[0];
      if (vb && snmp.isVarbindError(vb)) return reject(new Error(snmp.varbindError(vb)));
      resolve();
    });
  });
}

async function checarDevice(device) {
  let item = device.nome;
  let status = 'OK';
  let observacao = '';

  try {
    const varbinds = await snmpGet(device.host, device.community, [OID_UNIT_NAME, OID_TEMPERATURE]);
    const nomeSnmp = varbinds[0] && !snmp.isVarbindError(varbinds[0]) ? String(varbinds[0].value) : null;
    const temp = varbinds[1] && !snmp.isVarbindError(varbinds[1]) ? Number(varbinds[1].value) : null;

    const fansFailing = await snmpWalkFans(device.host, device.community, OID_FAN_IS_FAILING);

    if (temp !== null && temp >= device.tempCritica) {
      status = 'Crítico';
      observacao = `Temperatura ${temp}°C (limite ${device.tempCritica}°C)`;
    } else if (fansFailing.some(Boolean)) {
      status = 'Crítico';
      observacao = 'Fan com falha detectada';
    } else {
      status = 'OK';
      observacao = temp !== null ? `Temperatura ${temp}°C` : 'SNMP respondeu, sem leitura de temperatura';
    }
    if (nomeSnmp) item = `${device.nome} (${nomeSnmp})`;
  } catch (err) {
    status = 'Crítico';
    observacao = `Equipamento não respondeu ao SNMP (${err.message})`;
  }

  return { item, categoria: 'Encoder', status, observacao };
}

async function coletarDetalhe(device) {
  const oids = [
    OID_VIDEO_CODEC, OID_VIDEO_BITRATE, OID_VIDEO_WIDTH, OID_VIDEO_HEIGHT,
    OID_VIDEO_FPS_NUM, OID_VIDEO_FPS_DEN, OID_NETWORK_NAME_1, OID_NETWORK_ADDRESS_1,
    OID_NETWORK_GATEWAY_1, OID_SOFTWARE_VERSION,
  ];
  try {
    const vb = await snmpGet(device.host, device.community, oids);
    const val = (i) => (vb[i] && !snmp.isVarbindError(vb[i]) ? vb[i].value : null);
    const fpsNum = val(4);
    const fpsDen = val(5);
    return {
      videoCodec: VIDEO_CODEC_MAP[Number(val(0))] || val(0),
      videoBitrateBps: val(1),
      videoResolucao: val(2) && val(3) ? `${val(2)}x${val(3)}` : null,
      videoFps: fpsNum && fpsDen ? Number(fpsNum) / Number(fpsDen) : null,
      redeNome: val(6) ? String(val(6)) : null,
      redeEndereco: val(7) ? String(val(7)) : null,
      redeGateway: val(8) ? String(val(8)) : null,
      versaoSoftware: val(9) ? String(val(9)) : null,
    };
  } catch (err) {
    return { erro: err.message };
  }
}

async function executarComando(device, comando) {
  if (comando.acao === 'carregar_preset') {
    const idx = parseInt(comando.parametro, 10);
    if (!Number.isInteger(idx)) throw new Error('parâmetro de preset inválido');
    await snmpSet(device.host, device.community, OID_PRESET_LOAD_INDEX, snmp.ObjectType.Integer, idx);
    await snmpSet(device.host, device.community, OID_PRESET_ACTION, snmp.ObjectType.Integer, 2);
    return `Preset ${idx} carregado`;
  }
  if (comando.acao === 'trocar_entrada') {
    const val = INPUT_TYPE_ENUM[comando.parametro];
    if (!val) throw new Error(`tipo de entrada desconhecido: ${comando.parametro}`);
    await snmpSet(device.host, device.community, OID_INPUT_TYPE, snmp.ObjectType.Integer, val);
    return `Entrada trocada para ${comando.parametro}`;
  }
  throw new Error(`ação desconhecida: ${comando.acao}`);
}

async function enviarMaestro(payload) {
  const r = await fetch(`${MAESTRO_BASE_URL}/api/maestro-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAESTRO_AGENT_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`MAESTRO respondeu ${r.status}: ${await r.text()}`);
  return r.json();
}

async function enviarDetalhe(item, detalhe) {
  const r = await fetch(`${MAESTRO_BASE_URL}/api/maestro-detalhe-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAESTRO_AGENT_TOKEN}` },
    body: JSON.stringify({ item, detalhe }),
  });
  if (!r.ok) throw new Error(`MAESTRO respondeu ${r.status}: ${await r.text()}`);
}

async function buscarComandosPendentes() {
  const r = await fetch(`${MAESTRO_BASE_URL}/api/maestro-comandos-pendentes`, {
    headers: { Authorization: `Bearer ${MAESTRO_AGENT_TOKEN}` },
  });
  if (!r.ok) throw new Error(`MAESTRO respondeu ${r.status}`);
  const d = await r.json();
  return d.comandos || [];
}

async function reportarResultado(comando, status, resultado) {
  await fetch(`${MAESTRO_BASE_URL}/api/maestro-comando-resultado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAESTRO_AGENT_TOKEN}` },
    body: JSON.stringify({
      linha: comando.linha,
      timestamp: comando.timestamp,
      item: comando.item,
      acao: comando.acao,
      parametro: comando.parametro,
      solicitadoPor: comando.solicitadoPor,
      status,
      resultado,
    }),
  });
}

async function main() {
  if (!MAESTRO_AGENT_TOKEN) {
    console.error('MAESTRO_AGENT_TOKEN não configurado — copie .env.example para .env e preencha.');
    process.exit(1);
  }

  for (const device of devices) {
    const resultado = await checarDevice(device);
    console.log(`[${device.nome}] ${resultado.status} — ${resultado.observacao}`);
    try {
      await enviarMaestro(resultado);
      console.log(`[${device.nome}] enviado ao MAESTRO com sucesso`);
    } catch (err) {
      console.error(`[${device.nome}] falha ao enviar ao MAESTRO:`, err.message);
    }

    try {
      const detalhe = await coletarDetalhe(device);
      await enviarDetalhe(resultado.item, detalhe);
      console.log(`[${device.nome}] detalhe enviado ao MAESTRO`);
    } catch (err) {
      console.error(`[${device.nome}] falha ao coletar/enviar detalhe:`, err.message);
    }
  }

  try {
    const pendentes = await buscarComandosPendentes();
    for (const comando of pendentes) {
      const device = devices.find((d) => d.nome === comando.item);
      if (!device) {
        console.log(`[comando] item "${comando.item}" não é um device conhecido deste agente, ignorando`);
        continue;
      }
      try {
        const resultadoComando = await executarComando(device, comando);
        await reportarResultado(comando, 'Executado', resultadoComando);
        console.log(`[comando] ${comando.acao} em ${comando.item}: ${resultadoComando}`);
      } catch (err) {
        await reportarResultado(comando, 'Falhou', err.message);
        console.error(`[comando] ${comando.acao} em ${comando.item} falhou:`, err.message);
      }
    }
  } catch (err) {
    console.error('falha ao buscar comandos pendentes:', err.message);
  }
}

main();
