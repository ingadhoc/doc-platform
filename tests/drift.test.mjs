/**
 * Suite del drift-check. `node --test tests/drift.test.mjs`
 *
 * Sin red: `leerTags` y `leerChangelog` entran inyectados. Lo que se prueba es
 * la DECISIÓN — qué bloquea, qué se reporta y qué se hace cuando GitHub no
 * contesta —, que es lo único que este check tiene de propio: si el rezago de
 * seguridad del gate no pone rojo el CI del consumidor, el pin manual deja de
 * ser una decisión y pasa a ser un olvido.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { comparar, correrDriftCheck, evaluar, tagDelSpec, versionesDelChangelog } from '../lib/drift.mjs';

const CHANGELOG = `# CHANGELOG

## v0.3.0 — 2026-09-15
### Seguridad
- **[seguridad] gate: el 503 de audiencia ausente ahora corta también el GET.**
- indice: un fix de ranking.

## v0.2.0 — 2026-09-01
- **[seguridad] feedback: se dejó de loguear el clientId.** En negrita, como
  los escribe el CHANGELOG real desde la v0.5.0.
- mcp-handler: prosa nueva.

## v0.1.0 — 2026-08-23
- primer paquete.
`;

const changelog = versionesDelChangelog(CHANGELOG);

function consumidor(spec, { lock } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'oba-docs', dependencies: spec ? { '@ingadhoc/docs-platform': spec } : {} }),
  );
  if (lock) fs.writeFileSync(path.join(tmp, 'package-lock.json'), JSON.stringify(lock));
  return tmp;
}

/** Corre el check capturando la salida, sin tocar la red. */
async function correr(repo, { tags = ['v0.1.0', 'v0.2.0', 'v0.3.0'], texto = CHANGELOG, ...resto } = {}) {
  const lineas = [];
  const codigo = await correrDriftCheck({
    repo,
    log: (...p) => lineas.push(p.join(' ')),
    error: (...p) => lineas.push(p.join(' ')),
    leerTags: async () => {
      if (tags === null) throw new Error('getaddrinfo ENOTFOUND github.com');
      return tags;
    },
    leerChangelog: async () => {
      if (texto === null) throw new Error('HTTP 404');
      return texto;
    },
    ...resto,
  });
  return { codigo, salida: lineas.join('\n') };
}

describe('parseo del CHANGELOG (la convención es el contrato con el CI)', () => {
  it('lee versión, fecha e ítems, y los `###` no cortan la versión', () => {
    assert.deepEqual(changelog.map((v) => v.version), ['v0.3.0', 'v0.2.0', 'v0.1.0']);
    assert.equal(changelog[0].fecha, '2026-09-15');
    assert.equal(changelog[0].items.length, 2, 'el ítem de después del ### tiene que entrar');
  });

  it('el tag pineado sale del spec, y un rango NO es un pin', () => {
    assert.equal(tagDelSpec('github:ingadhoc/doc-platform#v0.1.0'), 'v0.1.0');
    assert.equal(tagDelSpec('github:ingadhoc/doc-platform#main'), null);
    assert.equal(tagDelSpec('^0.1.0'), null);
    assert.equal(comparar('v0.10.0', 'v0.9.0') > 0, true, 'semver, no orden alfabético');
  });
});

describe('qué bloquea y qué solo se reporta', () => {
  it('rezago con [seguridad] que toca el gate: bloquea', () => {
    const r = evaluar({ pineado: 'v0.2.0', vigente: 'v0.3.0', changelog });
    assert.equal(r.bloqueantes.length, 1);
    assert.match(r.bloqueantes[0].item, /gate/);
    assert.equal(r.lagDias, 14);
    assert.equal(r.lagDiasHabiles, 10);
  });

  it('rezago con [seguridad] que NO toca guard ni gate: se reporta, no bloquea', () => {
    const r = evaluar({ pineado: 'v0.1.0', vigente: 'v0.2.0', changelog });
    assert.equal(r.bumpsDeSeguridad, 1);
    assert.equal(r.bloqueantes.length, 0);
    assert.equal(r.lagDias, 9);
  });

  it('al día: sin rezago, sin bumps, sin nada que reportar', () => {
    const r = evaluar({ pineado: 'v0.3.0', vigente: 'v0.3.0', changelog });
    assert.equal(r.alDia, true);
    assert.deepEqual(r.rezago, []);
    assert.equal(r.bumpsDeSeguridad, 0);
  });

  it('un pin MÁS NUEVO que el último tag (release en vuelo) no es rezago', () => {
    assert.equal(evaluar({ pineado: 'v0.4.0', vigente: 'v0.3.0', changelog }).alDia, true);
  });
});

describe('el check completo, contra un consumidor de mentira', () => {
  it('pin viejo con seguridad del gate: exit 1 y dice a qué tag subir', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.2.0'));
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /seguridad del guard o del gate sin adoptar/);
    assert.match(r.salida, /Subí el pin a v0\.3\.0/);
  });

  it('el lag se reporta SIEMPRE, incluso cuando no bloquea (alarma de la Etapa B)', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.1.0'), {
      tags: ['v0.1.0', 'v0.2.0'],
    });
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /lag: 9 día\(s\) corridos \/ 7 hábil\(es\)/);
    assert.match(r.salida, /bumps de seguridad en el rezago: 1/);
    assert.match(r.salida, /alarma de la Etapa B/);
  });

  it('al día: exit 0 y lo dice', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.3.0'));
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /al día/);
  });

  it('sin red: exit 0 con warning, no bloquea el build de nadie', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.1.0'), { tags: null });
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /no se pudo consultar/);
    assert.match(r.salida, /mide un riesgo diferido/);
  });

  it('sin CHANGELOG remoto: reporta que no pudo evaluar, y no inventa un verde limpio', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.1.0'), { texto: null });
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /no se pudo leer el CHANGELOG/);
    assert.match(r.salida, /rezago: \? versión/);
  });

  it('un rango en vez de un tag: exit 1 (un pin que no pinea no es un pin)', async () => {
    const r = await correr(consumidor('^0.1.0'));
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /TAG EXACTO/);
  });

  it('un repo que no consume el paquete: no hay drift que medir', async () => {
    const r = await correr(consumidor(null));
    assert.equal(r.codigo, 0);
    assert.match(r.salida, /no hay drift que medir/);
  });

  it('lockfile que resolvió otra cosa que el package.json: BLOQUEA', async () => {
    const repo = consumidor('github:ingadhoc/doc-platform#v0.3.0', {
      lock: {
        packages: {
          'node_modules/@ingadhoc/docs-platform': {
            version: '0.1.0',
            resolved: 'git+ssh://git@github.com/ingadhoc/doc-platform.git#abc123',
          },
        },
      },
    });
    const r = await correr(repo);
    // Bloquea, no avisa: lo que se deploya no es lo que el repo declara, y un
    // aviso ahí ya demostró que se lee tarde (01/09/2026, tres repos).
    assert.equal(r.codigo, 1);
    assert.match(r.salida, /el lockfile resolvió/);
    assert.match(r.salida, /npm install/, 'tiene que decir cómo se arregla');
  });

  it('el lockfile alineado no molesta, aunque el `resolved` sea un sha', async () => {
    // El `resolved` de un dep de git es `...#<sha>`, nunca el tag: lo que
    // alinea es la `version` del paquete.
    const repo = consumidor('github:ingadhoc/doc-platform#v0.3.0', {
      lock: {
        packages: {
          'node_modules/@ingadhoc/docs-platform': {
            version: '0.3.0',
            resolved: 'git+ssh://git@github.com/ingadhoc/doc-platform.git#abc123',
          },
        },
      },
    });
    assert.equal((await correr(repo)).codigo, 0);
  });

  it('--json: una línea agregable, con el lag y los bloqueantes', async () => {
    const r = await correr(consumidor('github:ingadhoc/doc-platform#v0.2.0'), { json: true });
    const linea = r.salida.split('\n').find((l) => l.startsWith('{'));
    const datos = JSON.parse(linea);
    assert.equal(datos.pineado, 'v0.2.0');
    assert.equal(datos.vigente, 'v0.3.0');
    assert.equal(datos.lagDias, 14);
    assert.equal(datos.bumpsDeSeguridad, 1);
    assert.equal(datos.bloqueantes.length, 1);
    assert.equal(datos.exit, 1);
  });
});
