import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { manifest, records } = JSON.parse(await readFile(join(root, 'public/data/index.json'), 'utf8'));
if (records.length !== manifest.total || records.filter(r => r.analysis).length !== manifest.analysis) throw new Error('Dataset counts do not reconcile');
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist'), { recursive: true });
await cp(join(root, 'public'), join(root, 'dist'), { recursive: true });
console.log(`Built static app with ${records.length.toLocaleString()} records. API keys remain server-side.`);
