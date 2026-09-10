/**
 * Suite de los doc sets. `node --test tests/doc-sets.test.mjs`.
 *
 * POR QUÉ UNA SUITE PROPIA. El doc set es un HÍBRIDO y esa es toda la
 * dificultad: se DECLARA como faceta —opcional, en `metadata`, encendida por lo
 * que mide el índice— pero se COMPORTA como el eje —un valor por artículo, sin
 * comodín—. Las dos mitades se pierden en refactors distintos, así que se
 * protegen juntas y acá.
 *
 * LA ASIMETRÍA, AL REVÉS QUE `paises`. En `paises` la ausencia significa
 * "todos": una página universal sale bajo cualquier país. Acá NO: todo artículo
 * pertenece a exactamente un doc set, así que la ausencia del campo no es un
 * comodín, es un artículo que el build no clasificó. Copiar el comodín de
 * `paises` a este filtro haría que las novedades de versión aparezcan en toda
 * búsqueda del manual — que es exactamente lo que la feature vino a evitar.
 *
 * EL INVARIANTE DEL SLUG. Un doc set agrupa secciones y la sección es el primer
 * segmento del slug, así que dos doc sets no pueden compartir uno. Eso es lo que
 * permite que el `id` siga siendo `${eje}::${slug}` y que `leer()` conserve UNA
 * regla. Si se rompiera, MiniSearch pisaría un documento con otro en silencio:
 * por eso el índice tira al construirse y hay un caso acá que lo prueba.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, leer, mapa, politicaDeEje } = await import('../lib/mcp/indice.mjs');

function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const slugs = (r) => r.resultados.map((h) => h.slug).sort();

// ════════════════════════════════════════════════ la política, sin el motor

describe('politicaDeEje — el doc set entra como faceta, nunca como eje', () => {
  const conDocSets = {
    eje: { tipo: 'version', default: '19' },
    metadata: { docSets: [{ id: 'manual', label: 'Manual de usuario' }, { id: 'novedades', label: 'Novedades de versión' }] },
  };

  it('el vocabulario del índice enciende el filtro y el campo', () => {
    const p = politicaDeEje(conDocSets);
    assert.equal(p.filtrosDominio.includes('docSet'), true);
    assert.equal(p.camposDominio.includes('docSet'), true);
    assert.deepEqual(p.docSetsDeclarados.map((d) => d.id), ['manual', 'novedades']);
  });

  it('NO es comodín: la ausencia del campo no significa "todos"', () => {
    const p = politicaDeEje(conDocSets);
    assert.equal(p.dominiosComodin.has('docSet'), false);
  });

  it('no toca el eje: el tipo, el param y el default siguen siendo los del eje', () => {
    const p = politicaDeEje(conDocSets);
    assert.equal(p.tipo, 'version');
    assert.equal(p.param, 'version');
    assert.equal(p.default, '19');
  });

  it('sin doc sets declarados no hay faceta: ni filtro, ni campo, ni aviso', () => {
    const p = politicaDeEje({ eje: { tipo: 'version', default: '19' }, metadata: {} });
    assert.equal(p.filtrosDominio.includes('docSet'), false);
    assert.equal(p.camposDominio.includes('docSet'), false);
    assert.equal(p.avisoMezclaDocSet, false);
    assert.deepEqual(p.docSetsDeclarados, []);
  });

  it('acepta el vocabulario como strings pelados y les pone label', () => {
    const p = politicaDeEje({ eje: { tipo: 'none' }, metadata: { docSets: ['manual'] } });
    assert.deepEqual(p.docSetsDeclarados, [{ id: 'manual', label: 'manual' }]);
  });
});

// ════════════════════════════════════════════════════ el filtro, con motor

describe('buscar — el filtro de doc set es duro y excluye', () => {
  it('sin filtro busca en las dos documentaciones', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', version: '19' });
    assert.deepEqual(slugs(r), [
      'manual/inventario/tipos-de-operaciones',
      'novedades/que-revisar/remitos',
    ]);
  });

  it('con filtro devuelve solo esa documentación', () => {
    usarFixture('doc-sets');
    assert.deepEqual(slugs(buscar({ q: 'remito', version: '19', docSet: 'manual' })), [
      'manual/inventario/tipos-de-operaciones',
    ]);
    assert.deepEqual(slugs(buscar({ q: 'remito', version: '19', docSet: 'novedades' })), [
      'novedades/que-revisar/remitos',
    ]);
  });

  it('acepta varios valores', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', version: '19', docSet: ['manual', 'novedades'] });
    assert.equal(r.resultados.length, 2);
  });

  it('el doc set NO reemplaza al filtro de versión: los dos ejes son independientes', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', docSet: 'manual' });
    assert.deepEqual(slugs(r).length, 2, 'las dos versiones del artículo del manual');
    const r18 = buscar({ q: 'remito', docSet: 'manual', version: '18' });
    assert.equal(r18.resultados.length, 1);
    assert.equal(r18.resultados[0].version, '18');
  });

  it('el hit lleva el doc set, para que el agente pueda atribuir', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', version: '19', docSet: 'novedades' });
    assert.equal(r.resultados[0].docSet, 'novedades');
  });

  it('el eco de filtros lo incluye', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', docSet: 'manual' });
    assert.deepEqual(r.filtros.docSet, ['manual']);
  });
});

// ═══════════════════════════════════════════════════════ el aviso de mezcla

describe('buscar — avisa cuando la respuesta mezcla documentaciones', () => {
  it('sin filtro y con resultados de las dos, avisa y nombra los labels', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', version: '19' });
    assert.match(r.aviso ?? '', /Manual de usuario/);
    assert.match(r.aviso ?? '', /Novedades de versión/);
  });

  it('con filtro no avisa: no hay nada mezclado', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito', version: '19', docSet: 'manual' });
    assert.equal(/Novedades de versión/.test(r.aviso ?? ''), false);
  });

  it('el aviso del eje y el del doc set conviven: los dos son ciertos a la vez', () => {
    usarFixture('doc-sets');
    const r = buscar({ q: 'remito' }); // sin versión y sin doc set
    assert.match(r.aviso ?? '', /18/);
    assert.match(r.aviso ?? '', /Novedades de versión/);
  });

  it('un corpus sin doc sets no gana el aviso', () => {
    usarFixture('paises');
    const r = buscar({ q: 'factura' });
    assert.equal(/documentaciones distintas/.test(r.aviso ?? ''), false);
  });
});

// ══════════════════════════════════════════════════════ leer() y mapa()

describe('leer — el doc set no agrega ambigüedad, porque va en el slug', () => {
  it('devuelve el artículo con su doc set, sin pedir un parámetro nuevo', () => {
    usarFixture('doc-sets');
    const r = leer({ slug: 'novedades/que-revisar/remitos' });
    assert.equal(r.encontrado, true);
    assert.equal(r.docSet, 'novedades');
  });

  it('el mismo slug en dos versiones sigue desambiguando por el eje, como siempre', () => {
    usarFixture('doc-sets');
    const r = leer({ slug: 'manual/inventario/tipos-de-operaciones', version: '18' });
    assert.equal(r.encontrado, true);
    assert.equal(r.version, '18');
    assert.equal(r.docSet, 'manual');
  });
});

describe('mapa — el vocabulario viaja como metadata', () => {
  it('expone los doc sets declarados', () => {
    usarFixture('doc-sets');
    const m = mapa();
    assert.deepEqual(m.metadata.docSets.map((d) => d.id), ['manual', 'novedades']);
  });
});

// ══════════════════════════════════════════ el invariante que evita el pisado

describe('construir — un slug en dos doc sets es un error de contenido, no un warning', () => {
  it('tira, y el mensaje nombra el slug y explica dónde mirar', () => {
    usarFixture('doc-sets-slug-colisionado');
    assert.throws(() => buscar({ q: 'remito' }), /más de un doc set/);
    _resetIndice();
    usarFixture('doc-sets-slug-colisionado');
    assert.throws(() => buscar({ q: 'remito' }), /docSets\.secciones/);
  });
});
