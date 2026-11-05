// Copia os arquivos estáticos da raiz para .cf-assets (servidos pelo Cloudflare via binding ASSETS).
import { readdirSync, mkdirSync, copyFileSync, rmSync } from 'fs';

rmSync('.cf-assets', { recursive: true, force: true });
mkdirSync('.cf-assets', { recursive: true });
const ok = (f) => f !== 'worker.js' && (/\.(html|svg|png|js)$/.test(f) || f === 'manifest.json');
for (const f of readdirSync('.', { withFileTypes: true })) {
  if (f.isFile() && ok(f.name)) {
    copyFileSync(f.name, `.cf-assets/${f.name}`);
    console.log('asset', f.name);
  }
}
