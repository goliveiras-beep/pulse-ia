// scripts/vapid-setup.mjs — RODA UMA VEZ: cria o par de chaves dos avisos no celular (Web Push / VAPID).
//   • chave PRIVADA → vai direto pro cofre da Cloudflare (wrangler secret VAPID_PRIVATE_JWK); não é gravada em arquivo nenhum
//   • chave PÚBLICA → entra em wrangler.toml, em [vars] (VAPID_PUBLIC); pode ficar no repositório
// Não roda de novo se já existe chave: trocar a chave invalida os aparelhos já cadastrados.
import { generateKeyPairSync } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';

const toml = readFileSync('wrangler.toml', 'utf8');
if (/^VAPID_PUBLIC\s*=/m.test(toml)) { console.log('Já existe VAPID_PUBLIC no wrangler.toml — nada a fazer.'); process.exit(0); }

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const publica = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');

const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'VAPID_PRIVATE_JWK'], { input: JSON.stringify(jwk), shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) { console.error('Não consegui gravar o segredo na Cloudflare. Nada foi alterado no wrangler.toml.'); process.exit(1); }

writeFileSync('wrangler.toml', toml.replace(/^\[vars\]\s*$/m, `[vars]\nVAPID_PUBLIC = "${publica}"`));
console.log('Pronto. Chave pública gravada em wrangler.toml. Agora faça o deploy: npm run cf:deploy');
