/**
 * Ranking de `buscar()` (v0.19.0): prefijo sólo para términos de 4+ letras,
 * campo aparte de raíces para la flexión del castellano, cobertura pesada por
 * idf en el relleno OR y la señal de resultados débiles. `node --test`.
 *
 * Lo que se mide acá es el MOTOR sobre el fixture chico; la ganancia sobre los
 * corpus reales se midió con el banco (`bench/`).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const { _resetIndice, buscar, COBERTURA_DEBIL, LARGO_MINIMO_PREFIJO, PERFIL, raizDe } = await import('../lib/mcp/indice.mjs');

function usarFixture(nombre) {
  process.env.DOCS_INDICE_PATH = fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
  _resetIndice();
}

const slugs = (r) => r.resultados.map((h) => h.slug);

const carpeta = mkdtempSync(join(tmpdir(), 'ranking-'));
let armados = 0;

/** Un índice eje `none` sintético, escrito a un archivo temporal. */
function usarArticulos(articulos) {
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
    body: '',
    ...a,
  }));
  const build = { audiencia: 'publico', generatedAt: 'x', articulos: completos.length, conCuerpo: true, eje: { tipo: 'none' }, metadata: {} };
  writeFileSync(ruta, JSON.stringify({ schemaVersion: 1, build, mapa: [], articulos: completos }));
  process.env.DOCS_INDICE_PATH = ruta;
  _resetIndice();
}

const rellenos = (n, body = 'nada') => Array.from({ length: n }, (_, i) => ({ slug: `manual/relleno-${i}`, title: `Relleno ${i}`, body }));

describe('raizDe — flexión liviana, no un stemmer', () => {
  it('la conjugación y la derivación llegan a la misma raíz', () => {
    for (const grupo of [
      ['anulo', 'anular', 'anulacion', 'anulamos'],
      ['factura', 'facturas', 'facturar', 'facturamos', 'facturacion'],
      ['imputo', 'imputar', 'imputaciones'],
      ['usuario', 'usuarios'],
    ]) {
      const raices = new Set(grupo.map(raizDe));
      assert.equal(raices.size, 1, `${grupo.join(', ')} → ${[...raices].join(', ')}`);
    }
  });

  it('no toca términos cortos ni deja raíces de menos de 4 letras', () => {
    // "mes" → "me" o "pais" → "pai" son justo los fantasmas que hicieron
    // descartar un stemmer en v0.13.0.
    for (const termino of ['mes', 'pais', 'iva', 'cae', 'nota']) assert.equal(raizDe(termino), termino);
    for (const termino of ['meses', 'deseada', 'tienda', 'cobros']) assert.ok(raizDe(termino).length >= 4, termino);
  });

  it('"-is", "-us" y "-ss" no son plurales', () => {
    for (const termino of ['analisis', 'status', 'access']) assert.equal(raizDe(termino), termino);
  });
});

describe('flexión — la raíz suma recall sin ganarle a lo exacto', () => {
  before(() => usarFixture('eje-version'));

  it('un verbo conjugado encuentra el artículo, en modo `and`', () => {
    // Antes caían a or-fallback: "registre" no es prefijo de "registrar", ni
    // "concilie" de "conciliación", y "facturamos" daba cero.
    for (const [q, esperado] of [
      ['registré un cobro', 'manual/finanzas/cobros-y-pagos/registrar-un-cobro'],
      ['concilié el extracto', 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria'],
    ]) {
      const r = buscar({ q, version: '19' });
      assert.equal(r.modo, 'and', q);
      assert.equal(r.resultados[0].slug, esperado, q);
    }
    assert.ok(buscar({ q: 'facturamos', version: '19' }).total > 0);
  });

  it('dos términos con la misma raíz quedan cubiertos los dos por esa raíz', () => {
    // `registré` y `registramos` llegan a `registr`: el artículo que la tiene
    // cubre la consulta entera, no la mitad.
    const r = buscar({ q: 'registré registramos cobro', version: '19' });
    assert.equal(r.modo, 'and');
    assert.equal(r.resultados[0].slug, 'manual/finanzas/cobros-y-pagos/registrar-un-cobro');
  });

  it('las consultas exactas de siempre no cambian de primer resultado', () => {
    for (const [q, primero] of [
      ['nota de crédito', 'manual/finanzas/facturacion/notas-de-credito'],
      ['conciliación bancaria', 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria'],
      ['registrar un cobro', 'manual/finanzas/cobros-y-pagos/registrar-un-cobro'],
    ]) {
      const r = buscar({ q, version: '19' });
      assert.equal(r.modo, 'and', q);
      assert.equal(r.resultados[0].slug, primero, q);
    }
  });
});

describe('prefijo — sólo para términos de 4 letras o más', () => {
  before(() => usarFixture('eje-version'));

  it(`con ${LARGO_MINIMO_PREFIJO} letras el prefijo sigue buscando`, () => {
    assert.ok(slugs(buscar({ q: 'cobr', version: '19' })).includes('manual/finanzas/cobros-y-pagos/registrar-un-cobro'));
  });

  it('con menos, el término se busca entero: no expande a medio corpus', () => {
    // "i", "in", "do" expandían a cientos de palabras en oba-docs y sumaban
    // puntaje por cada una.
    assert.equal(buscar({ q: 'cob', version: '19' }).total, 0);
  });
});

describe('cobertura — el relleno OR pesa lo que cubre, no cuánto cubre', () => {
  before(() => usarFixture('eje-version'));

  it('cada hit trae `cobertura`: 1 en `and`', () => {
    const r = buscar({ q: 'factura', version: '19' });
    assert.equal(r.modo, 'and');
    for (const h of r.resultados) assert.equal(h.cobertura, 1);
  });

  it('en or-fallback está entre 0 y 1 y los hits vienen ordenados por puntaje', () => {
    const r = buscar({ q: 'el cliente pregunta por el débito automático y por el extracto del banco', version: '19' });
    assert.equal(r.modo, 'or-fallback');
    for (const h of r.resultados) assert.ok(h.cobertura > 0 && h.cobertura < 1, `${h.slug}: ${h.cobertura}`);
    const puntajes = r.resultados.map((h) => h.score);
    assert.deepEqual(puntajes, [...puntajes].sort((a, b) => b - a));
    assert.equal(r.resultados[0].slug, 'manual/finanzas/cobros-y-pagos/debito-automatico');
  });

  it('`terminosAusentes` lista lo que ningún artículo filtrado contiene', () => {
    const r = buscar({ q: 'el cliente pregunta por el débito automático y por el extracto del banco', version: '19' });
    assert.deepEqual(r.terminosAusentes, ['pregunta']);
    // En `and` no viene: todos los términos están.
    assert.equal(buscar({ q: 'factura', version: '19' }).terminosAusentes, undefined);
  });
});

describe('cobertura — el peso es el idf, no el conteo de términos', () => {
  it('un término raro cubierto le gana a dos comunes', () => {
    // Con peso uniforme (o con el multiplicador de MiniSearch, v0.18.0) gana
    // `generico`: tiene dos de los tres términos en el título. Con idf gana
    // `remito`, que tiene el único término que casi nadie tiene.
    usarArticulos([
      { slug: 'manual/generico', title: 'Pedido y cliente', body: 'El pedido del cliente.' },
      { slug: 'manual/remito', title: 'Remito electrónico', body: 'Cómo se configura el remito.' },
      ...rellenos(8, 'Otro pedido de otro cliente.'),
    ]);
    const r = buscar({ q: 'pedido cliente remito' });
    assert.equal(r.modo, 'or-fallback');
    assert.equal(r.resultados[0].slug, 'manual/remito');
    const [remito, generico] = ['manual/remito', 'manual/generico'].map((s) => r.resultados.find((h) => h.slug === s));
    assert.ok(remito.cobertura > 0.5 && generico.cobertura < 0.5, `${remito.cobertura} / ${generico.cobertura}`);
  });

  it('en or-fallback la cobertura publicada nunca redondea a 0 ni a 1', () => {
    // `rarisimo` pesa casi todo y `comunisimo` casi nada: sin el tope, uno se
    // vería 1 (como si cubriera todo) y el resto 0 (como si no cubriera nada).
    usarArticulos([{ slug: 'manual/raro', title: 'Raro', body: 'rarisimo' }, ...rellenos(199, 'comunisimo')]);
    const r = buscar({ q: 'rarisimo comunisimo' });
    assert.equal(r.modo, 'or-fallback');
    const coberturas = r.resultados.map((h) => h.cobertura);
    assert.equal(Math.max(...coberturas), 0.99);
    assert.equal(Math.min(...coberturas), 0.01);
  });
});

describe('cobertura — el término exacto y la raíz se acreditan juntos', () => {
  it('`orden ordenar` resuelve en `and` como `orden` y `ordenar` por separado', () => {
    // `orden` es el término exacto y también la raíz de `ordenar`: cubrirlo
    // cubre los dos.
    usarArticulos([{ slug: 'manual/orden', title: 'Orden' }, { slug: 'manual/otra', title: 'Otra cosa' }]);
    for (const q of ['orden', 'ordenar', 'orden ordenar']) {
      const r = buscar({ q });
      assert.equal(r.modo, 'and', q);
      assert.deepEqual(slugs(r), ['manual/orden'], q);
      assert.equal(r.resultados[0].cobertura, 1, q);
      assert.equal(r.terminosAusentes, undefined, q);
    }
  });
});

describe('cobertura — la raíz cubre sólo si coincidió en el campo de raíces', () => {
  it('un prefijo de la búsqueda normal no acredita la raíz de otro término', () => {
    // `orden` llega a «Ordenanza» por prefijo; `ordeno` (raíz `orden`) no
    // está en ningún lado. Antes el prefijo acreditaba también `ordeno`.
    usarArticulos([{ slug: 'manual/ordenanza', title: 'Ordenanza municipal' }, { slug: 'manual/otra', title: 'Otra cosa' }]);
    assert.equal(buscar({ q: 'ordeno' }).total, 0);
    const r = buscar({ q: 'orden ordeno' });
    assert.equal(r.modo, 'or-fallback');
    assert.deepEqual(r.terminosAusentes, ['ordeno']);
    assert.ok(r.resultados[0].cobertura < 1);
  });
});

describe('resultados débiles — mira la cobertura máxima y la que se ve', () => {
  it('no la declara si el que cubre lo central no es el 1º', () => {
    // `tornillos` está en el título de `tornillos` (puntaje alto) pero lo
    // tienen varios artículos y pesa poco; `arandela` la tiene sólo `arandela`,
    // en el cuerpo. El 1º cubre menos del umbral y el 2º no.
    usarArticulos([
      { slug: 'manual/tornillos', title: 'Tornillos', keywords: ['tornillos'], description: 'Tornillos', body: 'Tornillos y tornillos.' },
      { slug: 'manual/sueltos', title: 'Sueltos', body: 'tornillos sueltos' },
      { slug: 'manual/mas', title: 'Mas', body: 'mas tornillos' },
      { slug: 'manual/cajas', title: 'Cajas', body: 'cajas de tornillos' },
      { slug: 'manual/usos', title: 'Usos', body: 'usos de tornillos' },
      { slug: 'manual/arandela', title: 'Q', body: `${'palabra '.repeat(80)}arandela ${'otra '.repeat(80)}` },
      ...rellenos(4),
    ]);
    const r = buscar({ q: 'tornillos arandela zzqxw' });
    assert.equal(r.modo, 'or-fallback');
    assert.equal(r.resultados[0].slug, 'manual/tornillos');
    assert.ok(r.resultados[0].cobertura < COBERTURA_DEBIL);
    assert.ok(r.resultados.find((h) => h.slug === 'manual/arandela').cobertura >= COBERTURA_DEBIL);
    assert.equal(r.resultadosDebiles, undefined);
    assert.match(r.nota, /Ningún artículo contiene TODOS los términos/);
  });

  it('compara la cobertura redondeada que muestra el hit, no la cruda', () => {
    // La cobertura cruda de `b1` es 0,328: se muestra 0,33 y, con el umbral en
    // 0,33, no es débil. El fixture está hecho para ESE umbral.
    assert.equal(COBERTURA_DEBIL, 0.33);
    usarArticulos([
      { slug: 'manual/b1', title: 'Bulones', body: 'bulones' },
      { slug: 'manual/b2', title: 'Otros', body: 'bulones' },
      ...rellenos(11, 'tuercas'),
    ]);
    const r = buscar({ q: 'bulones tuercas zzqxw' });
    assert.equal(r.modo, 'or-fallback');
    assert.equal(r.resultados[0].cobertura, COBERTURA_DEBIL);
    assert.equal(r.resultadosDebiles, undefined);
  });

  it('la nota dice lo que mide: la cobertura del que más cubre', () => {
    usarFixture('eje-version');
    const r = buscar({ q: 'factura xyzzy qwerty plugh', version: '19' });
    const maxima = Math.max(...r.resultados.map((h) => h.cobertura));
    assert.match(r.nota, new RegExp(`el que más cubre llega al ${Math.round(maxima * 100)} %`));
  });
});

describe('hints — cuentan como `buscar()`', () => {
  before(() => usarFixture('eje-version'));

  it('"sacando el filtro" cuenta lo que encuentra la raíz', () => {
    // `concilié` llega a «Conciliación bancaria» sólo por la raíz: un AND
    // sin raíces daba cero y el hint no aparecía.
    for (const perfil of [PERFIL.agente, PERFIL.persona]) {
      const r = buscar({ q: 'concilié el extracto', version: '19', seccion: 'relacion', perfil });
      assert.equal(r.total, 0);
      assert.ok(
        r.sugerencias.some((s) => /Sacando el filtro `seccion` \(relacion\) hay 1 resultado/.test(s)),
        r.sugerencias.join(' | '),
      );
    }
  });
});

describe('resultados débiles — la señal de "no hay nada bueno"', () => {
  before(() => usarFixture('eje-version'));

  it('si ni el mejor hit cubre lo central, lo declara y dice qué falta', () => {
    const r = buscar({ q: 'factura xyzzy qwerty plugh', version: '19' });
    assert.equal(r.modo, 'or-fallback', 'el modo no cambia: la señal es aditiva');
    assert.equal(r.resultadosDebiles, true);
    assert.ok(r.resultados[0].cobertura < COBERTURA_DEBIL);
    assert.deepEqual(r.terminosAusentes, ['xyzzy', 'qwerty', 'plugh']);
    assert.match(r.nota, /Ningún artículo cubre lo central/);
    assert.match(r.nota, /«xyzzy», «qwerty», «plugh»/);
    // Los resultados siguen viniendo: la nota acompaña, no reemplaza.
    assert.ok(r.total > 0);
  });

  it('un relleno que cubre lo central conserva la nota de siempre', () => {
    const r = buscar({ q: 'el cliente pregunta por el débito automático y por el extracto del banco', version: '19' });
    assert.equal(r.resultadosDebiles, undefined);
    assert.match(r.nota, /Ningún artículo contiene TODOS los términos/);
  });

  it('en `and` nunca se declara débil', () => {
    assert.equal(buscar({ q: 'factura', version: '19' }).resultadosDebiles, undefined);
  });

  it('la persona no recibe relleno, así que tampoco la señal', () => {
    const r = buscar({ q: 'factura xyzzy qwerty plugh', version: '19', perfil: PERFIL.persona });
    assert.equal(r.resultadosDebiles, undefined);
    assert.equal(r.terminosAusentes, undefined);
  });
});

describe('consultas sin términos', () => {
  before(() => usarFixture('eje-version'));

  it('sin `q`, o con `q` vacía, no tira: cero resultados y el hint de la query vacía', () => {
    for (const args of [{}, { q: '' }, { q: null }]) {
      const r = buscar({ ...args, version: '19' });
      assert.equal(r.total, 0);
      assert.match(r.sugerencias[0], /ningún término con contenido/);
    }
  });

  it('una consulta de sólo palabras vacías tampoco busca', () => {
    const r = buscar({ q: 'cómo hago para que', version: '19' });
    assert.equal(r.total, 0);
    assert.equal(r.modo, 'and');
  });
});
