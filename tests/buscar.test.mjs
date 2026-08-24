/**
 * Suite del motor de búsqueda unificado. `node --test buscar.test.mjs`.
 *
 * De dónde sale: es el port de los dos scripts de calidad de búsqueda que solo
 * existían en oba-docs —`scripts/test-buscar.mjs` y
 * `scripts/busqueda-calidad.mjs`— a la convención de tests del paquete
 * (`node:test` nativo, archivos `*.test.mjs`, la de adhoc-docs).
 *
 * Dos cambios de fondo respecto de los originales, los dos a propósito:
 *
 *   1. PARAMETRIZADA POR FIXTURE, NO POR CORPUS REAL. `test-buscar.mjs`
 *      corría contra `api/_generated/index.json` — el índice del repo — y por
 *      eso exigía `npm run gen:publico` antes y se rompía cada vez que el
 *      contenido cambiaba de nombre. Acá cada eje tiene su fixture chico en
 *      `fixtures/`, apuntado por `DOCS_INDICE_PATH`: los tests miden el MOTOR.
 *   2. LOS TRES EJES EN LA MISMA SUITE. Los comportamientos que oba-docs
 *      testeaba (stopwords, fallback OR, filtros duros, hints) no eran de su
 *      eje: son del motor. Acá se verifican con eje `version`, `project` y
 *      `none`, que es lo que evita que el próximo fix se pierda en el camino.
 *
 * Lo que NO está acá, y por qué: `busqueda-calidad.mjs` levantaba Playwright
 * contra los dos sitios servidos para medir el buscador de Docusaurus. Eso es
 * el sitio, no el motor del MCP, y no se puede parametrizar por fixture: sus
 * cuatro tipos de query (mensaje de error literal, nombre de campo, pregunta
 * en lenguaje natural, término solo interno) se portaron acá como casos del
 * índice, y el chequeo de navegador queda como script del repo consumidor.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, indice, leer, mapa, normalizarTermino, politicaDeEje, procesarTermino, STOPWORDS, terminosDe } =
  await import('../lib/mcp/indice.mjs');

/** Cambia el índice bajo el motor: el fixture manda, y el cache se tira. */
function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const slugs = (r) => r.resultados.map((h) => h.slug);

// ══════════════════════════════════════════════ el eje, como parámetro puro

describe('politicaDeEje — el objeto `eje` del contrato, traducido a política', () => {
  it('lee el objeto del schema: tipo, default y valores', () => {
    const p = politicaDeEje({ eje: { tipo: 'project', valores: [{ id: 'oba' }] } });
    assert.equal(p.tipo, 'project');
    assert.equal(p.param, 'project');
    assert.equal(p.campo, 'eje');
    assert.equal(p.default, null);
    assert.deepEqual(p.valoresDeclarados, [{ id: 'oba' }]);
  });

  it('el corpus sin eje no tiene campo ni parámetro que ofrecer', () => {
    const p = politicaDeEje({ eje: { tipo: 'none' } });
    assert.equal(p.campo, null);
    assert.equal(p.param, null);
    assert.equal(p.hay, false);
    assert.equal(p.avisoMezcla, false);
  });

  it('un índice pre-unificación (dialecto `versionado`/`projects`/`latest`) TIRA, no adivina', () => {
    // La regla del lector: los tres dialectos anteriores son incompatibles
    // entre sí y elegir uno sería el bug que `schemaVersion` previene.
    assert.throws(() => politicaDeEje({ audience: 'publico', latest: '19' }), /pre-unificación/);
    assert.throws(() => politicaDeEje({ versionado: false }), /pre-unificación/);
    assert.throws(() => politicaDeEje({ projects: [{ id: 'oba' }] }), /pre-unificación/);
  });

  it('un tipo de eje desconocido TIRA con el nombre del campo', () => {
    assert.throws(() => politicaDeEje({ eje: { tipo: 'planeta' } }), /no es un tipo de eje/);
  });

  it('la PRESENCIA de `default` es la política de desambiguación, sin `if` por tipo', () => {
    // Es la regla única de diseno-eje.md §3: elige el que declaró a quién
    // elegir, y el que no declara devuelve ambigüedad. Vale para los dos ejes.
    const conDefault = politicaDeEje({ eje: { tipo: 'version', default: '19' } });
    assert.equal(conDefault.sinValor, 'default');
    assert.equal(conDefault.comodin, true);
    const sinDefault = politicaDeEje({ eje: { tipo: 'project', valores: [] } });
    assert.equal(sinDefault.sinValor, 'ambiguo');
    assert.equal(sinDefault.comodin, false);
    const projectConDefault = politicaDeEje({ eje: { tipo: 'project', default: 'oba' } });
    assert.equal(projectConDefault.sinValor, 'default');
  });

  it('las facetas de dominio salen de `build.metadata`, no del tipo de eje', () => {
    // Antes la correlación era histórica (`modules` con version, `type` con
    // project). Ahora la declara el corpus: un corpus con eje project puede
    // tener `modules` y el motor no tiene nada que suponer.
    const p = politicaDeEje({ eje: { tipo: 'project' }, metadata: { modules: true, types: ['guia'] } });
    assert.deepEqual(p.filtrosDominio, ['modules']);
    assert.deepEqual(p.camposDominio, ['modules', 'type']);
    const sin = politicaDeEje({ eje: { tipo: 'none' } });
    assert.deepEqual(sin.filtrosDominio, []);
    assert.deepEqual(sin.camposDominio, []);
  });
});

describe('la regla del lector: el índice declara su schemaVersion', () => {
  it('un índice sin schemaVersion no se lee: falla con nombre', () => {
    usarFixture('sin-schema-version');
    assert.throws(() => indice(), /índice sin `schemaVersion`/);
  });

  it('un emisor más nuevo TIRA y dice qué actualizar', () => {
    usarFixture('schema-version-futura');
    assert.throws(() => indice(), /lee hasta 1: actualizá @ingadhoc\/docs-platform/);
  });

  it('la copia estática (sin `body`) no se sirve como si fuera el índice de la función', () => {
    usarFixture('sin-cuerpo');
    assert.throws(() => indice(), /viene sin `body`/);
  });
});

// ══════════════════════════════════════ el motor: vale para cualquier eje

describe('normalización y stopwords (fix #11 de oba-docs)', () => {
  it('minúsculas, sin tildes y sin puntuación de borde', () => {
    assert.equal(normalizarTermino('Posición'), 'posicion');
    assert.equal(normalizarTermino('¿Cómo?'), 'como');
  });

  it('el relleno conversacional no es un término', () => {
    for (const relleno of ['quiero', 'cómo', 'para', 'que', 'necesito']) {
      assert.equal(procesarTermino(relleno), null, relleno);
    }
  });

  it('las palabras del dominio que también parecen relleno NO se descartan', () => {
    // Quedaron afuera de STOPWORDS a propósito: aparecen con sentido en las
    // `keywords:` del corpus ("no sale el cae", "probar sin romper").
    for (const termino of ['no', 'sin', 'sobre']) {
      assert.equal(procesarTermino(termino), termino, termino);
      assert.equal(STOPWORDS.has(termino), false, termino);
    }
  });

  it('terminosDe deja solo los términos con señal', () => {
    assert.deepEqual(terminosDe('quiero saber cómo hago para dar por pagada una factura'), [
      'dar',
      'pagada',
      'factura',
    ]);
    assert.deepEqual(terminosDe('quiero saber cómo hago para'), []);
  });
});

// ═════════════════════════════════════════════════════════ eje = version

describe('eje version — frases conversacionales de cliente', () => {
  before(() => usarFixture('eje-version'));

  // Antes del fix #11 estas tres daban 0 resultados + hints: el AND estricto
  // exigía "quiero", "como", "para", "que"… en el artículo.
  const casos = [
    {
      q: 'quiero saber cómo hago para dar por pagada una factura',
      primero: 'manual/finanzas/cobros-y-pagos/registrar-un-cobro',
      porQue: 'es la pregunta de ticket más común de cobranzas',
    },
    {
      q: 'necesito una nota de crédito para anular la factura que emití',
      primero: 'manual/finanzas/facturacion/notas-de-credito',
      porQue: 'la frase trae el término del dominio adentro de relleno',
    },
    {
      q: 'cómo puedo conciliar el extracto que me manda el banco',
      primero: 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria',
      porQue: '"extracto bancario" es keyword de la página',
    },
  ];

  for (const c of casos) {
    it(`"${c.q}" → ${c.primero} (${c.porQue})`, () => {
      const r = buscar({ q: c.q, version: '19' });
      assert.equal(r.modo, 'and', 'con las stopwords afuera el AND alcanza');
      assert.equal(r.resultados[0].slug, c.primero);
      // El filtro duro no se afloja nunca: cross-version (`version: null`) no
      // es una fuga — aplica a todas las versiones.
      for (const h of r.resultados) {
        if (h.version != null) assert.equal(String(h.version), '19');
      }
    });
  }

  it('la frase sin filtro de versión llega igual al artículo cross-version', () => {
    const r = buscar({ q: 'quiero pasar a la 19, cómo es la actualización de versión' });
    assert.equal(r.resultados[0].slug, 'relacion/como-te-acompanamos/actualizacion-de-version');
  });
});

describe('eje version — queries precisas (sin regresión de ranking)', () => {
  before(() => usarFixture('eje-version'));

  const casos = [
    ['nota de crédito', 'manual/finanzas/facturacion/notas-de-credito'],
    ['conciliación bancaria', 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria'],
    ['comprobantes electrónicos cae', 'manual/finanzas/facturacion/comprobantes-electronicos'],
    ['registrar un cobro', 'manual/finanzas/cobros-y-pagos/registrar-un-cobro'],
  ];

  for (const [q, primero] of casos) {
    it(`"${q}" sigue devolviendo ${primero} en modo and`, () => {
      const r = buscar({ q, version: '19' });
      assert.equal(r.modo, 'and');
      assert.equal(r.resultados[0].slug, primero);
    });
  }
});

describe('eje version — fallback OR (fix #12 de oba-docs)', () => {
  before(() => usarFixture('eje-version'));

  it('cuando ningún artículo tiene TODOS los términos, devuelve los que matchean más', () => {
    const r = buscar({
      q: 'el cliente pregunta por el débito automático y por el extracto del banco',
      version: '19',
    });
    assert.equal(r.modo, 'or-fallback');
    assert.ok(r.total > 0);
    // La `nota` es lo que le dice al LLM que verifique pertinencia antes de citar.
    assert.match(r.nota, /Ningún artículo contiene TODOS los términos/);
    assert.match(r.nota, /siguen siendo exactos y duros/);
  });

  it('el fallback afloja la conjunción de términos, NUNCA la metadata', () => {
    const r = buscar({
      q: 'no sale el cae del webservice de afip y tampoco puedo conciliar el banco',
      version: '18',
    });
    assert.equal(r.modo, 'or-fallback');
    assert.ok(r.total > 0);
    for (const h of r.resultados) {
      if (h.version != null) assert.equal(String(h.version), '18');
    }
  });

  it('el filtro de dominio (`modules`) también aguanta el fallback', () => {
    const r = buscar({
      q: 'el cliente pregunta por el débito automático y por el extracto del banco',
      version: '19',
      modules: 'account',
    });
    assert.equal(r.modo, 'or-fallback');
    assert.ok(r.total > 0);
    for (const h of r.resultados) assert.ok(h.modules.includes('account'));
  });

  it('el modo `and` no se contamina: cuando el AND encuentra, no hay nota', () => {
    const r = buscar({ q: 'nota de crédito', version: '19' });
    assert.equal(r.modo, 'and');
    assert.equal(r.nota, undefined);
  });
});

describe('eje version — hints (solo cuando ni el OR encuentra)', () => {
  before(() => usarFixture('eje-version'));

  it('ningún término del corpus: lo dice y ofrece el mapa', () => {
    const r = buscar({ q: 'receta de tiramisu casero' });
    assert.equal(r.total, 0);
    assert.equal(r.modo, 'and');
    assert.ok(r.sugerencias.some((s) => /Ningún término de la query aparece en el corpus/.test(s)));
    assert.ok(Array.isArray(r.ramasRelacionadas));
  });

  it('query 100% relleno: se lo decimos en vez de mentir con resultados', () => {
    const r = buscar({ q: 'quiero saber cómo hago para' });
    assert.equal(r.total, 0);
    assert.ok(r.sugerencias.some((s) => /palabras vacías/.test(s)));
  });

  it('cero por el filtro de versión: dice cuántos hay sin ese filtro', () => {
    const r = buscar({ q: 'débito automático', version: '18' });
    assert.equal(r.total, 0);
    const hint = r.sugerencias.find((s) => s.includes('`version`'));
    assert.ok(hint, `esperaba un hint sobre el filtro version, hubo: ${r.sugerencias}`);
    assert.match(hint, /devuelve otras versiones de Odoo/);
  });

  it('cero por el filtro de dominio: nombra el filtro que sobra', () => {
    const r = buscar({ q: 'nota de crédito', modules: 'l10n_ar_afipws' });
    assert.equal(r.total, 0);
    assert.ok(r.sugerencias.some((s) => /Sacando el filtro `modules`/.test(s)));
  });
});

describe('eje version — cross-version bajo filtro de versión (fix #12)', () => {
  before(() => usarFixture('eje-version'));

  it('el artículo cross-version pasa el filtro de cualquier versión', () => {
    for (const version of ['19', '18']) {
      const r = buscar({ q: 'actualización de versión', version });
      assert.ok(
        slugs(r).includes('relacion/como-te-acompanamos/actualizacion-de-version'),
        `con version=${version}`,
      );
    }
  });

  it('caso negativo: el artículo de OTRA versión sigue quedando afuera', () => {
    const r = buscar({ q: 'comprobantes electrónicos webservice de afip', version: '19' });
    assert.ok(slugs(r).includes('manual/finanzas/facturacion/comprobantes-electronicos'));
    const fuga = r.resultados.find(
      (h) => h.slug === 'manual/finanzas/facturacion/comprobantes-electronicos' && String(h.version) === '18',
    );
    assert.equal(fuga, undefined);
  });

  it('leer() un cross-version con la versión que arrastra la conversación', () => {
    const a = leer({ slug: 'relacion/como-te-acompanamos/actualizacion-de-version', version: '19' });
    assert.equal(a.encontrado, true);
    assert.equal(a.version, null);
  });
});

describe('eje version — leer()', () => {
  before(() => usarFixture('eje-version'));

  it('sin versión pedida manda `latest` de la config, no el orden del índice', () => {
    const a = leer({ slug: 'manual/finanzas/facturacion/notas-de-credito' });
    assert.equal(a.encontrado, true);
    assert.equal(a.version, '19');
    // Elegir se ANUNCIA: hoy oba elegía en silencio y el único rastro era la
    // lista de otras versiones, que el LLM puede ignorar.
    assert.equal(a.elegidoPor, 'default');
    assert.match(a.mensaje, /No pediste versión: te devuelvo la 19/);
    assert.deepEqual(a.otrosDelEje, [
      { valor: '18', url: 'https://docs.ejemplo.ar/18/manual/finanzas/facturacion/notas-de-credito' },
    ]);
  });

  it('la versión pedida manda: no devuelve otra sin que la pidan', () => {
    const a = leer({ slug: 'manual/finanzas/cobros-y-pagos/registrar-un-cobro', version: '18' });
    assert.equal(a.encontrado, false);
    assert.equal(a.motivo, 'slug-fuera-del-valor-pedido');
    assert.equal(a.versionPedida, '18');
    assert.deepEqual(a.versionesDisponibles, ['19']);
    assert.match(a.mensaje, /La versión pedida manda/);
    assert.match(a.siguientePaso, /version: "19"/);
  });

  it('slug inexistente hace soft-fail con sugerencias por similitud', () => {
    const a = leer({ slug: 'manual/finanzas/facturacion/notas-de-creditos' });
    assert.equal(a.encontrado, false);
    assert.equal(a.motivo, 'slug-inexistente');
    assert.match(a.mensaje, /NO significa que el artículo fue borrado/);
    assert.equal(a.sugerencias[0].slug, 'manual/finanzas/facturacion/notas-de-credito');
    // Las URLs de las sugerencias también son absolutas (de adhoc-docs).
    assert.match(a.sugerencias[0].url, /^https:\/\/docs\.ejemplo\.ar\//);
    assert.equal(a.siguientePaso, 'buscar({ q: "<términos del tema>" })');
  });

  it('la metadata de dominio del corpus viaja en la respuesta', () => {
    const a = leer({ slug: 'manual/finanzas/facturacion/comprobantes-electronicos', version: '19' });
    assert.deepEqual(a.modules, ['l10n_ar_afipws']);
    assert.equal(a.url, 'https://docs.ejemplo.ar/19/manual/finanzas/facturacion/comprobantes-electronicos');
  });

  it('pagina el body sin perder el resto', () => {
    const a = leer({ slug: 'manual/finanzas/facturacion/notas-de-credito', version: '19', page: 2 });
    assert.equal(a.page, 2);
    assert.equal(a.body, '');
    assert.equal(a.hayMas, false);
  });
});

describe('eje version — mapa() e índice', () => {
  before(() => usarFixture('eje-version'));

  it('el id de un artículo es version::slug y el mismo slug vive en dos versiones', () => {
    const idx = indice();
    assert.ok(idx.porId.has('19::manual/finanzas/facturacion/notas-de-credito'));
    assert.ok(idx.porId.has('18::manual/finanzas/facturacion/notas-de-credito'));
    assert.equal(idx.porSlug.get('manual/finanzas/facturacion/notas-de-credito').length, 2);
  });

  it('el eje viaja como el objeto del contrato: tipo, default y valores de mayor a menor', () => {
    const m = mapa();
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.eje.tipo, 'version');
    assert.equal(m.eje.param, 'version');
    assert.deepEqual(m.eje.valores, ['19', '18']);
    assert.equal(m.eje.default, '19');
    // Los valores declarados por la config, además de los presentes: un valor
    // declarado que no aparece no tiene docu o su fetch falló.
    assert.deepEqual(m.eje.declarados.map((v) => v.id), ['19', '18']);
    assert.deepEqual(m.metadata, { modules: true });
    assert.equal(m.audiencia, 'publico');
    assert.equal(m.buildId, '2026-08-20T09:00:00.000Z');
  });
});

// ═════════════════════════════════════════════════════════ eje = project

describe('eje project — atribución entre corpus', () => {
  before(() => usarFixture('eje-project'));

  it('el id de un artículo es project::slug', () => {
    const idx = indice();
    assert.ok(idx.porId.has('adhoc-way::index'));
    assert.ok(idx.porId.has('oba::index'));
    // El mismo nombre de archivo en tres projects son tres artículos, no uno.
    assert.equal(idx.porSlug.get('index').length, 3);
  });

  it('lista los projects en orden alfabético, sin inventar un default', () => {
    const m = mapa();
    assert.equal(m.eje.tipo, 'project');
    assert.deepEqual(m.eje.valores, ['adhoc-way', 'oba', 'odumbo']);
    // Sin `eje.default` declarado no se emite ninguno: la ausencia es la
    // decisión, no un olvido.
    assert.equal('default' in m.eje, false);
    assert.deepEqual(m.eje.declarados.map((p) => p.id), ['adhoc-way', 'oba', 'odumbo']);
  });

  it('no hay rastro de `modules`: era metadata de otro corpus', () => {
    const r = buscar({ q: 'devcontainer' });
    for (const hit of r.resultados) assert.equal('modules' in hit, false);
    assert.equal('modules' in r.filtros, false);
    assert.equal('modules' in leer({ slug: 'flujo/pr-flow' }), false);
  });

  it('sin filtro, avisa que los resultados vienen de varios projects', () => {
    const r = buscar({ q: 'devcontainer' });
    assert.deepEqual([...new Set(r.resultados.map((h) => h.project))].sort(), ['oba', 'odumbo']);
    assert.match(r.aviso, /2 projects distintos \(oba, odumbo\)/);
  });

  it('con un solo project en los resultados no mete aviso de mezcla', () => {
    const r = buscar({ q: 'spec' });
    assert.ok(r.total >= 1);
    assert.equal(r.aviso, undefined);
  });

  it('el filtro `project` es duro, y acepta varios más sección', () => {
    const uno = buscar({ q: 'devcontainer', project: 'oba' });
    assert.deepEqual(uno.filtros.project, ['oba']);
    for (const h of uno.resultados) assert.equal(h.project, 'oba');

    const varios = buscar({ q: 'entorno', project: ['oba', 'odumbo'], seccion: 'arquitectura' });
    assert.equal(varios.total, 1);
    assert.equal(varios.resultados[0].project, 'odumbo');
  });

  it('cero por el filtro de project: el hint nombra de dónde salen los otros', () => {
    const r = buscar({ q: 'filestore', project: 'odumbo' });
    assert.equal(r.total, 0);
    const hint = r.sugerencias.find((s) => s.includes('`project`'));
    assert.ok(hint, `esperaba un hint sobre el filtro project, hubo: ${r.sugerencias}`);
    assert.match(hint, /son de otro\(s\) project\(s\): oba/);
    assert.match(hint, /NO sirve como respuesta sobre odumbo/);
  });

  it('busca en el CUERPO y normaliza tildes', () => {
    const r = buscar({ q: 'filestore volumen' });
    assert.equal(r.resultados[0].slug, 'instalacion/entorno-de-desarrollo');
    assert.equal(buscar({ q: 'publicación' }).total, buscar({ q: 'publicacion' }).total);
  });

  it('leer() sin project sobre un slug ambiguo NO elige: devuelve la ambigüedad', () => {
    const a = leer({ slug: 'index' });
    assert.equal(a.encontrado, false);
    assert.equal(a.motivo, 'ambiguo-en-eje');
    assert.deepEqual(a.projectsDisponibles, ['adhoc-way', 'oba', 'odumbo']);
    assert.match(a.mensaje, /No elijo por mi cuenta/);
    assert.match(a.siguientePaso, /leer\(\{ slug: "index", project:/);
  });

  it('leer() por slug único no pide project, y trae label y type', () => {
    const a = leer({ slug: 'flujo/pr-flow' });
    assert.equal(a.encontrado, true);
    assert.equal(a.project, 'adhoc-way');
    assert.equal(a.projectLabel, 'Adhoc Way');
    assert.equal(a.type, 'procedimiento');
    assert.equal(a.url, 'https://docs.ejemplo.ar/adhoc-way/flujo/pr-flow');
  });

  it('leer() con project que no tiene ese slug no devuelve el de otro', () => {
    const a = leer({ slug: 'flujo/pr-flow', project: 'oba' });
    assert.equal(a.encontrado, false);
    assert.equal(a.motivo, 'slug-fuera-del-valor-pedido');
    assert.deepEqual(a.projectsDisponibles, ['adhoc-way']);
    assert.match(a.mensaje, /El project pedido manda/);
  });

  it('leer() por slug + project trae los otros projects con el mismo slug', () => {
    const a = leer({ slug: 'index', project: 'odumbo' });
    assert.equal(a.encontrado, true);
    // `otrosDelEje` es UN nombre para los dos ejes: la semántica ("otra
    // versión de lo mismo" vs "otro documento que comparte nombre de archivo")
    // la da `eje.tipo`, que ya viaja en la cabecera del índice.
    assert.deepEqual(a.otrosDelEje.map((o) => o.valor), ['adhoc-way', 'oba']);
  });

  it('sin comodín: un artículo no puede ser "de todos los projects"', () => {
    assert.equal(indice().eje.comodin, false);
  });

  it('los fixes del motor valen también con este eje: fallback OR con nota', () => {
    const r = buscar({ q: 'quiero el devcontainer y también la spec del ciclo de vida' });
    assert.equal(r.modo, 'or-fallback');
    assert.match(r.nota, /Ningún artículo contiene TODOS los términos/);
  });

  it('los fixes del motor valen también con este eje: query 100% relleno', () => {
    const r = buscar({ q: 'quiero saber cómo hago para' });
    assert.equal(r.total, 0);
    assert.ok(r.sugerencias.some((s) => /palabras vacías/.test(s)));
  });
});

describe('eje project CON default — la regla única, sin `if` por tipo de eje', () => {
  before(() => usarFixture('eje-project-con-default'));

  it('el mismo eje que no elegía elige cuando el config declara a quién, y lo dice', () => {
    // Es la prueba de que la política no depende del tipo de eje sino de la
    // PRESENCIA de `eje.default`: mismo corpus, mismo motor, un campo más.
    const a = leer({ slug: 'index' });
    assert.equal(a.encontrado, true);
    assert.equal(a.project, 'oba');
    assert.equal(a.elegidoPor, 'default');
    assert.deepEqual(a.otrosDelEje.map((o) => o.valor), ['adhoc-way', 'odumbo']);
  });

  it('el default no se mete donde el eje sí vino pedido', () => {
    const a = leer({ slug: 'index', project: 'odumbo' });
    assert.equal(a.project, 'odumbo');
    assert.equal(a.elegidoPor, undefined);
  });
});

// ════════════════════════════════════════════════════════════ eje = none

describe('eje none — el corpus sin eje (odumbo)', () => {
  before(() => usarFixture('eje-none'));

  it('el id es el slug pelado y no hay campo de eje en los hits', () => {
    const idx = indice();
    // El id lo emite el build: sin eje, el prefijo es `*`.
    assert.ok(idx.porId.has('*::manual/sla/plazos-de-respuesta'));
    const r = buscar({ q: 'plazos' });
    assert.ok(r.total >= 1);
    assert.equal('version' in r.resultados[0], false);
    assert.equal('project' in r.resultados[0], false);
  });

  it('no ofrece filtros que devolverían siempre cero', () => {
    const r = buscar({ q: 'plazos' });
    assert.deepEqual(Object.keys(r.filtros), ['seccion']);
  });

  it('mapa() no emite valores ni default: sin eje no falta nada', () => {
    const m = mapa();
    assert.deepEqual(m.eje, { tipo: 'none' });
    assert.equal('valores' in m.eje, false);
    assert.equal('default' in m.eje, false);
    assert.equal(m.articulos, 3);
  });

  it('el filtro de sección sigue siendo duro', () => {
    const r = buscar({ q: 'ticket', seccion: 'manual' });
    assert.equal(r.total, 0);
    const conLaSeccionBuena = buscar({ q: 'ticket', seccion: 'guias' });
    assert.equal(conLaSeccionBuena.resultados[0].slug, 'manual/tickets/como-abrir-un-ticket');
  });

  it('leer() por slug, sin eje que pedir', () => {
    const a = leer({ slug: 'manual/sla/que-es-un-sla' });
    assert.equal(a.encontrado, true);
    assert.equal(a.url, 'https://docs.ejemplo.ar/manual/sla/que-es-un-sla');
    assert.equal('otrosDelEje' in a, false);
  });

  it('los fixes del motor valen también sin eje: fallback OR', () => {
    const r = buscar({ q: 'quiero los plazos del sla y cómo abrir un ticket' });
    assert.equal(r.modo, 'or-fallback');
    assert.ok(r.total >= 2);
  });
});

// ═══════════════════════════ calidad de búsqueda (port de busqueda-calidad)

describe('calidad de búsqueda por tipo de query', () => {
  before(() => usarFixture('eje-version'));

  it('nombre de campo: cae en el artículo que lo documenta', () => {
    const r = buscar({ q: 'extracto bancario', version: '19' });
    assert.equal(r.resultados[0].slug, 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria');
  });

  it('pregunta en lenguaje natural: la que llega por ticket', () => {
    const r = buscar({ q: 'cómo hago para que una factura quede como pagada', version: '19' });
    assert.equal(r.resultados[0].slug, 'manual/finanzas/cobros-y-pagos/registrar-un-cobro');
  });

  it('scope por eje: ningún resultado de otra versión se cuela', () => {
    for (const q of ['extracto bancario', 'nota de crédito', 'cae afip']) {
      const r = buscar({ q, version: '19' });
      for (const h of r.resultados) {
        if (h.version != null) assert.equal(String(h.version), '19', `${q} → ${h.slug}`);
      }
    }
  });

  it('término solo interno: el índice público no lo tiene, ni por casualidad', () => {
    // El artículo de troubleshooting existe SOLO en el build interno: el
    // término no puede aparecer acá, ni por el fallback OR.
    const r = buscar({ q: 'timeout' });
    assert.equal(r.total, 0);
  });
});

describe('calidad de búsqueda — el mismo término en el índice interno', () => {
  before(() => usarFixture('eje-version-interno'));

  it('el equipo sí encuentra su propio contenido interno', () => {
    const r = buscar({ q: 'timeout' });
    assert.ok(r.total >= 1);
    assert.equal(r.resultados[0].slug, 'manual/finanzas/facturacion/solucion-de-problemas');
    assert.equal(mapa().audiencia, 'interno');
  });

  it('mensaje de error literal: el troubleshooting primero', () => {
    const r = buscar({ q: 'da timeout el webservice', version: '19' });
    assert.equal(r.resultados[0].slug, 'manual/finanzas/facturacion/solucion-de-problemas');
  });
});
