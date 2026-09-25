/**
 * `fragmento` / `ancla` / `urlAncla` en los hits de `buscar()`, y
 * `mapa({ seccion })`. `node --test fragmento-y-mapa.test.mjs`.
 *
 * Las dos cosas son aditivas y los tests fijan eso primero: `mapa()` sin
 * parámetro se compara contra la salida de v0.16.0 guardada en
 * `fixtures/mapa-v0.16.0.snapshot.json`, generada con el código de esa versión
 * antes de tocarlo. Si ese test falla, se rompió el contrato de alguien que no
 * pidió nada nuevo.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, indice, LARGO_FRAGMENTO, mapa } = await import('../lib/mcp/indice.mjs');

function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const hitDe = (r, slug) => r.resultados.find((h) => h.slug === slug);

describe('buscar() — fragmento y ancla de cada hit', () => {
  it('tilde y plural en la consulta: encuentra el término como lo compara el motor', () => {
    // `alícuotas` (tilde + plural) contra `alícuota` en el cuerpo, y
    // `conciliación` (singular) contra `conciliaciones`.
    usarFixture('fragmentos');
    const hit = hitDe(buscar({ q: 'alícuotas conciliación' }), 'manual/impuestos/percepciones');
    assert.ok(hit, 'el artículo tiene que venir');
    assert.match(hit.fragmento, /alícuota/);
    assert.match(hit.fragmento, /conciliaciones/);
  });

  it('el ancla es el heading bajo el que cae el fragmento, no el primero', () => {
    usarFixture('fragmentos');
    const hit = hitDe(buscar({ q: 'alicuota' }), 'manual/impuestos/percepciones');
    assert.deepEqual(hit.ancla, { id: 'calculo', text: 'Cálculo automático' });
    assert.equal(hit.urlAncla, 'https://docs.ejemplo.ar/manual/impuestos/percepciones#calculo');
  });

  it('sin markdown ruidoso: fuera los `**` y el link queda en su texto', () => {
    usarFixture('fragmentos');
    const { fragmento } = hitDe(buscar({ q: 'alicuota' }), 'manual/impuestos/percepciones');
    assert.doesNotMatch(fragmento, /\*\*|\]\(|\/manual\/padron/);
    assert.match(fragmento, /según el padrón de ARBA y guarda/);
  });

  it('el match sólo en el título: fragmento, ancla y urlAncla en null', () => {
    usarFixture('fragmentos');
    const hit = hitDe(buscar({ q: 'reembolsos' }), 'recursos/reembolsos');
    assert.ok(hit);
    assert.equal(hit.fragmento, null);
    assert.equal(hit.ancla, null);
    assert.equal(hit.urlAncla, null);
  });

  it('antes del primer heading: hay fragmento pero no ancla', () => {
    usarFixture('fragmentos');
    const hit = hitDe(buscar({ q: 'actualiza padron' }), 'recursos/glosario');
    assert.equal(hit.fragmento, 'El padrón se actualiza cada mes.');
    assert.equal(hit.ancla, null);
    assert.equal(hit.urlAncla, null);
  });

  it(`cuerpo largo: ≤ ${LARGO_FRAGMENTO} caracteres, "…" en los dos bordes y cortes en límite de palabra`, () => {
    usarFixture('fragmentos');
    const { fragmento } = hitDe(buscar({ q: 'cheques rechazados' }), 'manual/impuestos/retenciones');
    assert.ok(fragmento.length <= LARGO_FRAGMENTO, `mide ${fragmento.length}`);
    assert.ok(fragmento.startsWith('…') && fragmento.endsWith('…'), fragmento);
    assert.match(fragmento, /cheque rechazado/);
    // Límite de palabra: el recorte, sin los "…", tiene que estar en el texto
    // con un espacio (o un borde) a cada lado.
    const cuerpo = indice().porId.get('*::manual/impuestos/retenciones').body.replace(/\s+/g, ' ');
    const medio = fragmento.slice(1, -1);
    const i = cuerpo.indexOf(medio);
    assert.ok(i > 0, 'el fragmento sale del cuerpo tal cual');
    assert.equal(cuerpo[i - 1], ' ');
    assert.equal(cuerpo[i + medio.length], ' ');
  });

  it('sin cuerpo en el índice (`conCuerpo` no es true): los tres campos en null', () => {
    usarFixture('fragmentos');
    delete indice().build.conCuerpo;
    const r = buscar({ q: 'alicuota' });
    assert.ok(r.resultados.length > 0);
    for (const h of r.resultados) {
      assert.deepEqual([h.fragmento, h.ancla, h.urlAncla], [null, null, null]);
    }
  });

  it('aditivo: los campos de siempre siguen, y los nuevos vienen en todos los hits', () => {
    usarFixture('fragmentos');
    for (const h of buscar({ q: 'padron' }).resultados) {
      for (const campo of ['slug', 'title', 'description', 'url', 'seccion', 'headings', 'score']) {
        assert.ok(campo in h, `falta ${campo}`);
      }
      for (const campo of ['fragmento', 'ancla', 'urlAncla']) assert.ok(campo in h, `falta ${campo}`);
    }
  });
});

describe('mapa({ seccion })', () => {
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/mapa-v0.16.0.snapshot.json', import.meta.url), 'utf8'));

  for (const nombre of Object.keys(snapshot)) {
    it(`sin parámetro, idéntico a v0.16.0 (${nombre})`, () => {
      usarFixture(nombre);
      assert.deepEqual(mapa(), snapshot[nombre]);
      assert.deepEqual(mapa({}), snapshot[nombre]);
    });
  }

  it('con sección: la cabecera de siempre y los artículos en el orden del índice', () => {
    usarFixture('fragmentos');
    const m = mapa({ seccion: 'manual' });
    assert.equal(m.seccion, 'manual');
    assert.equal(m.buildId, '2026-09-25T12:00:00.000Z');
    assert.equal(m.audiencia, 'publico');
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.mapa, undefined, 'el árbol no viaja: para eso está la llamada sin parámetro');
    assert.deepEqual(m.articulos, [
      {
        slug: 'manual/impuestos/percepciones',
        title: 'Percepciones',
        description: 'El circuito de las percepciones.',
        categoria: 'impuestos',
        url: 'https://docs.ejemplo.ar/manual/impuestos/percepciones',
      },
      {
        slug: 'manual/impuestos/retenciones',
        title: 'Retenciones',
        description: 'Cómo se calculan.',
        categoria: 'impuestos',
        url: 'https://docs.ejemplo.ar/manual/impuestos/retenciones',
      },
    ]);
  });

  it('sección sin categoría: `categoria` vacía, como en los nodos del mapa', () => {
    usarFixture('fragmentos');
    assert.deepEqual(
      mapa({ seccion: 'recursos' }).articulos.map((a) => [a.slug, a.categoria]),
      [['recursos/reembolsos', ''], ['recursos/glosario', '']],
    );
  });

  it('con eje: cada artículo trae su valor, para que el mismo slug no parezca duplicado', () => {
    usarFixture('eje-version');
    const { articulos } = mapa({ seccion: 'manual' });
    assert.ok(articulos.length > 0);
    for (const a of articulos) assert.ok('version' in a);
  });

  it('sección inexistente: `articulos: []` y las válidas en `sugerencias`, la más parecida primero', () => {
    usarFixture('fragmentos');
    const m = mapa({ seccion: 'recurso' });
    assert.deepEqual(m.articulos, []);
    assert.equal(m.motivo, 'seccion-inexistente');
    assert.match(m.mensaje, /recurso/);
    assert.deepEqual(m.sugerencias, ['recursos', 'manual']);
  });
});

// ─────────────────────────────────── índices armados en el test (casos límite)

const { _bloquesDelCuerpo, PAGINA_MAPA } = await import('../lib/mcp/indice.mjs');
const { mkdtempSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');

const carpeta = mkdtempSync(join(tmpdir(), 'fragmento-y-mapa-'));
let armados = 0;

/** Un índice eje `none` con cuerpo, escrito a un archivo temporal. */
function usarIndice(articulos) {
  const ruta = join(carpeta, `indice-${armados++}.json`);
  const completos = articulos.map((a) => ({
    id: `*::${a.slug}`,
    eje: null,
    title: a.slug,
    description: '',
    seccion: a.slug.split('/')[0],
    url: `/${a.slug}`,
    keywords: [],
    headings: [],
    ...a,
  }));
  const build = { audiencia: 'publico', generatedAt: 'x', articulos: completos.length, conCuerpo: true, eje: { tipo: 'none' }, metadata: {} };
  writeFileSync(ruta, JSON.stringify({ schemaVersion: 1, build, mapa: [], articulos: completos }));
  process.env.DOCS_INDICE_PATH = ruta;
  _resetIndice();
  indice();
}

function cronometrar(fn) {
  const t0 = performance.now();
  const r = fn();
  return { r, ms: performance.now() - t0 };
}

const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('buscar() — casos límite del fragmento', () => {
  for (const [nombre, relleno] of [
    ['`[` sin cerrar', '['],
    ['`![a` sin cerrar', '![a '],
    ['`[a](` sin cerrar', '[a]('],
    ['`<a` sin cerrar', '<a'],
  ]) {
    it(`una línea con 20k ${nombre} no es cuadrática (< 200 ms)`, () => {
      usarIndice([{ slug: 'm/c/a', body: `factura ${relleno.repeat(20_000)}` }]);
      const { r, ms } = cronometrar(() => buscar({ q: 'factura' }));
      assert.ok(ms < 200, `tardó ${ms.toFixed(0)} ms`);
      assert.match(r.resultados[0].fragmento, /factura/);
    });
  }

  it('un término que aparece 10k veces: la ventana no es O(k²) (< 200 ms)', () => {
    usarIndice([{ slug: 'm/c/a', body: 'factura cliente '.repeat(10_000) }]);
    const { r, ms } = cronometrar(() => buscar({ q: 'factura cliente' }));
    assert.ok(ms < 200, `tardó ${ms.toFixed(0)} ms`);
    assert.match(r.resultados[0].fragmento, /factura cliente/);
  });

  it('los bloques de un artículo se calculan una vez por índice', () => {
    usarIndice([{ slug: 'm/c/a', body: '## Uno\n\nfactura' }]);
    const articulo = indice().porId.get('*::m/c/a');
    const bloques = _bloquesDelCuerpo(articulo);
    assert.equal(_bloquesDelCuerpo(articulo), bloques);
    buscar({ q: 'factura' });
    assert.equal(_bloquesDelCuerpo(articulo), bloques);
  });

  it('un tramo largo sin espacios antes del término: el fragmento lo contiene igual', () => {
    usarIndice([
      { slug: 'm/c/antes', body: `${'x'.repeat(3000)} zanahoria ${'y'.repeat(3000)}` },
      { slug: 'm/c/pegado', body: `${'x'.repeat(5000)} zanahoria final.` },
    ]);
    for (const h of buscar({ q: 'zanahoria' }).resultados) {
      assert.match(h.fragmento, /zanahoria/, h.slug);
      assert.ok(h.fragmento.length <= LARGO_FRAGMENTO, `${h.slug} mide ${h.fragmento.length}`);
    }
  });

  it('nunca corta un par surrogate', () => {
    usarIndice([{ slug: 'm/c/emoji', body: `${'😀'.repeat(500)} berenjena ${'😀'.repeat(500)}` }]);
    const { fragmento } = buscar({ q: 'berenjena' }).resultados[0];
    assert.match(fragmento, /berenjena/);
    assert.doesNotMatch(fragmento, SURROGATE_SUELTO);
    assert.ok(fragmento.length <= LARGO_FRAGMENTO, `mide ${fragmento.length}`);
  });

  it('la ventana que se puntúa es la que se devuelve', () => {
    // La ventana de `alfa` junta los dos términos. Antes se puntuaba una y se
    // devolvía otra: sin espacio cerca del borde, la devuelta arrancaba en 0 y
    // dejaba `beta` afuera.
    usarIndice([{ slug: 'm/c/a', body: `${'z'.repeat(100)} alfa ${'y'.repeat(200)} beta ${'x'.repeat(1000)}` }]);
    const { fragmento } = buscar({ q: 'alfa beta' }).resultados[0];
    assert.match(fragmento, /alfa/);
    assert.match(fragmento, /beta/);
  });
});

describe('mapa({ seccion, page })', () => {
  const muchos = Array.from({ length: 120 }, (_, i) => ({ slug: `grande/c/a${String(i).padStart(3, '0')}`, body: 'x' }));

  it(`pagina de a ${PAGINA_MAPA}, con total, page, paginas y hayMas`, () => {
    usarIndice(muchos);
    const p1 = mapa({ seccion: 'grande' });
    assert.deepEqual([p1.total, p1.page, p1.paginas, p1.hayMas, p1.articulos.length], [120, 1, 3, true, PAGINA_MAPA]);
    assert.equal(p1.articulos[0].slug, 'grande/c/a000');
    const p3 = mapa({ seccion: 'grande', page: 3 });
    assert.deepEqual([p3.total, p3.page, p3.paginas, p3.hayMas, p3.articulos.length], [120, 3, 3, false, 20]);
    assert.equal(p3.articulos[0].slug, 'grande/c/a100');
  });

  it('page inválida se lee como 1, igual que en buscar()', () => {
    usarIndice(muchos);
    for (const page of ['x', 0, -2, null]) assert.equal(mapa({ seccion: 'grande', page }).page, 1, String(page));
    assert.equal(mapa({ seccion: 'grande', page: '2' }).page, 2);
  });

  it('con eje y sin valor pedido: sólo el default, y lo anuncia', () => {
    usarFixture('eje-version');
    const m = mapa({ seccion: 'manual' });
    assert.equal(m.version, '19');
    assert.equal(m.elegidoPor, 'default');
    assert.ok(m.articulos.length > 0);
    for (const a of m.articulos) assert.ok(a.version === '19' || a.version == null, a.slug);
    const slugs = m.articulos.map((a) => a.slug);
    assert.equal(new Set(slugs).size, slugs.length, 'ningún slug repetido');
  });

  it('con eje y valor pedido: ese valor, sin `elegidoPor`', () => {
    usarFixture('eje-version');
    const m = mapa({ seccion: 'manual', version: '18' });
    assert.equal(m.version, '18');
    assert.equal(m.elegidoPor, undefined);
    assert.ok(m.articulos.length > 0);
    for (const a of m.articulos) assert.ok(a.version === '18' || a.version == null, a.slug);
  });

  it('eje sin default y sin valor pedido: lista todos, cada uno con su valor', () => {
    usarFixture('eje-project');
    const todos = indice().articulos.filter((a) => a.seccion === 'flujo').length;
    const m = mapa({ seccion: 'flujo' });
    assert.equal(m.total, todos);
    assert.equal(m.elegidoPor, undefined);
  });
});
