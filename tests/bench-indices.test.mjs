/**
 * `bench/indices.sh` contra clones falsos: emisores de juguete que sólo
 * escriben un `index.json`, en repos git locales con `origin/main`. Protege lo
 * que se rompe sin avisar en un script de shell, como un directorio de
 * trabajo relativo que deja de valer después de un `cd`. `node --test`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPT = fileURLToPath(new URL('../bench/indices.sh', import.meta.url));

// Escribe `index.json` donde lo dejaría el emisor real: `POC_OUT` o el cwd.
const BUILD = `import { mkdirSync, writeFileSync } from 'node:fs';
const out = (process.env.POC_OUT || process.cwd()) + '/api/_generated';
mkdirSync(out, { recursive: true });
writeFileSync(out + '/index.json', '{}');
`;
const EMITIR = `import { mkdirSync, writeFileSync } from 'node:fs';
const i = process.argv.findIndex((a) => a.startsWith('--salida='));
const out = i >= 0 ? process.argv[i].split('=')[1] : 'dist/agente';
mkdirSync(out, { recursive: true });
writeFileSync(out + '/index.json', '{}');
`;

function escribir(ruta, texto) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
}

function clonFalso(clones, nombre, archivos) {
  const fuente = join(clones, `_fuente-${nombre}`);
  for (const [ruta, texto] of Object.entries(archivos)) escribir(join(fuente, ruta), texto);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
  git(fuente, 'init', '-q', '-b', 'main');
  git(fuente, 'add', '.');
  git(fuente, 'commit', '-q', '-m', 'x');
  git(clones, 'clone', '-q', fuente, nombre);
}

describe('bench/indices.sh', () => {
  it('acepta un directorio de trabajo relativo', () => {
    const base = mkdtempSync(join(tmpdir(), 'indices-sh-'));
    const clones = join(base, 'clones');
    mkdirSync(clones);
    for (const r of ['oba-docs', 'odumbo-docs', 'adhoc-docs']) clonFalso(clones, r, { 'tools/build.mjs': BUILD });
    clonFalso(clones, 'tuqui-docs', { 'tools/emitir-indice.mjs': EMITIR, 'tools/keywords-es.json': '{}' });
    mkdirSync(join(clones, 'oba-docs/node_modules/alguna-dep'), { recursive: true });
    mkdirSync(join(clones, 'adhoc-docs/content'), { recursive: true });
    writeFileSync(join(clones, 'adhoc-docs/docs.config.json'), '{}');

    execFileSync('bash', [SCRIPT, 'trabajo'], { cwd: base, env: { ...process.env, CLONES: clones }, stdio: 'pipe' });
    for (const indice of ['oba-docs-publico', 'odumbo-docs-interno', 'adhoc-docs-interno', 'tuqui-docs-es', 'tuqui-docs-en', 'tuqui-docs-es-sin-keywords']) {
      assert.ok(existsSync(join(base, 'trabajo/indices', `${indice}.json`)), indice);
    }
  });
});
