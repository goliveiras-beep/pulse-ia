import snmp from 'net-snmp';

const host = '172.16.30.51';
const community = 'public';

const candidates = {
  unitName: '1.3.6.1.4.1.27338.5.2.1.0',
  unitModel: '1.3.6.1.4.1.27338.5.2.2.0',
  unitSerial: '1.3.6.1.4.1.27338.5.2.3.0',
  temperature: '1.3.6.1.4.1.27338.5.7.1.0',
  fan1: '1.3.6.1.4.1.27338.5.7.2.1.1.2.1',
  fan2: '1.3.6.1.4.1.27338.5.7.2.1.1.2.2',
};

function get(session, oid) {
  return new Promise((resolve) => {
    session.get([oid], (error, varbinds) => {
      if (error) return resolve(`ERRO SESSAO: ${error.message}`);
      const vb = varbinds[0];
      if (snmp.isVarbindError(vb)) return resolve(`ERRO VARBIND: ${snmp.varbindError(vb)}`);
      resolve(String(vb.value));
    });
  });
}

async function main() {
  const session = snmp.createSession(host, community, {
    timeout: 4000,
    retries: 1,
    version: snmp.Version2c,
  });

  for (const [name, oid] of Object.entries(candidates)) {
    const result = await get(session, oid);
    console.log(`${name.padEnd(14)} ${oid.padEnd(32)} -> ${result}`);
  }

  session.close();
}

main();
