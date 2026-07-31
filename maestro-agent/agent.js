// agent.js
// Roda uma vez por execução (agendar no Task Scheduler, sem loop interno).
// Pra cada device em devices.json: consulta via SNMP (nome, temperatura, fans),
// decide OK/Crítico localmente, e manda o resultado pro /api/maestro-ingest.
// OIDs calculados a partir de ATEME-DR5000-MIB.smi (ateme=enterprises.27338,
// dr5000=ateme.5): dr5000Unit.Name=.5.2.1, dr5000HardwareTemperature=.5.7.1,
// dr5000HardwareFanIsFailing (tabela)=.5.7.2.1.1.2.*

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

async function enviarMaestro(payload) {
  const r = await fetch(`${MAESTRO_BASE_URL}/api/maestro-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MAESTRO_AGENT_TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`MAESTRO respondeu ${r.status}: ${await r.text()}`);
  return r.json();
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
  }
}

main();
