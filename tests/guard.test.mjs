/**
 * Suite del guard de fuga. `node --test guard.test.mjs`
 *
 * Cada caso arma un repo COMPLETO de mentira en un temporal (docs.config.json,
 * site/generated.json, .guard/removido.json, la salida del build y el índice
 * del MCP) y corre `guard-fuga.mjs` de verdad con `cwd` ahí. No hace falta el
 * preprocesador: el contrato entre build y guard es el manifiesto, y acá se
 * escribe a mano — que es justamente lo que permite testear los modos de falla
 * (manifiesto ausente, sondas vacías, audiencia cruzada) sin fabricar corpus.
 *
 * Antes esto no existía: el guard sólo se ejercitaba de rebote desde
 * `test-bloques.mjs`, y únicamente en el camino feliz y el falso positivo.
 *
 * Portable: `DOCS_GUARD_PATH` (default: al lado del test).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const GUARD = process.env.DOCS_GUARD_PATH
  ? path.resolve(process.cwd(), process.env.DOCS_GUARD_PATH)
  : fileURLToPath(new URL('../bin/guard-fuga.mjs', import.meta.url));

const PRJ_PUB = 'prj_publico';
const PRJ_INT = 'prj_interno';

// El contrato unificado (schema/docs.config.schema.json): el guard lo lee
// VALIDADO, así que el fixture es un config completo y no dos claves sueltas.
const CFG_BASE = {
  schemaVersion: 1,
  eje: { tipo: 'none' },
  audiences: ['publico', 'interno'],
  deploy: {
    proyectos: { [PRJ_PUB]: 'publico', [PRJ_INT]: 'interno' },
    guardDeFuga: { activo: true },
  },
};

// Una sonda es un trigrama de palabras contiguas que el preprocesador borró y
// que NO aparece en el texto publicado.
const SONDA = 'dias corridos si';
const MANIFIESTO_OK = { audiencia: 'publico', target: 'docusaurus', bloques: 3, sondas: [SONDA] };

function escribir(base, archivos) {
  for (const [rel, txt] of Object.entries(archivos)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, txt);
  }
}

/**
 * Arma el repo de mentira y corre el guard.
 * `generated`/`manifiesto` en `null` = el archivo NO existe.
 */
function correr({
  cfg = CFG_BASE,
  generated = { audiencia: 'publico' },
  manifiesto = MANIFIESTO_OK,
  archivos = { 'site/build/index.html': '<p>publico y sano</p>' },
  indiceAgente = '{"articulos":[]}',
  args = ['--esperada=publico'],
  env = {},
} = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
  const todo = { ...archivos };
  if (cfg !== null) todo['docs.config.json'] = JSON.stringify(cfg, null, 2);
  if (generated !== null) todo['site/generated.json'] = JSON.stringify(generated);
  if (manifiesto !== null) todo['.guard/removido.json'] = JSON.stringify(manifiesto);
  if (indiceAgente !== null) todo['api/_generated/index.json'] = indiceAgente;
  escribir(tmp, todo);

  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: tmp,
    encoding: 'utf8',
    // El entorno se limpia de las variables de Vercel del proceso que corre los
    // tests: si el CI las tuviera, cambiarían la rama que se está probando.
    env: { ...process.env, VERCEL: '', VERCEL_PROJECT_ID: '', ...env },
  });
  return { code: r.status, salida: `${r.stdout}${r.stderr}`, tmp };
}

const bloqueado = (r, frase) => {
  assert.equal(r.code, 1, `esperaba deploy BLOQUEADO.\n${r.salida}`);
  if (frase) assert.match(r.salida, frase);
};
const aprobado = (r) => assert.equal(r.code, 0, `esperaba deploy APROBADO.\n${r.salida}`);

describe('de qué audiencia es este build (la fuente independiente)', () => {
  it('fuera de Vercel sin --esperada → bloquea', () => {
    bloqueado(correr({ args: [] }), /fuera de Vercel/);
  });

  it('en Vercel, proyecto no mapeado → bloquea (no adivina la audiencia)', () => {
    bloqueado(
      correr({ env: { VERCEL: '1', VERCEL_PROJECT_ID: 'prj_recien_creado' }, args: [] }),
      /no está en docs\.config\.json → deploy\.proyectos/,
    );
  });

  it('en Vercel sin VERCEL_PROJECT_ID → bloquea', () => {
    bloqueado(correr({ env: { VERCEL: '1' }, args: [] }), /VERCEL_PROJECT_ID="\(vacío\)"/);
  });

  it('en Vercel, --esperada NO puede sobreescribir el mapa', () => {
    // ESTRICTEZ+ (c): antes se ignoraba en silencio. Neutralizar la fuente
    // independiente desde el buildCommand de las settings no puede ser barato.
    bloqueado(
      correr({ env: { VERCEL: '1', VERCEL_PROJECT_ID: PRJ_INT }, args: ['--esperada=interno'] }),
      /--esperada no se acepta corriendo en Vercel/,
    );
  });

  it('audiencia esperada que no está en el contrato → bloquea', () => {
    bloqueado(correr({ args: ['--esperada=semipublico'] }), /audiencia esperada inválida/);
  });

  it('docs.config.json que no cumple el contrato → bloquea nombrando el campo', () => {
    // Antes `CFG.audiences.includes()` tiraba TypeError. Ahora el config entra
    // validado contra el schema y cada campo faltante tiene su línea.
    const r = correr({ cfg: { schemaVersion: 1, eje: { tipo: 'none' } } });
    bloqueado(r, /audiences: falta el campo obligatorio/);
    assert.match(r.salida, /deploy: falta el campo obligatorio/);
  });

  it('docs.config.json pre-unificación (sin schemaVersion) → bloquea', () => {
    bloqueado(
      correr({ cfg: { audiences: ['publico'], proyectos: {} } }),
      /schemaVersion: falta o no es un entero/,
    );
  });

  it('el guard declarado inactivo con motivo NO bloquea, y el motivo queda en el log', () => {
    // El opt-out de la Fase 0 punto 4: o el guard corre, o su ausencia está
    // escrita. Lo que ya no puede ser es silenciosa.
    const r = correr({
      cfg: {
        ...CFG_BASE,
        deploy: {
          ...CFG_BASE.deploy,
          guardDeFuga: { activo: false, motivo: 'Este repo no tiene build público: su gate es incondicional.' },
        },
      },
      archivos: { 'site/build/x.html': `<p>a los 30 ${SONDA} nadie reclama</p>` },
    });
    aprobado(r);
    assert.match(r.salida, /DECLARADO INACTIVO/);
    assert.match(r.salida, /no tiene build público/);
  });

  it('docs.config.json ausente → bloquea', () => {
    bloqueado(correr({ cfg: null }), /no se pudo leer docs.config.json/);
  });

  it('AUDIENCIA CRUZADA: el proyecto público recibió el build interno → bloquea', () => {
    bloqueado(
      correr({ env: { VERCEL: '1', VERCEL_PROJECT_ID: PRJ_PUB }, args: [], generated: { audiencia: 'interno' } }),
      /AUDIENCIA CRUZADA/,
    );
  });

  it('DOCS_AUDIENCE mentirosa NO alcanza para aprobar (la tautología vieja)', () => {
    // El agujero original: comparar $DOCS_AUDIENCE contra generated.json, que
    // el preprocesador escribe DESDE $DOCS_AUDIENCE. Acá la env var dice
    // "publico" y el guard igual reconoce que el proyecto es el interno y que
    // el build es interno: no escanea porque no hace falta, y no se confunde.
    const r = correr({
      env: { VERCEL: '1', VERCEL_PROJECT_ID: PRJ_INT, DOCS_AUDIENCE: 'publico' },
      args: [],
      generated: { audiencia: 'interno' },
      manifiesto: null,
    });
    aprobado(r);
    assert.match(r.salida, /build "interno": no se escanea/);
  });

  it('sin site/generated.json → bloquea (el preprocesador no corrió)', () => {
    bloqueado(correr({ generated: null }), /no existe site\/generated.json/);
  });

  it('el build interno no se escanea, aunque tenga la sonda adentro', () => {
    // Este artefacto SÍ debe contener lo interno: tiene el gate adelante.
    aprobado(correr({
      args: ['--esperada=interno'],
      generated: { audiencia: 'interno' },
      manifiesto: null,
      archivos: { 'site/build/index.html': `<p>los ${SONDA} nadie reclama</p>` },
    }));
  });
});

describe('el tercer contrato (generated.json / removido.json)', () => {
  it('`audience` (la clave vieja) se sigue aceptando durante la migración', () => {
    // `site/generated.json` y `.guard/removido.json` los emite el build de cada
    // repo y todavía no están unificados: el paso 1 de la migración es emitir
    // las dos claves (contrato-indice.md §5). El índice, en cambio, ya sólo lee
    // `audiencia`.
    aprobado(correr({
      generated: { audience: 'publico' },
      manifiesto: { target: 'docusaurus', bloques: 3, sondas: [SONDA], audience: 'publico' },
    }));
  });
});

describe('el manifiesto es el contrato con el preprocesador', () => {
  it('manifiesto ausente → bloquea ("no pude verificar" es falla)', () => {
    bloqueado(correr({ manifiesto: null }), /falta \.guard\/removido\.json/);
  });

  it('manifiesto de otro build → bloquea', () => {
    bloqueado(correr({ manifiesto: { ...MANIFIESTO_OK, audiencia: 'interno' } }), /el manifiesto es del build "interno"/);
  });

  it('hay contenido interno pero NINGUNA sonda discriminante → bloquea', () => {
    bloqueado(
      correr({ manifiesto: { ...MANIFIESTO_OK, bloques: 12, sondas: [] } }),
      /NINGUNA sonda discriminante/,
    );
  });

  it('sin contenido interno en el fuente → aprueba y lo dice', () => {
    const r = correr({ manifiesto: { audiencia: 'publico', target: 'docusaurus', bloques: 0, sondas: [] } });
    aprobado(r);
    assert.match(r.salida, /no tiene contenido interno/);
  });

  it('falta el índice del MCP con target docusaurus → bloquea', () => {
    bloqueado(correr({ indiceAgente: null }), /falta api\/_generated\/index\.json/);
  });
});

describe('escaneo del output', () => {
  it('la sonda en el HTML público → FUGA', () => {
    bloqueado(
      correr({ archivos: { 'site/build/x.html': `<p>a los 30 ${SONDA} nadie reclama</p>` } }),
      /FUGA/,
    );
  });

  it('la sonda partida por tags HTML → FUGA (los tags se quitan antes)', () => {
    bloqueado(
      correr({ archivos: { 'site/build/x.html': '<p>dias <strong>corridos</strong> si nadie</p>' } }),
      /FUGA/,
    );
  });

  it('la sonda en un JSON con escapes → FUGA (el fix de decodificarJson)', () => {
    // Sin decodificar, `\ndias corridos si` se normaliza a `ndias corridos si`
    // y la sonda era invisible justo en el artefacto más caro: el índice.
    bloqueado(
      correr({
        archivos: {
          'site/build/index.html': '<p>ok</p>',
          'site/build/search-index.json': JSON.stringify([{ body: `texto\n${SONDA} nadie reclama` }]),
        },
      }),
      /FUGA/,
    );
  });

  it('un JSON roto no ciega al guard (fallback que sobre-matchea)', () => {
    bloqueado(
      correr({
        archivos: {
          'site/build/index.html': '<p>ok</p>',
          'site/build/roto.json': `{ esto no es json valido: "${SONDA} nadie" `,
        },
      }),
      /FUGA/,
    );
  });

  it('la sonda en api/_generated (fuera de la salida del sitio) → FUGA', () => {
    // El índice que sirve la función MCP no está en site/build y hay que
    // sumarlo al escaneo a mano: es el artefacto con el cuerpo entero.
    bloqueado(
      correr({ indiceAgente: JSON.stringify({ articulos: [{ cuerpo: `${SONDA} nadie reclama` }] }) }),
      /FUGA/,
    );
  });

  it('sondas con acentos: los límites de palabra no son \\b (ASCII)', () => {
    const acentuada = 'límite diario según';
    bloqueado(
      correr({
        manifiesto: { ...MANIFIESTO_OK, sondas: [acentuada] },
        archivos: { 'site/build/x.html': `<p>el ${acentuada} el contrato</p>` },
      }),
      /FUGA/,
    );
  });

  it('la salida vacía → bloquea (¿corrió el build?)', () => {
    bloqueado(correr({ archivos: {} }), /no hay artefactos/);
  });

  it('el .guard dentro de la salida → bloquea', () => {
    bloqueado(
      correr({ archivos: { 'site/build/index.html': '<p>ok</p>', 'site/build/.guard/removido.json': '{}' } }),
      /el directorio \.guard quedó dentro de la salida/,
    );
  });

  it('el .guard dentro de la salida se detecta incluso sin sondas', () => {
    // ESTRICTEZ+ (d): antes este chequeo vivía dentro de `if (sondas.length)`.
    bloqueado(
      correr({
        manifiesto: { audiencia: 'publico', target: 'docusaurus', bloques: 0, sondas: [] },
        archivos: { 'site/build/index.html': '<p>ok</p>', 'site/build/.guard/removido.json': '{}' },
      }),
      /el directorio \.guard quedó dentro de la salida/,
    );
  });

  it('--salida y --extra a medida (el guard no asume el layout de un repo)', () => {
    bloqueado(
      correr({
        args: ['--esperada=publico', '--salida=dist/publico', '--extra=funcion/_gen', '--indice=funcion/_gen/index.json'],
        archivos: {
          'site/build/index.html': '<p>esta salida NO se mira</p>',
          'dist/publico/index.html': '<p>ok</p>',
          'funcion/_gen/index.json': JSON.stringify({ x: `${SONDA} nadie` }),
        },
        indiceAgente: null,
      }),
      /FUGA/,
    );
  });
});

describe('falsos positivos: cada uno bloqueó (o habría bloqueado) un deploy real', () => {
  it('el vocabulario del bundle de React no dispara (las sondas son trigramas)', () => {
    aprobado(correr({
      archivos: {
        'site/build/index.html': '<p>ok</p>',
        'site/build/assets/main.js': 'var d={database:1,responder:2,timeout:3,internals:4};function responder(){}\n',
      },
    }));
  });

  it('un trigrama público que CONTIENE al interno como substring no dispara', () => {
    // "dias corridos si" (interno) dentro de "dias corridos sin rechazo"
    // (público): sin límites de palabra, esto bloqueaba el deploy.
    aprobado(correr({
      archivos: { 'site/build/x.html': `<p>a los 30 ${SONDA}n rechazo</p>` },
    }));
  });

  it('un backslash literal no ciega el escaneo del resto del archivo', () => {
    // El anti-patrón: reemplazar escapes con regex sobre el texto crudo borra
    // la letra que sigue a un backslash LITERAL (`C:\temp` → `c emp`).
    bloqueado(
      correr({
        archivos: {
          'site/build/index.html': '<p>ok</p>',
          'site/build/d.json': JSON.stringify({ ruta: 'C:\\temp', txt: `${SONDA} nadie` }),
        },
      }),
      /FUGA/,
    );
  });
});
