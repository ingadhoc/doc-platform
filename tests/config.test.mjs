/**
 * Suite del validador del primer contrato (`docs.config.json`).
 * `node --test tests/config.test.mjs`
 *
 * Los casos NO se inventaron acá: son los que enumera
 * `docs/unificacion/mapeo-configs.md` — los tres configs de oba-docs,
 * odumbo-docs y adhoc-docs traducidos al schema unificado (que tienen que
 * validar) y los ocho inválidos a propósito con los que se verificó el schema
 * (que tienen que ser rechazados, y nombrando el campo).
 *
 * Los tres configs válidos son, además, la prueba de que el vocabulario
 * unificado expresa los tres ejes: si alguno no validara, la unificación
 * sería falsa.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CONFIG_SOPORTADO, cargarConfig, validarConfig } from '../lib/config.mjs';

// ─────────────────────────────────────── los tres configs, del mapeo-configs

const OBA = {
  schemaVersion: 1,
  eje: {
    tipo: 'version',
    default: '19',
    valores: [
      { id: '19', label: '19.0' },
      { id: '18', label: '18.0' },
    ],
  },
  audiences: ['publico', 'interno'],
  // Declarado a propósito aunque desde v0.8.0 ningún corpus lo use: el campo
  // sigue siendo válido en el contrato y este fixture es lo que lo prueba.
  // Sacarlo del schema rompería el build de cualquier repo que todavía lo
  // tenga en su `docs.config.json` — `lib/config.mjs` trata una clave
  // desconocida como error duro.
  secciones: { fueraDelEje: ['relacion'] },
  metadata: { modules: true },
  deploy: {
    proyectos: {
      prj_TKfHZIDS1PZoy85bduKO89gugXBb: 'publico',
      prj_ig447DB9ZQXbfhCWjXg9JCUYHQzy: 'interno',
    },
    guardDeFuga: { activo: true },
  },
};

const ODUMBO = {
  schemaVersion: 1,
  eje: { tipo: 'none' },
  audiences: ['publico', 'interno'],
  metadata: { modules: false },
  deploy: {
    proyectos: { prj_uwm1uHEaZPf6K7EkvbVD6VTqzUxI: 'publico' },
    guardDeFuga: { activo: true },
  },
};

const ADHOC = {
  schemaVersion: 1,
  eje: {
    tipo: 'project',
    valores: [
      {
        id: 'adhoc-way',
        label: 'Adhoc Way',
        fuente: { repo: 'ingadhoc/adhoc-way', path: 'docs', ref: 'main' },
      },
      { id: 'oba', label: 'Odoo by Adhoc', fuente: { repo: 'ingadhoc/oba-project', path: 'docs', ref: 'main' } },
      {
        id: 'odumbo',
        label: 'Odumbo',
        fuente: {
          repo: 'ingadhoc/odumbo-project',
          path: 'docs',
          ref: 'main',
          exclude: ['evals/**', 'prompts/**', 'knowledge/**'],
        },
      },
      {
        id: 'consultoria-tecnica',
        label: 'Consultoría Técnica',
        activo: false,
        motivo: 'Nombra clientes. Su dueño decide si publica y con qué exclusiones.',
        fuente: { repo: 'ingadhoc/consultoria-tecnica-project', path: 'docs', ref: 'main' },
      },
    ],
  },
  audiences: ['interno'],
  metadata: {
    types: ['concepto', 'referencia', 'procedimiento', 'troubleshooting', 'guia', 'indice'],
  },
  deploy: {
    guardDeFuga: {
      activo: false,
      motivo:
        'PENDIENTE DE FIRMA (jjs) — este repo no tiene build público: su gate es incondicional ' +
        'y el guard de fuga protege contra la fuga de bloques internos AL build público.',
    },
  },
};

const clonar = (o) => JSON.parse(JSON.stringify(o));

describe('los tres corpus validan (si alguno no, la unificación es falsa)', () => {
  for (const [nombre, config] of [
    ['oba-docs — eje version', OBA],
    ['odumbo-docs — eje none', ODUMBO],
    ['adhoc-docs — eje project', ADHOC],
  ]) {
    it(nombre, () => {
      const { ok, errores } = validarConfig(config);
      assert.deepEqual(errores, []);
      assert.equal(ok, true);
    });
  }
});

describe('los ocho inválidos a propósito, y el campo que nombran', () => {
  /** Cada caso: qué se rompe, y qué tiene que decir el mensaje. */
  const casos = [
    [
      'sin schemaVersion',
      () => {
        const c = clonar(OBA);
        delete c.schemaVersion;
        return c;
      },
      /schemaVersion: falta o no es un entero/,
    ],
    [
      '`version` sin default (el build no sabría qué versión va a site/docs)',
      () => {
        const c = clonar(OBA);
        delete c.eje.default;
        return c;
      },
      /eje\.default: falta el campo obligatorio/,
    ],
    [
      '`none` con valores (sin eje no hay valores que declarar)',
      () => {
        const c = clonar(ODUMBO);
        c.eje.valores = [{ id: '19' }];
        return c;
      },
      /eje: no puede declarar `valores`/,
    ],
    [
      '`activo: false` sin motivo (un valor apagado sin explicación es un olvido)',
      () => {
        const c = clonar(ADHOC);
        delete c.eje.valores[3].motivo;
        return c;
      },
      /eje\.valores\[3\]\.motivo: falta el campo obligatorio/,
    ],
    [
      'guard de fuga apagado sin motivo (la omisión silenciosa deja de ser posible)',
      () => {
        const c = clonar(ADHOC);
        delete c.deploy.guardDeFuga.motivo;
        return c;
      },
      /deploy\.guardDeFuga\.motivo: falta el campo obligatorio/,
    ],
    [
      'clave desconocida (ahí empezó el fork)',
      () => {
        const c = clonar(OBA);
        c.versionedSections = ['manual', 'guias'];
        return c;
      },
      /versionedSections: clave desconocida/,
    ],
    [
      'id de eje reservado (choca con una ruta del sitio)',
      () => {
        const c = clonar(ADHOC);
        c.eje.valores[0].id = 'api';
        return c;
      },
      /eje\.valores\[0\]\.id: el valor "api" está reservado/,
    ],
    [
      '`version` con fuente (el eje versión no trae contenido de otro repo)',
      () => {
        const c = clonar(OBA);
        c.eje.valores[0].fuente = { repo: 'ingadhoc/oba-docs', path: 'docs', ref: 'main' };
        return c;
      },
      /eje\.valores\[0\]: no puede declarar `fuente`/,
    ],
  ];

  for (const [nombre, romper, esperado] of casos) {
    it(nombre, () => {
      const { ok, errores } = validarConfig(romper());
      assert.equal(ok, false, `esperaba rechazo y validó: ${nombre}`);
      assert.ok(
        errores.some((e) => esperado.test(e)),
        `ningún error matchea ${esperado}. Hubo:\n${errores.join('\n')}`,
      );
    });
  }
});

describe('la regla del lector: schemaVersion', () => {
  it('un emisor más nuevo se rechaza y dice qué actualizar', () => {
    const c = clonar(OBA);
    c.schemaVersion = CONFIG_SOPORTADO + 1;
    const { ok, errores } = validarConfig(c);
    assert.equal(ok, false);
    assert.match(errores[0], /actualizá @ingadhoc\/docs-platform/);
  });

  it('con un schemaVersion que no sabemos leer no se reporta nada más', () => {
    // Los campos que vendrían después son de un contrato que no conocemos:
    // listar "errores" sobre ellos sería ruido inventado.
    const { errores } = validarConfig({ schemaVersion: 99, cualquierCosa: true });
    assert.equal(errores.length, 1);
  });
});

describe('coherencia entre campos (lo que un JSON Schema no puede expresar)', () => {
  it('un proyecto de Vercel mapeado a una audiencia que el repo no declara', () => {
    const c = clonar(OBA);
    c.deploy.proyectos.prj_TKfHZIDS1PZoy85bduKO89gugXBb = 'semipublico';
    const { errores } = validarConfig(c);
    assert.ok(errores.some((e) => /no está en `audiences`/.test(e)), errores.join('\n'));
  });

  it('`eje.default` que no es ningún valor del eje', () => {
    const c = clonar(OBA);
    c.eje.default = '20';
    const { errores } = validarConfig(c);
    assert.ok(errores.some((e) => /eje\.default: "20" no es el id/.test(e)), errores.join('\n'));
  });

  it('ids del eje repetidos', () => {
    const c = clonar(OBA);
    c.eje.valores[1].id = '19';
    const { errores } = validarConfig(c);
    assert.ok(errores.some((e) => /ids repetidos \(19\)/.test(e)), errores.join('\n'));
  });
});

describe('cargarConfig', () => {
  function conArchivo(contenido) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
    if (contenido !== null) fs.writeFileSync(path.join(tmp, 'docs.config.json'), contenido);
    return tmp;
  }

  it('lee y valida el archivo del repo', () => {
    const cwd = conArchivo(JSON.stringify(OBA));
    const cfg = cargarConfig({ cwd });
    assert.equal(cfg.eje.tipo, 'version');
    assert.equal(cfg.deploy.guardDeFuga.activo, true);
  });

  it('archivo ausente: falla con el nombre del archivo', () => {
    assert.throws(() => cargarConfig({ cwd: conArchivo(null) }), /no se pudo leer docs\.config\.json/);
  });

  it('JSON roto: falla diciendo que es JSON roto, no "falta un campo"', () => {
    assert.throws(() => cargarConfig({ cwd: conArchivo('{ "eje": ') }), /no es JSON válido/);
  });

  it('config inválido: TIRA con TODOS los errores juntos, no con el primero', () => {
    const c = clonar(OBA);
    delete c.eje.default;
    c.audiences = [];
    try {
      cargarConfig({ cwd: conArchivo(JSON.stringify(c)) });
      assert.fail('esperaba que tirara');
    } catch (error) {
      assert.match(error.message, /eje\.default/);
      assert.match(error.message, /audiences/);
    }
  });
});
