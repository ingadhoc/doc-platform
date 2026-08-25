/**
 * Suite de la faceta `paises`. `node --test tests/paises.test.mjs`.
 *
 * POR QUÉ UNA SUITE PROPIA Y NO TRES CASOS EN `buscar.test.mjs`. Lo que se
 * protege acá no es "otro filtro más": es la ASIMETRÍA del filtro, que es
 * contraintuitiva y por eso se pierde en cada refactor. El tag EXCLUYE (pedir
 * UY no devuelve una página de AR) y la AUSENCIA del tag NO oculta (una página
 * universal sale bajo cualquier país). La segunda mitad es la que se rompe
 * sola: el `articulo[dominio] || []` que parece inofensivo convierte una página
 * universal en una página de ningún país, y filtrar por UY borra el manual
 * entero.
 *
 * Ya pasó, un nivel más arriba: es letra por letra el Fix #12 de oba-docs, que
 * dejó `relacion/` invisible porque un artículo con `eje: null` no matcheaba
 * ninguna versión y la skill del agente ordena filtrar SIEMPRE por versión.
 * `paises` tiene el mismo modo de falla con un agravante — el filtro de país lo
 * pide el consumidor, no el corpus, y nadie mira el resultado vacío hasta que
 * un cliente uruguayo pregunta.
 *
 * `paises` NO es un eje: no multiplica el build, no bifurca URLs y `TIPOS_DE_EJE`
 * no se toca. Ver `references/frontmatter.md` § "Países: una faceta, no un eje"
 * del estándar.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, leer, politicaDeEje, TIPOS_DE_EJE } = await import('../lib/mcp/indice.mjs');

function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const slugs = (r) => r.resultados.map((h) => h.slug).sort();
const hit = (r, slug) => r.resultados.find((h) => h.slug === slug);

// ════════════════════════════════════════════════ la política, sin el motor

describe('politicaDeEje — `paises` entra como faceta, nunca como eje', () => {
  it('el vocabulario del corpus enciende el filtro y el campo', () => {
    const p = politicaDeEje({
      eje: { tipo: 'version', default: '19' },
      metadata: { modules: true, paises: ['AR', 'CL', 'UY'] },
    });
    assert.deepEqual(p.filtrosDominio, ['modules', 'paises']);
    assert.deepEqual(p.camposDominio, ['modules', 'paises']);
    assert.deepEqual(p.paisesDeclarados, ['AR', 'CL', 'UY']);
  });

  it('el comodín es POR FACETA: `paises` sí, `modules` no', () => {
    const p = politicaDeEje({ eje: { tipo: 'version' }, metadata: { modules: true, paises: ['AR'] } });
    assert.equal(p.dominiosComodin.has('paises'), true);
    assert.equal(p.dominiosComodin.has('modules'), false);
  });

  it('sin vocabulario declarado no hay faceta: ni filtro, ni campo, ni comodín', () => {
    for (const metadata of [{ modules: true }, { modules: true, paises: [] }]) {
      const p = politicaDeEje({ eje: { tipo: 'version' }, metadata });
      assert.deepEqual(p.filtrosDominio, ['modules']);
      assert.deepEqual(p.camposDominio, ['modules']);
      assert.equal(p.dominiosComodin.size, 0);
    }
  });

  it('`paises` NO es un tipo de eje: un corpus no puede declararlo como tal', () => {
    assert.deepEqual(TIPOS_DE_EJE, ['version', 'project', 'none']);
    assert.throws(() => politicaDeEje({ eje: { tipo: 'paises' } }), /no es un tipo de eje/);
  });
});

// ═══════════════════════════════════════════════ el filtro, sobre el motor

describe('buscar({ paises }) — el tag excluye, la ausencia nunca oculta', () => {
  it('filtrar por UY devuelve las de UY Y todas las universales', () => {
    usarFixture('paises');
    const r = buscar({ q: 'cobranza', paises: 'UY', version: '19' });
    assert.deepEqual(slugs(r), [
      // universal: no declara `paises`
      'manual/finanzas/cobros-y-pagos/registrar-un-cobro',
      // derivada del path por el build del repo de contenido
      'manual/localizaciones/uruguay/e-remito',
      // tagueada a mano en el frontmatter
      'manual/soluciones-de-pago/abitab',
      // universal, y encima sin `modules` declarados
      'manual/uso-general/busqueda',
      // cross-version y universal: los dos comodines a la vez
      'relacion/como-te-acompanamos/actualizacion-de-version',
    ]);
  });

  it('filtrar por UY NO devuelve ninguna de AR', () => {
    usarFixture('paises');
    const r = buscar({ q: 'cobranza', paises: 'UY', version: '19' });
    assert.equal(hit(r, 'manual/inventario/rutas-y-envios/andreani'), undefined);
    // Y sin el filtro sí está: la que la saca es la faceta, no la query.
    const sinFiltro = buscar({ q: 'cobranza', version: '19' });
    assert.ok(hit(sinFiltro, 'manual/inventario/rutas-y-envios/andreani'));
  });

  it('el artículo con `paises` DERIVADO del path filtra igual que uno tagueado a mano', () => {
    usarFixture('paises');
    // El fuente de `localizaciones/uruguay/e-remito` NO declara `paises:` (es
    // error de lint hacerlo); el build lo deriva. Para el motor es un tag más.
    const uy = buscar({ q: 'remito', paises: 'UY', version: '19' });
    assert.deepEqual(hit(uy, 'manual/localizaciones/uruguay/e-remito').paises, ['UY']);
    const ar = buscar({ q: 'remito', paises: 'AR', version: '19' });
    assert.equal(hit(ar, 'manual/localizaciones/uruguay/e-remito'), undefined);
  });

  it('`paises: null` en el hit significa universal, no "no sé"', () => {
    usarFixture('paises');
    const r = buscar({ q: 'cobranza', paises: 'AR', version: '19' });
    // No se normaliza a `[]` como `modules`: un array vacío se lee como
    // "ningún país" y es justo lo contrario de lo que el dato dice.
    assert.equal(hit(r, 'manual/finanzas/cobros-y-pagos/registrar-un-cobro').paises, null);
    assert.deepEqual(hit(r, 'manual/inventario/rutas-y-envios/andreani').paises, ['AR']);
  });

  it('el comodín del país compone con el del eje: la cross-version universal sale igual', () => {
    usarFixture('paises');
    const r = buscar({ q: 'cobranza', paises: 'CL', version: '19' });
    assert.ok(hit(r, 'relacion/como-te-acompanamos/actualizacion-de-version'));
  });

  it('`leer()` devuelve la faceta del artículo', () => {
    usarFixture('paises');
    const a = leer({ slug: 'manual/soluciones-de-pago/abitab', version: '19' });
    assert.deepEqual(a.paises, ['UY']);
    const u = leer({ slug: 'manual/finanzas/cobros-y-pagos/registrar-un-cobro', version: '19' });
    assert.equal(u.paises, null);
  });

  it('EL COMODÍN NO APLICA A `modules`: sin módulos declarados no matchea el filtro', () => {
    usarFixture('paises');
    // `manual/uso-general/busqueda` no declara `modules` — igual que no declara
    // `paises`. Con país sale (ausencia = todos); con módulo no (ausencia =
    // ninguno). Las dos facetas viven en el mismo bucle y no comparten
    // semántica: si algún día alguien "simplifica" el `if`, este test lo dice.
    const conPais = buscar({ q: 'cobranza', paises: 'UY', version: '19' });
    assert.ok(hit(conPais, 'manual/uso-general/busqueda'));
    const conModulo = buscar({ q: 'cobranza', modules: 'account', version: '19' });
    assert.equal(hit(conModulo, 'manual/uso-general/busqueda'), undefined);
    // Y el `modules: []` explícito de la cross-version tampoco es comodín.
    assert.equal(hit(conModulo, 'relacion/como-te-acompanamos/actualizacion-de-version'), undefined);
  });
});

describe('un corpus sin la faceta no la ofrece y no se rompe', () => {
  it('el índice sin `metadata.paises` ignora el argumento y devuelve todo', () => {
    usarFixture('eje-version');
    const sinArg = buscar({ q: 'nota de crédito', version: '19' });
    const conArg = buscar({ q: 'nota de crédito', version: '19', paises: 'UY' });
    // No tira, no filtra, y no inventa el campo en el hit.
    assert.deepEqual(slugs(conArg), slugs(sinArg));
    assert.ok(conArg.total > 0);
    assert.equal('paises' in conArg.resultados[0], false);
    assert.equal(conArg.filtros.paises, undefined);
  });
});
