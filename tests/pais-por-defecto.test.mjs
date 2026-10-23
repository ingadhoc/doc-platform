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

const { _resetIndice, buscar, leer, politicaDeEje } = await import('../lib/mcp/indice.mjs');

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

/**
 * El mismo corpus más 200 páginas universales de relleno: la exclusividad pide
 * que el término sea raro en el sitio, y en 11 artículos ninguno lo es. Diez
 * de ellas dicen «casa» en el cuerpo.
 */
function conRelleno() {
  const crudo = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const universal = crudo.articulos.find((a) => a.slug === 'manual/finanzas/facturas-de-cliente');
  for (let i = 0; i < 200; i++) {
    const slug = `manual/general/opciones-${i}`;
    const texto = i < 10 ? 'Opciones generales de la casa.' : 'Opciones generales del sistema.';
    crudo.articulos.push({
      ...universal, id: `19::${slug}`, slug, url: `/19/${slug}`, title: `Opciones ${i}`,
      description: texto, keywords: [], body: `# Opciones ${i}\n\n## Pasos\n\n${texto}\n`,
    });
  }
  crudo.build.articulos = crudo.articulos.length;
  const path = join(mkdtempSync(join(tmpdir(), 'pais-')), 'index.json');
  writeFileSync(path, JSON.stringify(crudo));
  return path;
}

const CON_RELLENO = conRelleno();
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
    // El agente lee texto: lo que asumió va también en prosa, no solo en el campo.
    assert.match(r.mensajePais, /^No pasaste `paises` y la consulta no nombra un país: asumí AR, el país por defecto del sitio\./);
    assert.match(r.mensajePais, /repetí con `paises`/);
  });

  it('el mensaje por defecto nombra los otros países del vocabulario y cierra el loop', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '19' });
    assert.match(r.mensajePais, /Si la localización de Odoo del usuario es otra \(CL o UY\), repetí con `paises`; si no la sabés, dejalo así\./);
    const chile = buscar({ q: 'factura electronica chile', version: '19' });
    assert.match(chile.mensajePais, /es otra \(AR o UY\)/);
  });

  it('con el país en la consulta, el mensaje dice que salió de ahí; con `paises`, no hay mensaje', () => {
    usar(FIXTURE);
    assert.match(buscar({ q: 'factura electronica chile', version: '19' }).mensajePais, /prioricé CL porque la consulta lo nombra/);
    assert.match(buscar({ q: 'factura electronica chile argentina', version: '19' }).mensajePais, /porque la consulta los nombra/);
    assert.equal('mensajePais' in buscar({ q: 'factura electronica', version: '19', paises: 'UY' }), false);
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

  it('un término raro que sólo está en el título o las keywords de un país lo nombra, aunque sea uno solo', () => {
    usar(CON_RELLENO);
    const r = buscar({ q: 'timbraje', version: '19' });
    assert.deepEqual(r.paisesAplicados, ['CL']);
    assert.equal(r.paisElegidoPor, 'consulta');
    assert.equal(slugs(r)[0], 'manual/localizaciones/chile/folios');
  });

  it('en un sitio chico ningún término es raro: el término de un solo artículo no alcanza', () => {
    usar(FIXTURE);
    assert.equal(buscar({ q: 'timbraje', version: '19' }).paisElegidoPor, 'defecto');
  });

  it('una página universal que nombra el término no le quita el país', () => {
    usar(CON_RELLENO);
    assert.deepEqual(buscar({ q: 'abitab', version: '19' }).paisesAplicados, ['UY']);
  });

  it('una marca local mal escrita también nombra su país', () => {
    usar(CON_RELLENO);
    assert.deepEqual(buscar({ q: 'abitap', version: '19' }).paisesAplicados, ['UY']);
  });

  it('un término que está sobre todo en universales no nombra un país', () => {
    usar(CON_RELLENO);
    assert.equal(buscar({ q: 'ingles', version: '19' }).paisElegidoPor, 'defecto');
  });

  it('un término que sólo está en el cuerpo de un país no lo nombra', () => {
    usar(CON_RELLENO);
    assert.equal(buscar({ q: 'idealmente', version: '19' }).paisElegidoPor, 'defecto');
  });

  it('un término común en el sitio no nombra un país, aunque sólo un país lo tenga en el título', () => {
    usar(CON_RELLENO);
    assert.equal(buscar({ q: 'casa', version: '19' }).paisElegidoPor, 'defecto');
  });

  it('el gentilicio llega al país por la raíz: «chileno» como «chilena»', () => {
    usar(CON_RELLENO);
    const r = buscar({ q: 'factura electronica proveedor chileno', version: '19' });
    assert.deepEqual(r.paisesAplicados, ['CL']);
    assert.equal(r.paisElegidoPor, 'consulta');
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

describe('una versión sin documentación', () => {
  it('`buscar` lo dice en vez de sugerir sacar el filtro', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '17' });
    assert.equal(r.total, 0);
    assert.equal(r.motivo, 'valor-del-eje-sin-docu');
    assert.equal(r.versionPedida, '17');
    assert.deepEqual(r.versionesDisponibles, ['19']);
    assert.match(r.mensaje, /^No hay documentación para la versión 17 de Odoo: solo para 19\./);
    assert.equal('sugerencias' in r, false);
  });

  it('con una versión que sí está entre las pedidas, busca en esa y avisa de la otra', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: ['17', '19'] });
    assert.ok(r.total > 0);
    assert.match(r.mensajeEje, /versión 17/);
  });

  it('`leer` tampoco devuelve un artículo para una versión sin docu', () => {
    usar(FIXTURE);
    const r = leer({ slug: AR, version: '17' });
    assert.equal(r.encontrado, false);
    assert.equal(r.motivo, 'valor-del-eje-sin-docu');
    assert.equal(leer({ slug: AR, version: '19' }).encontrado, true);
  });
});

describe('un país sin documentación', () => {
  const universales = ['manual/finanzas/facturas-de-cliente', 'manual/localizaciones/index'];

  it('`buscar` lo dice, sigue con las páginas sin país y dice qué contestar', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '19', paises: 'ES' });
    assert.equal(r.motivo, 'pais-sin-docu');
    assert.deepEqual(r.paisesPedidos, ['ES']);
    assert.deepEqual(r.paisesDisponibles, ['AR', 'CL', 'UY']);
    assert.deepEqual(r.filtros.paises, ['ES']);
    assert.ok(r.total > 0);
    for (const hit of r.resultados) assert.ok(universales.includes(hit.slug), hit.slug);
    assert.match(r.mensaje, /^No hay documentación específica para ES: solo para AR, CL, UY\. `paises` es la localización de Odoo de la base \(l10n_ar → AR, l10n_cl → CL, l10n_uy → UY\), no la sede de la empresa ni el idioma\./);
    assert.match(r.mensaje, /Si no sabés su localización, repetí sin `paises`\.$/);
    assert.match(r.mensaje, /decile que lo propio de su país no está documentado/);
  });

  it('mezclado con uno que sí está, busca solo con ese y no pide repetir', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '19', paises: ['ES', 'UY'] });
    assert.deepEqual(r.filtros.paises, ['UY']);
    assert.ok(r.total > 0);
    assert.equal('motivo' in r, false);
    assert.equal(r.mensajePais, 'No hay documentación para ES: busqué solo con UY.');
  });

  it('la versión sin docu se avisa primero, y el país igual', () => {
    usar(FIXTURE);
    const r = buscar({ q: 'factura electronica', version: '17', paises: 'ES' });
    assert.equal(r.motivo, 'valor-del-eje-sin-docu');
    assert.match(r.mensaje, /versión 17/);
    assert.match(r.mensajePais, /^Además, no hay documentación para ES.*l10n_ar → AR.*no la sede de la empresa ni el idioma\.$/);
  });

  it('`paises` vacío después de normalizar es no haberlo pasado', () => {
    usar(FIXTURE);
    for (const vacio of [' ', ',', ' , ']) {
      const r = buscar({ q: 'factura electronica', version: '19', paises: vacio });
      assert.equal(r.filtros.paises, null, JSON.stringify(vacio));
      assert.equal(r.paisElegidoPor, 'defecto');
    }
  });

  it('el código en minúsculas o en un string con comas es el mismo país', () => {
    usar(FIXTURE);
    const slugsDe = (args) => buscar({ q: 'factura electronica', version: '19', ...args }).resultados.map((h) => h.slug);
    assert.deepEqual(buscar({ q: 'factura electronica', version: '19', paises: 'uy' }).filtros.paises, ['UY']);
    assert.deepEqual(slugsDe({ paises: 'uy' }), slugsDe({ paises: 'UY' }));
    assert.deepEqual(buscar({ q: 'factura electronica', version: '19', paises: 'UY, ar' }).filtros.paises, ['UY', 'AR']);
    assert.deepEqual(slugsDe({ paises: 'UY,AR' }), slugsDe({ paises: ['UY', 'AR'] }));
  });
});
