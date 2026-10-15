/**
 * `bench/indices.sh` contra clones falsos: emisores de juguete que sólo
 * escriben un `index.json`, en repos git locales con `origin/main`. Protege lo
 * que se rompe sin avisar en un script de shell, como un directorio de
 * trabajo relativo que deja de valer después de un `cd`. `node --test`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
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

/** Los cuatro clones falsos; oba-docs sólo con `publico`, como hoy. `sin` deja uno afuera. */
function clones(base, { sin } = {}) {
  const dir = join(base, 'clones');
  mkdirSync(dir);
  const audiencias = { 'oba-docs': ['publico'], 'odumbo-docs': ['publico', 'interno'], 'adhoc-docs': ['interno'] };
  for (const [r, audiences] of Object.entries(audiencias)) {
    if (r !== sin) clonFalso(dir, r, { 'tools/build.mjs': BUILD, 'docs.config.json': JSON.stringify({ audiences }) });
  }
  if (sin !== 'tuqui-docs') clonFalso(dir, 'tuqui-docs', { 'tools/emitir-indice.mjs': EMITIR });
  mkdirSync(join(dir, 'oba-docs/node_modules/alguna-dep'), { recursive: true });
  if (sin !== 'adhoc-docs') {
    mkdirSync(join(dir, 'adhoc-docs/content'), { recursive: true });
    writeFileSync(join(dir, 'adhoc-docs/docs.config.json'), '{}');
  }
  return dir;
}

const indices = (base) => readdirSync(join(base, 'trabajo/indices')).sort();

describe('bench/indices.sh', () => {
  it('acepta un directorio de trabajo relativo', () => {
    const base = mkdtempSync(join(tmpdir(), 'indices-sh-'));
    execFileSync('bash', [SCRIPT, 'trabajo'], { cwd: base, env: { ...process.env, CLONES: clones(base) }, stdio: 'pipe' });
    for (const indice of ['oba-docs-publico', 'odumbo-docs-interno', 'adhoc-docs-interno', 'tuqui-docs-es', 'tuqui-docs-en', 'tuqui-docs-bilingue']) {
      assert.ok(existsSync(join(base, 'trabajo/indices', `${indice}.json`)), indice);
    }
  });

  it('arma un índice por cada audiencia que declara el sitio, y ninguno más', () => {
    const base = mkdtempSync(join(tmpdir(), 'indices-sh-'));
    execFileSync('bash', [SCRIPT, 'trabajo'], { cwd: base, env: { ...process.env, CLONES: clones(base) }, stdio: 'pipe' });
    assert.deepEqual(indices(base).filter((i) => /^(oba|odumbo)-docs-/.test(i)), [
      'oba-docs-publico.json', 'odumbo-docs-interno.json', 'odumbo-docs-publico.json',
    ]);
  });

  it('un sitio sin clon se saltea y el resto se arma', () => {
    const base = mkdtempSync(join(tmpdir(), 'indices-sh-'));
    const salida = execFileSync('bash', [SCRIPT, 'trabajo'], { cwd: base, env: { ...process.env, CLONES: clones(base, { sin: 'tuqui-docs' }) }, encoding: 'utf8' });
    assert.match(salida, /tuqui-docs: sin clon/);
    assert.deepEqual(indices(base), ['adhoc-docs-interno.json', 'oba-docs-publico.json', 'odumbo-docs-interno.json', 'odumbo-docs-publico.json']);
  });

  it('no deja índices de otra corrida', () => {
    const base = mkdtempSync(join(tmpdir(), 'indices-sh-'));
    mkdirSync(join(base, 'trabajo/indices'), { recursive: true });
    writeFileSync(join(base, 'trabajo/indices/oba-docs-interno.json'), '{}');
    execFileSync('bash', [SCRIPT, 'trabajo'], { cwd: base, env: { ...process.env, CLONES: clones(base) }, stdio: 'pipe' });
    assert.equal(indices(base).includes('oba-docs-interno.json'), false);
  });
});
