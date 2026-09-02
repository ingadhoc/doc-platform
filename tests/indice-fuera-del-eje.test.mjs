/**
 * Suite del post-proceso del índice. `node --test indice-fuera-del-eje.test.mjs`
 *
 * Cada caso arma un repo de mentira en un temporal: el contrato, la salida del
 * build con un índice por versión, y un `node_modules` con el plugin del
 * buscador FALSO. El plugin falso no es una comodidad — este paquete no declara
 * `@easyops-cn/docusaurus-search-local` como dependencia a propósito (lo tiene
 * el repo de contenido), así que el módulo lo resuelve desde el consumidor y
 * eso es justo lo que hay que ejercitar: un test que inyectara el motor por
 * parámetro no probaría la resolución, que es donde esto se rompe cuando un
 * repo cambia dónde instala el sitio.
 *
 * El `buildIndex` falso devuelve un índice VIVO y consultable, como el real —
 * `buildIndex()` entrega un `lunr.Index` recién construido, no el JSON—, así
 * los dos controles del módulo (no perder documentos, y que el índice
 * reconstruido efectivamente busque) se ejercitan de verdad y se puede escribir
 * el caso en el que fallan.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const BIN = fileURLToPath(new URL('../bin/indice-fuera-del-eje.mjs', import.meta.url));

const CFG_BASE = {
  schemaVersion: 1,
  eje: {
    tipo: 'version',
    default: '19',
    valores: [{ id: '19', label: '19.0' }, { id: '18', label: '18.0' }],
  },
  audiences: ['publico'],
  secciones: { fueraDelEje: ['relacion'] },
  deploy: { proyectos: { prj_pub: 'publico' }, guardDeFuga: { activo: true } },
};

/** Un documento de título tal como lo emite el plugin. */
const titulo = (i, t, u) => ({ i, t, u, b: [] });
/** Un documento de contenido (lleva `s` = título de la página y `p` = padre). */
const contenido = (i, t, u, p) => ({ i, t, u, s: 'x', p });

/**
 * Los cinco cuerpos del índice: títulos, headings, descripciones, keywords,
 * contenido. Sólo se llenan los que el caso necesita.
 */
function indice({ titulos = [], contenidos = [] }) {
  return [
    { documents: titulos, index: { terms: titulos.map((d) => d.t) } },
    { documents: [], index: { terms: [] } },
    { documents: [], index: { terms: [] } },
    { documents: [], index: { terms: [] } },
    { documents: contenidos, index: { terms: contenidos.map((d) => d.t) } },
  ];
}

/**
 * El plugin falso. Determinista: los mismos documentos producen el mismo JSON,
 * que es lo que el Control 1 del módulo compara contra el archivo en disco.
 * Además deja en `opciones-recibidas.json` el segundo argumento con el que lo
 * llamaron — sin eso, se podría borrar `language` de `OPCIONES_DE_INDICE` y la
 * suite seguiría verde.
 *
 * `variante`:
 *  - 'normal'
 *  - 'pierde-los-sumados': descarta los documentos fuera del eje. Reconstruye
 *    fiel lo preexistente (pasa el Control 1) y falla el Control 3, el de
 *    conteo.
 *  - 'pipeline-distinto': arma un índice con otra forma, como si el sitio y la
 *    plataforma configuraran el buscador distinto. Dispara el Control 1.
 */
function escribirPluginFalso(dirSitio, variante = 'normal') {
  const dir = path.join(dirSitio, 'node_modules', '@easyops-cn', 'docusaurus-search-local');
  const utils = path.join(dir, 'dist', 'server', 'server', 'utils');
  fs.mkdirSync(utils, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@easyops-cn/docusaurus-search-local', version: '0.0.0-fake', main: 'index.js' }),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(
    path.join(utils, 'buildIndex.js'),
    `const fs = require('fs');
const path = require('path');
const variante = ${JSON.stringify(variante)};
exports.buildIndex = (allDocuments, opciones) => {
  fs.writeFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'opciones-recibidas.json'),
    JSON.stringify(opciones),
  );
  return allDocuments.map((documents) => {
    const docs =
      variante === 'pierde-los-sumados'
        ? documents.filter((d) => !String(d.u).startsWith('/relacion'))
        : documents;
    const terms = docs.map((d) => d.t);
    return {
      documents: docs,
      // Vivo, como el lunr.Index que devuelve el buildIndex real; se serializa
      // con toJSON al escribirlo.
      index: {
        search: (q) => (terms.some((t) => t.toLowerCase().includes(q.toLowerCase())) ? [{}] : []),
        toJSON: () => (variante === 'pipeline-distinto' ? { terms, stemmer: 'otro' } : { terms }),
      },
    };
  });
};
`,
  );
}

/**
 * Repo de mentira completo. Devuelve su ruta.
 * `indices`: mapa de directorio → índice ('' es la raíz de la salida).
 */
function armarRepo({ config = CFG_BASE, indices, variante = 'normal', conPlugin = true } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-fuera-del-eje-'));
  fs.writeFileSync(path.join(raiz, 'docs.config.json'), JSON.stringify(config, null, 2));
  fs.mkdirSync(path.join(raiz, 'site'), { recursive: true });
  fs.writeFileSync(
    path.join(raiz, 'site', 'package.json'),
    JSON.stringify({ name: 'sitio-de-mentira', version: '0.0.0' }),
  );
  if (conPlugin) escribirPluginFalso(path.join(raiz, 'site'), variante);
  for (const [dir, valor] of Object.entries(indices)) {
    const destino = path.join(raiz, 'site', 'build', dir);
    fs.mkdirSync(destino, { recursive: true });
    for (const [nombre, contenidoDelIndice] of Object.entries(valor)) {
      fs.writeFileSync(path.join(destino, nombre), JSON.stringify(contenidoDelIndice));
    }
  }
  return raiz;
}

function correr(raiz, args = []) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: raiz, encoding: 'utf8' });
  return { code: r.status, salida: `${r.stdout}${r.stderr}` };
}

const leer = (raiz, ...partes) =>
  JSON.parse(fs.readFileSync(path.join(raiz, 'site', 'build', ...partes), 'utf8'));

const opcionesRecibidas = (raiz) =>
  JSON.parse(fs.readFileSync(path.join(raiz, 'site', 'node_modules', 'opciones-recibidas.json'), 'utf8'));

/** El caso de siempre: la 19 es la última (raíz) y la 18 vive en su subdir. */
const INDICES_TIPICOS = {
  '': {
    'search-index.json': indice({
      titulos: [
        titulo(1, 'Facturas de cliente', '/19/manual/facturas'),
        titulo(2, 'Seguridad de la Nube Adhoc', '/relacion/como-te-acompanamos/seguridad-de-la-nube'),
        titulo(3, 'Tu relación con Adhoc', '/relacion'),
      ],
      contenidos: [contenido(4, 'backups y monitoreo', '/relacion/como-te-acompanamos/seguridad-de-la-nube', 2)],
    }),
  },
  18: {
    'search-index.json': indice({
      titulos: [titulo(10, 'Facturas de cliente', '/18/manual/facturas')],
      contenidos: [contenido(11, 'emitir una factura', '/18/manual/facturas', 10)],
    }),
  },
};

describe('docs-indice-fuera-del-eje', () => {
  it('suma las páginas fuera del eje al índice de la versión vieja', () => {
    const raiz = armarRepo({ indices: INDICES_TIPICOS });
    const { code, salida } = correr(raiz);

    assert.equal(code, 0, salida);
    const dieciocho = leer(raiz, '18', 'search-index.json');
    const urls = dieciocho[0].documents.map((d) => d.u);
    assert.deepEqual(urls, [
      '/18/manual/facturas',
      '/relacion/como-te-acompanamos/seguridad-de-la-nube',
      '/relacion',
    ]);
    // El contenido (quinto cuerpo) también viaja: sin él la página aparece pero
    // no matchea por su texto, que es la mitad de las búsquedas reales.
    assert.deepEqual(
      dieciocho[4].documents.map((d) => d.t),
      ['emitir una factura', 'backups y monitoreo'],
    );
    assert.match(salida, /18: títulos \+2, contenido \+1/);
  });

  it('le pasa a buildIndex las opciones de índice de la plataforma', () => {
    const raiz = armarRepo({ indices: INDICES_TIPICOS });
    assert.equal(correr(raiz).code, 0);
    // Son las que tienen que coincidir con las del tema del sitio: si divergen,
    // el índice reconstruido busca distinto que el que emitió el build.
    assert.deepEqual(opcionesRecibidas(raiz), {
      language: ['es', 'en'],
      removeDefaultStopWordFilter: [],
      removeDefaultStemmer: false,
    });
  });

  it('toma la portada de la sección con barra final, como la emite el build', () => {
    const raiz = armarRepo({
      indices: {
        '': {
          'search-index.json': indice({
            titulos: [
              titulo(1, 'Facturas', '/19/manual/facturas'),
              titulo(2, 'Tu relación con Adhoc', '/relacion/'),
              // Vecina de nombre parecido: NO es la sección declarada.
              titulo(3, 'Otra cosa', '/relacion-comercial/algo'),
            ],
          }),
        },
        18: INDICES_TIPICOS[18],
      },
    });
    assert.equal(correr(raiz).code, 0);
    const urls = leer(raiz, '18', 'search-index.json')[0].documents.map((d) => d.u);
    assert.deepEqual(urls, ['/18/manual/facturas', '/relacion/']);
  });

  it('cubre todas las versiones viejas, no solo una', () => {
    const raiz = armarRepo({
      config: {
        ...CFG_BASE,
        eje: { tipo: 'version', default: '19', valores: [{ id: '19' }, { id: '18' }, { id: '17' }] },
      },
      indices: {
        '': INDICES_TIPICOS[''],
        18: INDICES_TIPICOS[18],
        17: {
          'search-index.json': indice({ titulos: [titulo(20, 'Facturas de cliente', '/17/manual/facturas')] }),
        },
      },
    });
    const { code, salida } = correr(raiz);
    assert.equal(code, 0, salida);
    for (const v of ['18', '17']) {
      const urls = leer(raiz, v, 'search-index.json')[0].documents.map((d) => d.u);
      assert.ok(urls.includes('/relacion/como-te-acompanamos/seguridad-de-la-nube'), `falta en la ${v}`);
    }
    assert.match(salida, /2 índice\(s\) actualizado\(s\)/);
  });

  it('respeta --salida y --site (el CI construye en otro directorio)', () => {
    const raiz = armarRepo({ indices: INDICES_TIPICOS });
    // El CI de oba-docs buildea a `dist/<audiencia>`, no a site/build.
    fs.renameSync(path.join(raiz, 'site', 'build'), path.join(raiz, 'dist-publico'));
    const { code, salida } = correr(raiz, ['--salida=dist-publico', '--site=site']);
    assert.equal(code, 0, salida);
    const urls = JSON.parse(
      fs.readFileSync(path.join(raiz, 'dist-publico', '18', 'search-index.json'), 'utf8'),
    )[0].documents.map((d) => d.u);
    assert.ok(urls.includes('/relacion/como-te-acompanamos/seguridad-de-la-nube'));
  });

  it('no toca el índice de la raíz (la versión última ya las tiene)', () => {
    const raiz = armarRepo({ indices: INDICES_TIPICOS });
    const antes = fs.readFileSync(path.join(raiz, 'site', 'build', 'search-index.json'), 'utf8');
    assert.equal(correr(raiz).code, 0);
    const despues = fs.readFileSync(path.join(raiz, 'site', 'build', 'search-index.json'), 'utf8');
    assert.equal(antes, despues);
  });

  it('es idempotente: la segunda corrida no duplica', () => {
    const raiz = armarRepo({ indices: INDICES_TIPICOS });
    assert.equal(correr(raiz).code, 0);
    const primera = leer(raiz, '18', 'search-index.json');
    const { code, salida } = correr(raiz);
    assert.equal(code, 0, salida);
    assert.deepEqual(leer(raiz, '18', 'search-index.json'), primera);
    assert.match(salida, /ya tenía las páginas fuera del eje/);
  });

  it('saltea un valor del eje declarado que todavía no tiene índice', () => {
    const raiz = armarRepo({ indices: { '': INDICES_TIPICOS[''] } });
    const { code, salida } = correr(raiz);
    assert.equal(code, 0, salida);
    assert.match(salida, /18: sin índice/);
  });

  describe('no-op sin ruido', () => {
    it('eje que no es `version`', () => {
      const raiz = armarRepo({
        config: { ...CFG_BASE, eje: { tipo: 'none' }, secciones: { fueraDelEje: ['relacion'] } },
        indices: INDICES_TIPICOS,
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 0, salida);
      assert.match(salida, /nada que hacer/);
    });

    it('corpus sin secciones fuera del eje', () => {
      const raiz = armarRepo({
        config: { ...CFG_BASE, secciones: { fueraDelEje: [] } },
        indices: INDICES_TIPICOS,
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 0, salida);
      assert.match(salida, /sin `secciones.fueraDelEje`/);
    });

    it('un solo valor de eje', () => {
      const raiz = armarRepo({
        config: { ...CFG_BASE, eje: { tipo: 'version', default: '19', valores: [{ id: '19' }] } },
        indices: { '': INDICES_TIPICOS[''] },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 0, salida);
      assert.match(salida, /un solo valor de eje/);
    });
  });

  describe('falla en vez de escribir un índice dudoso', () => {
    it('el índice de la raíz está partido por contexto', () => {
      const raiz = armarRepo({
        indices: {
          '': {
            'search-index.json': INDICES_TIPICOS['']['search-index.json'],
            'search-index-19.json': INDICES_TIPICOS['']['search-index.json'],
          },
          18: INDICES_TIPICOS[18],
        },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /searchContextByPaths/);
    });

    it('no hay índice en la raíz', () => {
      const raiz = armarRepo({ indices: { 18: INDICES_TIPICOS[18] } });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /DOCS_SEARCH=0|no hay ninguno/);
    });

    it('la sección fuera del eje dejó de emitirse', () => {
      const raiz = armarRepo({
        indices: {
          '': { 'search-index.json': indice({ titulos: [titulo(1, 'Facturas', '/19/manual/facturas')] }) },
          18: INDICES_TIPICOS[18],
        },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /NINGÚN documento/);
      // Y no tocó el índice de la 18: sumar cero en silencio es el bug a evitar.
      assert.equal(leer(raiz, '18', 'search-index.json')[0].documents.length, 1);
    });

    it('el formato del plugin cambió (otra cantidad de cuerpos)', () => {
      const raiz = armarRepo({
        indices: {
          '': INDICES_TIPICOS[''],
          18: { 'search-index.json': INDICES_TIPICOS[18]['search-index.json'].slice(0, 3) },
        },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /cuerpos/);
    });

    it('la fusión pierde documentos', () => {
      const raiz = armarRepo({ indices: INDICES_TIPICOS, variante: 'pierde-los-sumados' });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /esperaba/);
    });

    it('el pipeline del post-proceso no es el del build', () => {
      const raiz = armarRepo({ indices: INDICES_TIPICOS, variante: 'pipeline-distinto' });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /NO reproduce el archivo del build/);
      assert.match(salida, /opcionesDelTema/);
      // Y no tocó el índice: el control corre ANTES de escribir.
      assert.equal(leer(raiz, '18', 'search-index.json')[0].documents.length, 1);
    });

    it('los ids de la raíz colisionan con los de la versión', () => {
      const raiz = armarRepo({
        indices: {
          '': INDICES_TIPICOS[''],
          18: {
            // el id 2 es el de "Seguridad de la Nube Adhoc" en el índice de la raíz
            'search-index.json': indice({ titulos: [titulo(2, 'Facturas de cliente', '/18/manual/facturas')] }),
          },
        },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /id\(s\) del índice de la raíz chocan/);
      assert.match(salida, /página equivocada/);
    });

    it('JSON corrupto: lo dice con el nombre del archivo, sin stack', () => {
      const raiz = armarRepo({ indices: INDICES_TIPICOS });
      fs.writeFileSync(path.join(raiz, 'site', 'build', '18', 'search-index.json'), '{roto');
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /18\/search-index\.json no es JSON válido/);
      assert.doesNotMatch(salida, /at correrIndiceFueraDelEje|SyntaxError:/);
    });

    it('JSON válido con la forma equivocada', () => {
      const raiz = armarRepo({ indices: INDICES_TIPICOS });
      fs.writeFileSync(path.join(raiz, 'site', 'build', 'search-index.json'), '{}');
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /no tiene la forma de un índice del plugin/);
      assert.doesNotMatch(salida, /TypeError|not a function/);
    });

    it('varios índices dentro del directorio de una versión', () => {
      const raiz = armarRepo({
        indices: {
          '': INDICES_TIPICOS[''],
          18: {
            'search-index.json': INDICES_TIPICOS[18]['search-index.json'],
            'search-index-18.json': INDICES_TIPICOS[18]['search-index.json'],
          },
        },
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /esperaba UN índice en site\/build\/18\//);
    });

    it('una de las dos secciones fuera del eje no se emitió', () => {
      const raiz = armarRepo({
        config: { ...CFG_BASE, secciones: { fueraDelEje: ['relacion', 'academia'] } },
        indices: INDICES_TIPICOS,
      });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      // El chequeo es POR SECCIÓN: con `relacion` presente, un chequeo sobre el
      // total pasaría en verde y `academia` quedaría invisible en toda versión.
      assert.match(salida, /NINGÚN documento de `\/academia`/);
      assert.match(salida, /docsRouteBasePath/);
    });

    it('el plugin del buscador no está instalado en el consumidor', () => {
      const raiz = armarRepo({ indices: INDICES_TIPICOS, conPlugin: false });
      const { code, salida } = correr(raiz);
      assert.equal(code, 1);
      assert.match(salida, /docusaurus-search-local/);
    });
  });
});
