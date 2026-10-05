// The jobs that hold the Vercel token run these actions. They must never
// check out, install or execute anything from the consumer repo.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CON_TOKEN = [
  '.github/actions/prebuilt-deploy/action.yml',
  '.github/actions/centinela/action.yml',
];
const PROHIBIDO = [
  /\bnpx\b/,
  /\bnpm\s+ci\b/,
  /^\s*cache\s*:/m,
  /actions\/checkout/,
  /actions\/cache/,
  /actions\/setup-node/,
  /--token\b/,
];

const sinComentarios = (texto) =>
  texto.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// The only allowed install: the action's own CLI lockfile, in $RUNNER_TEMP/cli.
const INSTALACION_CLI = /^\s*npm ci --ignore-scripts --no-audit --no-fund\s*$/m;
const sinInstalacionCli = (texto) =>
  /cli="\$RUNNER_TEMP\/cli"/.test(texto) && /cd "\$cli"/.test(texto)
    ? texto.replace(INSTALACION_CLI, '')
    : texto;

describe('actions con token', () => {
  for (const rel of CON_TOKEN) {
    const texto = sinInstalacionCli(sinComentarios(fs.readFileSync(path.join(ROOT, rel), 'utf8')));

    it(`${rel}: no corre código del repo`, () => {
      for (const re of PROHIBIDO) assert.doesNotMatch(texto, re, `${rel} matchea ${re}`);
    });

    it(`${rel}: las actions de terceros van fijadas por SHA`, () => {
      for (const [, ref] of texto.matchAll(/uses:\s*[\w.-]+\/[\w./-]+@(\S+)/g)) {
        assert.match(ref, /^[0-9a-f]{40}$/, `${rel}: ${ref} no es un SHA`);
      }
    });
  }

  it('centinela: un exit distinto de 0 no corta el step antes de escribir los outputs', () => {
    const texto = fs.readFileSync(path.join(ROOT, '.github/actions/centinela/action.yml'), 'utf8');
    assert.match(texto, /^\s*set \+e\b/m);
  });

  it('el CLI del deploy se instala con npm ci desde el lockfile de la action', () => {
    const texto = sinComentarios(fs.readFileSync(path.join(ROOT, '.github/actions/prebuilt-deploy/action.yml'), 'utf8'));
    assert.equal(texto.match(/\bnpm\s+ci\b/g)?.length, 1);
    assert.match(texto, INSTALACION_CLI);
    assert.doesNotMatch(texto, /\bnpm\s+install\b/);
  });

  it('el ejemplo del README pone concurrency al job deploy', () => {
    const readme = fs.readFileSync(path.join(ROOT, '.github/actions/README.md'), 'utf8');
    const deploy = readme.slice(readme.indexOf('  deploy:'));
    assert.match(deploy.slice(0, deploy.indexOf('steps:')), /concurrency:/);
  });

  it('el CLI de Vercel del deploy tiene versión exacta y lockfile', () => {
    const dir = path.join(ROOT, '.github/actions/prebuilt-deploy/cli');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    assert.match(pkg.dependencies.vercel, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages['node_modules/vercel'].version, pkg.dependencies.vercel);
  });

  it('el build usa la misma versión del CLI que el deploy', () => {
    const build = fs.readFileSync(path.join(ROOT, '.github/actions/prebuilt-build/action.yml'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/actions/prebuilt-deploy/cli/package.json'), 'utf8'));
    assert.ok(build.includes(`vercel@${pkg.dependencies.vercel} `), 'prebuilt-build y prebuilt-deploy/cli difieren');
    assert.doesNotMatch(sinComentarios(build), /vercel-token|VERCEL_TOKEN|vercel\S* pull/);
  });
});
