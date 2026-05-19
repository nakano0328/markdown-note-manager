import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'sample-notes');
const target = path.join(root, '.tmp', 'e2e-notes');

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.cp(source, target, {
	recursive: true,
	filter: (src) => !src.split(path.sep).includes('.git')
});
