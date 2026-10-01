/**
 * La superficie para agentes de v0.21.0 en el motor: `leer()` por ancla, los
 * headings recortados de cada hit y la página de `buscar()`.
 * `node --test superficie-agentes.test.mjs`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, HEADINGS_POR_HIT, leer, PAGINA_BUSCAR } = await import('../lib/mcp/indice.mjs');

function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const SLUG = 'manual/bancos/conciliacion';

describe('leer({ slug, ancla })', () => {
  it('devuelve sólo la sección: del heading al siguiente de igual o mayor nivel', () => {
    usarFixture('superficie');
    const r = leer({ slug: SLUG, ancla: 'configurar-el-banco' });
    assert.equal(r.encontrado, true);
    assert.equal(r.title, 'Conciliación bancaria');
    assert.equal(r.url, `https://docs.ejemplo.ar/${SLUG}`);
    assert.equal(r.urlAncla, `https://docs.ejemplo.ar/${SLUG}#configurar-el-banco`);
    assert.deepEqual(r.ancla, { id: 'configurar-el-banco', text: 'Configurar el banco', level: 2 });
    assert.match(r.body, /^## Configurar el banco/);
    // Los h3 de adentro quedan; el `## ` dentro de un fence no corta.
    assert.match(r.body, /### Extractos[\s\S]*Se importan en OFX\./);
    assert.doesNotMatch(r.body, /## Conciliar/);
    assert.deepEqual(r.headings.map((h) => h.id), ['diarios', 'extractos']);
  });

  it('un h3 termina en el siguiente h3, y un h4 no corta a su h2', () => {
    usarFixture('superficie');
    assert.equal(leer({ slug: SLUG, ancla: 'diarios' }).body.trim(), [
      '### Diarios', '', 'Un diario por cuenta.', '', '```bash', '## esto es código, no un heading', '```',
    ].join('\n'));
    const conciliar = leer({ slug: SLUG, ancla: 'conciliar' });
    assert.match(conciliar.body, /Sigue dentro de Conciliar\./);
    assert.doesNotMatch(conciliar.body, /Cerrar el período/);
  });

  it('un h1 que el build no publica no corre las anclas; un texto distinto se aparea por orden', () => {
    usarFixture('superficie');
    // El cuerpo de `cheques` abre con `# Cheques`, que no está en sus headings,
    // y el segundo h3 tiene markdown que el build limpió distinto.
    assert.equal(leer({ slug: 'manual/bancos/cheques', ancla: 'uno' }).body, '### Uno\n\nCheque uno, tesoreria.');
    assert.match(leer({ slug: 'manual/bancos/cheques', ancla: 'dos' }).body, /^### Dos[\s\S]*Cheque dos\.$/);
  });

  it('la última sección va hasta el final del cuerpo', () => {
    usarFixture('superficie');
    assert.equal(leer({ slug: SLUG, ancla: 'cerrar-el-periodo' }).body, '## Cerrar el período\n\nSe bloquea la fecha.');
  });

  it('acepta `#id` y la `urlAncla` entera', () => {
    usarFixture('superficie');
    assert.equal(leer({ slug: SLUG, ancla: '#conciliar' }).ancla.id, 'conciliar');
    assert.equal(leer({ slug: SLUG, ancla: `https://docs.ejemplo.ar/${SLUG}#conciliar` }).ancla.id, 'conciliar');
  });

  it('ancla inexistente: no es error, trae las anclas que hay y cómo seguir', () => {
    usarFixture('superficie');
    const r = leer({ slug: SLUG, ancla: 'no-existe' });
    assert.equal(r.encontrado, false);
    assert.equal(r.motivo, 'ancla-inexistente');
    assert.equal(r.slug, SLUG);
    assert.equal(r.url, `https://docs.ejemplo.ar/${SLUG}`);
    assert.deepEqual(r.anclas.map((h) => h.id), ['configurar-el-banco', 'diarios', 'extractos', 'conciliar', 'detalle-fino', 'cerrar-el-periodo']);
    assert.equal(r.siguientePaso, `leer({ slug: "${SLUG}" })`);
    assert.equal('body' in r, false);
  });

  it('un fence cierra sólo con su mismo carácter y un largo igual o mayor', () => {
    usarFixture('superficie');
    // ```` encierra un ``` y un `## B` que es código.
    const largo = leer({ slug: 'bordes/fence-largo', ancla: 'a' });
    assert.match(largo.body, /texto de A$/);
    assert.equal(leer({ slug: 'bordes/fence-largo', ancla: 'b' }).body, '## B\n\ntexto de B');
    // ~~~ encierra un ``` que no lo cierra.
    assert.match(leer({ slug: 'bordes/fence-mezclado', ancla: 'a' }).body, /sigue A$/);
    assert.equal(leer({ slug: 'bordes/fence-mezclado', ancla: 'b' }).body, '## B\n\ntexto de B');
  });

  it('un `## ` sin texto no es heading: no corta la sección ni corre las anclas', () => {
    usarFixture('superficie');
    assert.match(leer({ slug: 'bordes/heading-vacio', ancla: 'a' }).body, /sigue A$/);
    assert.equal(leer({ slug: 'bordes/heading-vacio', ancla: 'b' }).body, '## B\n\nbb');
  });

  it('ancla inexistente en otro idioma: dice a qué traducción saltó', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'casos/deuda-clientes', idioma: 'en', ancla: 'qué-clientes-deben' });
    assert.equal(r.motivo, 'ancla-inexistente');
    assert.equal(r.slug, 'use-cases/customer-debt');
    assert.equal(r.idioma, 'en');
    assert.equal(r.idiomaElegidoPor, 'traduccion');
    assert.match(r.mensajeIdioma, /traducción/);
    assert.deepEqual(r.anclas.map((h) => h.id), ['which-customers-owe']);
    assert.equal(r.siguientePaso, 'leer({ slug: "use-cases/customer-debt", idioma: "en" })');
  });

  it('ancla inexistente con eje: trae el valor elegido y lo anuncia', () => {
    usarFixture('eje-version');
    const r = leer({ slug: 'manual/finanzas/facturacion/notas-de-credito', ancla: 'no-existe' });
    assert.equal(r.motivo, 'ancla-inexistente');
    assert.equal(r.version, '19');
    assert.equal(r.elegidoPor, 'default');
    assert.match(r.mensaje, /19[\s\S]*no tiene un heading con el ancla "no-existe"/);
    assert.equal(r.siguientePaso, 'leer({ slug: "manual/finanzas/facturacion/notas-de-credito", version: "19" })');
  });

  it('el aviso de la sección no aislada convive con el del valor por defecto', () => {
    // Un heading publicado que el cuerpo no tiene, en un artículo que se elige por default.
    const f = JSON.parse(readFileSync(new URL('./fixtures/eje-version.json', import.meta.url), 'utf8'));
    const art = f.articulos.find((a) => a.slug === 'manual/finanzas/facturacion/notas-de-credito' && a.eje === '19');
    art.headings.push({ id: 'fantasma', text: 'Fantasma', level: 2 });
    const ruta = join(mkdtempSync(join(tmpdir(), 'superficie-')), 'index.json');
    writeFileSync(ruta, JSON.stringify(f));
    process.env.DOCS_INDICE_PATH = ruta;
    _resetIndice();
    const r = leer({ slug: art.slug, ancla: 'fantasma' });
    assert.equal(r.elegidoPor, 'default');
    assert.equal(r.urlAncla.endsWith('#fantasma'), true);
    assert.match(r.mensaje, /19/);
    assert.match(r.mensaje, /No pude aislar la sección "Fantasma"/);
  });

  it('sin ancla, el artículo entero como siempre', () => {
    usarFixture('superficie');
    const r = leer({ slug: SLUG });
    assert.equal(r.headings.length, 7);
    assert.match(r.body, /Intro del circuito[\s\S]*Se bloquea la fecha/);
    assert.equal('ancla' in r, false);
    assert.equal('urlAncla' in r, false);
    assert.deepEqual(leer({ slug: SLUG, ancla: '' }), r);
  });
});

describe('buscar() — respuesta liviana', () => {
  it(`página de ${PAGINA_BUSCAR} hits`, () => {
    usarFixture('superficie');
    const p1 = buscar({ q: 'tesoreria' });
    assert.equal(p1.resultados.length, PAGINA_BUSCAR);
    assert.equal(p1.hayMas, true);
    const p2 = buscar({ q: 'tesoreria', page: 2 });
    assert.equal(p1.total, PAGINA_BUSCAR + p2.resultados.length);
  });

  it(`cada hit trae los headings del primer nivel bajo el título, hasta ${HEADINGS_POR_HIT}`, () => {
    usarFixture('superficie');
    const hits = buscar({ q: 'tesoreria' }).resultados;
    const muchos = hits.find((h) => h.slug === 'manual/bancos/tesoreria');
    assert.equal(muchos.headings.length, HEADINGS_POR_HIT);
    assert.ok(muchos.headings.every((h) => h.level === 2));
    // 11 h2 + 11 h3: los que no vienen se cuentan.
    assert.equal(muchos.headingsOmitidos, 22 - HEADINGS_POR_HIT);
    // Sin h2, los h3; y sin nada que omitir, sin el campo.
    const cheques = hits.find((h) => h.slug === 'manual/bancos/cheques');
    assert.deepEqual(cheques.headings.map((h) => h.id), ['uno', 'dos']);
    assert.equal('headingsOmitidos' in cheques, false);
  });

  it('el h1 que repite el título no viaja en el hit', () => {
    usarFixture('superficie');
    const hit = buscar({ q: 'ofx' }).resultados.find((h) => h.slug === SLUG);
    assert.deepEqual(hit.headings.map((h) => h.id), ['configurar-el-banco', 'conciliar', 'cerrar-el-periodo']);
    assert.equal(hit.headingsOmitidos, 3);
    // El ancla del fragmento puede ser un h3 que no está en `headings`: viaja aparte.
    assert.equal(hit.ancla.id, 'extractos');
  });
});
