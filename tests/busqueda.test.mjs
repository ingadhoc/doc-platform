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
});
