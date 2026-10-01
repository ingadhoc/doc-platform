/**
 * El país por defecto del sitio. `node --test tests/pais-por-defecto.test.mjs`.
 *
 * Sin `paises` en los filtros, los artículos de otro país bajan en el orden (no
 * se excluyen): los del país que nombra la consulta o, si no nombra ninguno,
 * los del país que el sitio declara en `metadata.paisPorDefecto`. Qué término
 * nombra un país sale del corpus, no de una lista del motor.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const { _resetIndice, buscar, politicaDeEje } = await import('../lib/mcp/indice.mjs');

const FIXTURE = fileURLToPath(new URL('./fixtures/pais-por-defecto.json', import.meta.url));

function usar(path) {
  process.env.DOCS_INDICE_PATH = path;
  _resetIndice();
}

/** El mismo corpus con otra metadata, en un archivo temporal. */
function conMetadata(cambio) {
  const crudo = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  crudo.build.metadata = cambio(crudo.build.metadata);
  const path = join(mkdtempSync(join(tmpdir(), 'pais-')), 'index.json');
  writeFileSync(path, JSON.stringify(crudo));
  return path;
}

const SIN_DEFECTO = conMetadata(({ paisPorDefecto, ...resto }) => resto);
const slugs = (r) => r.resultados.map((h) => h.slug);
const GUIA_CL = 'guias/factura-electronica-en-chile';
const AR = 'manual/localizaciones/argentina/factura-electronica';

describe('politicaDeEje — `paisPorDefecto`', () => {
  it('vale sólo si es uno de los países del corpus', () => {
    const p = (metadata) => politicaDeEje({ eje: { tipo: 'none' }, metadata }).paisPorDefecto;
    assert.equal(p({ paises: ['AR', 'CL'], paisPorDefecto: 'AR' }), 'AR');
    assert.equal(p({ paises: ['AR', 'CL'], paisPorDefecto: 'MX' }), null);
    assert.equal(p({ paisPorDefecto: 'AR' }), null);
    assert.equal(p({ paises: ['AR'] }), null);
  });
});

describe('buscar() con país por defecto', () => {
  it('sin declaración, el orden y la respuesta son los de siempre', () => {
    usar(SIN_DEFECTO);
    const r = buscar({ q: 'factura electronica', version: '19' });
    assert.equal(slugs(r)[0], GUIA_CL);
    assert.equal('paisesAplicados' in r, false);
    assert.equal('paisElegidoPor' in r, false);
  });

  it('sin país en la consulta, el de otro país baja pero no se excluye', () => {
    usar(SIN_DEFECTO);
    const antes = buscar({ q: 'factura electronica', version: '19' });
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '19' });
    assert.equal(slugs(r)[0], AR);
    assert.ok(slugs(r).indexOf(GUIA_CL) > 0);
    assert.deepEqual([...slugs(r)].sort(), [...slugs(antes)].sort());
    assert.deepEqual(r.paisesAplicados, ['AR']);
    assert.equal(r.paisElegidoPor, 'defecto');
  });

  it('las páginas universales no se tocan', () => {
    usar(SIN_DEFECTO);
    const antes = buscar({ q: 'factura electronica', version: '19' }).resultados;
    usar(FIXTURE);
    const despues = buscar({ q: 'factura electronica', version: '19' }).resultados;
    const score = (hits, slug) => hits.find((h) => h.slug === slug).score;
    for (const slug of ['manual/finanzas/facturas-de-cliente', AR]) {
      assert.equal(score(despues, slug), score(antes, slug), slug);
    }
  });

  it('el nombre del país en la consulta favorece a ese país', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica chile', version: '19' });
    assert.equal(slugs(r)[0], GUIA_CL);
    assert.deepEqual(r.paisesAplicados, ['CL']);
    assert.equal(r.paisElegidoPor, 'consulta');
  });

  it('un término que el corpus usa casi sólo en un país también lo nombra', () => {
    usar(FIXTURE);
    assert.deepEqual(buscar({ q: 'factura electronica sii', version: '19' }).paisesAplicados, ['CL']);
    assert.deepEqual(buscar({ q: 'factura electronica dgi', version: '19' }).paisesAplicados, ['UY']);
  });

  it('un término de un solo artículo no alcanza para nombrar un país', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'timbraje', version: '19' });
    assert.equal(r.paisElegidoPor, 'defecto');
    assert.equal(slugs(r)[0], 'manual/localizaciones/chile/folios');
  });

  it('un término que está en todos los países no nombra ninguno', () => {
    usar(FIXTURE);
    assert.equal(buscar({ q: 'factura', version: '19' }).paisElegidoPor, 'defecto');
  });

  it('con `paises` en los filtros, igual que antes: filtro duro y sin reordenar', () => {
    usar(SIN_DEFECTO);
    const antes = buscar({ q: 'factura electronica', version: '19', paises: 'CL' });
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '19', paises: 'CL' });
    assert.deepEqual(slugs(r), slugs(antes));
    assert.equal(slugs(r).includes(AR), false);
    assert.equal('paisesAplicados' in r, false);
  });
});
