// Add CI deployment targets without saving account settings in public source.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const domain = process.env.CLOUDFLARE_CUSTOM_DOMAIN;
if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the deployment account ID');
if (!domain || domain.length > 253 || !domain.includes('.') || !domain.split('.').every(label =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
  throw new Error('Set CLOUDFLARE_CUSTOM_DOMAIN to a hostname without a scheme, path or wildcard');
}
// This repository keeps wrangler.jsonc in JSON syntax so no parser dependency is needed.
const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
config.$schema = resolve(root, 'node_modules/wrangler/config-schema.json');
config.account_id = accountId;
config.routes = [{ pattern: domain, custom_domain: true }];
config.workers_dev = true;
config.assets.directory = resolve(root, config.assets.directory);
await mkdir(resolve(root, 'output'), { recursive: true });
await writeFile(resolve(root, 'output/ci-wrangler.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log('Created output/ci-wrangler.json');
