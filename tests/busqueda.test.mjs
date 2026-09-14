/**
 * Tests de `lib/busqueda.cjs` — la configuración del buscador del sitio.
 *
 * Existen porque en v0.8.0 se borró `tests/indice-fuera-del-eje.test.mjs`, que
 * era lo único que importaba este módulo (usaba su `OPCIONES_DE_INDICE`), y sin
 * esto el archivo que unifica la config del buscador de los tres sitios se
 * quedaba sin una sola aserción.
 *
 * Lo que se fija acá es el contrato con el `docusaurus.config.js` del
 * consumidor: la llamada sin argumentos tiene que rendir la config completa
 * —ningún repo monta ya un segundo plugin de docs— y `searchContextByPaths`
 * NO tiene que aparecer nunca (ver el docstring del módulo: partir el índice
 * por contexto deja afuera del índice todo lo que no cae en ninguno).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { IDIOMAS, opcionesDelTema } = require('../lib/busqueda.cjs');

describe('opcionesDelTema', () => {
  it('sin argumentos rinde la config del sitio, con `/` como ruta base', () => {
    assert.deepEqual(opcionesDelTema(), {
      hashed: true,
      language: ['es', 'en'],
      indexDocs: true,
      indexBlog: false,
      docsRouteBasePath: ['/'],
      highlightSearchTermsOnTargetPage: true,
    });
    // El objeto vacío es la otra forma de pedir el default.
    assert.deepEqual(opcionesDelTema({}), opcionesDelTema());
  });

  it('nunca declara `searchContextByPaths`: es la decisión, no un olvido', () => {
    assert.equal('searchContextByPaths' in opcionesDelTema(), false);
  });

  it('el corpus que monte un segundo plugin de docs puede nombrar su ruta', () => {
    assert.deepEqual(opcionesDelTema({ docsRouteBasePath: ['/', 'otra'] }).docsRouteBasePath, [
      '/',
      'otra',
    ]);
  });

  it('no devuelve los arrays del módulo: el consumidor no puede mutarlos', () => {
    const o = opcionesDelTema();
    o.language.push('fr');
    o.docsRouteBasePath.push('/x');
    assert.deepEqual(IDIOMAS, ['es', 'en']);
    assert.deepEqual(opcionesDelTema().docsRouteBasePath, ['/']);
  });

  it('una lista vacía o basura tira, en vez de emitir un sitio sin índice', () => {
    assert.throws(() => opcionesDelTema({ docsRouteBasePath: [] }), /no vacía/);
    assert.throws(() => opcionesDelTema({ docsRouteBasePath: '/' }), /no vacía/);
  });

  it('el fuzzy NO se declara: el default del tema (1) es el que queremos', () => {
    // Se probó apagarlo contra el índice publicado: idéntico en 12 consultas
    // bien escritas, y cero resultados en 5 de 6 con un tipeo. Declarar la
    // clave en 0 es la regresión; el detalle está en el docstring del módulo.
    assert.equal('fuzzyMatchingDistance' in opcionesDelTema(), false);
  });

  // ── contextos por doc set ────────────────────────────────────────────────
  //
  // Lo que se protege acá es la ADITIVIDAD y la semántica del reparto. Los
  // contextos estuvieron prohibidos en esta función con evidencia de
  // producción, y vuelven sólo para el doc set: si alguien los reintroduce
  // para el eje, estos casos no lo frenan — el que frena es el de cobertura,
  // que vive en el consumidor porque necesita el build entero.

  it('sin contextos, la config es EXACTAMENTE la de antes', () => {
    const o = opcionesDelTema();
    assert.equal('searchContextByPaths' in o, false);
    assert.equal('hideSearchBarWithNoSearchContext' in o, false);
    assert.equal('useAllContextsWithNoSearchContext' in o, false);
  });

  it('con contextos, el doc set no default gana índice propio', () => {
    const o = opcionesDelTema({ contextos: ['novedades'] });
    assert.deepEqual(o.searchContextByPaths, ['novedades']);
  });

  it('el índice raíz se sigue emitiendo: es el del doc set default', () => {
    // con `hideSearchBarWithNoSearchContext: true` el plugin no lo crea y el
    // doc set default se queda sin buscador.
    assert.equal(opcionesDelTema({ contextos: ['novedades'] }).hideSearchBarWithNoSearchContext, false);
  });

  it('un documento que cayó en un contexto NO vuelve al índice raíz', () => {
    // es lo que hace que, parado en el manual, no aparezcan las novedades.
    assert.equal(opcionesDelTema({ contextos: ['novedades'] }).useAllContextsWithNoSearchContext, false);
  });

  it('no devuelve el array del consumidor: no se puede mutar por referencia', () => {
    const ctx = ['novedades'];
    const o = opcionesDelTema({ contextos: ctx });
    o.searchContextByPaths.push('otro');
    assert.deepEqual(ctx, ['novedades']);
  });

  it('basura en `contextos` tira, en vez de emitir un scope silenciosamente roto', () => {
    assert.throws(() => opcionesDelTema({ contextos: 'novedades' }), /lista de rutas/);
  });
});
