/**
 * Suite de los idiomas. `node --test tests/idiomas.test.mjs`.
 *
 * QUÉ PROTEGE. Un corpus puede venir en varios idiomas (`build.idiomas`,
 * schemaVersion 2), y el motor arma UN MiniSearch por idioma, cada uno con su
 * analizador. Las dos promesas que se rompen en silencio, y por eso viven acá:
 *
 *   1. Un índice SIN idiomas se comporta exactamente como antes: ni un campo
 *      más en las respuestas, ni un resultado distinto. El `idioma` que llegue
 *      como parámetro se ignora.
 *   2. El castellano de un índice bilingüe rankea IGUAL que un índice que sólo
 *      tuviera el castellano: mismos documentos, mismas opciones, mismas
 *      estadísticas de BM25. Si alguien "simplifica" a un índice combinado con
 *      filtro de idioma, este es el test que se cae.
 *
 * Y el guard de los motores viejos: un índice con idiomas sale en
 * schemaVersion 2, para que un motor que no sabe de idiomas lo rechace en vez de
 * mezclarlos con el analizador del castellano.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

process.env.DOCS_URL = 'https://docs.ejemplo.ar';

const {
  _resetIndice, ANALIZADORES, buscar, detectarIdioma, indice, leer, mapa, normalizarIdioma, opcionesDelIndice,
  politicaDeIdioma, procesarTermino, procesarTerminoEn, reducirPluralEn, STOPWORDS, terminosDe,
} = await import('../lib/mcp/indice.mjs');

const FIXTURE = fileURLToPath(new URL('./fixtures/idiomas.json', import.meta.url));
const crudo = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'idiomas-'));

function usarRuta(ruta) {
  process.env.DOCS_INDICE_PATH = ruta;
  _resetIndice();
}
function usarFixture(nombre) {
  usarRuta(fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url)));
}
/** Un índice escrito en el momento, a partir del fixture bilingüe. */
function usarVariante(nombre, cambiar) {
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify(cambiar(crudo())));
  usarRuta(ruta);
}

const slugs = (r) => r.resultados.map((h) => h.slug);

/**
 * Un índice bilingüe armado desde cero (schemaVersion 2), para los casos que
 * piden un eje o artículos que el fixture no tiene. Todo sintético.
 */
function usarBilingue(nombre, articulos, eje = { tipo: 'none' }) {
  const completos = articulos.map((a) => ({
    id: `${a.idioma}:${a.eje ?? '*'}::${a.slug}`,
    eje: null,
    title: a.slug,
    description: '',
    seccion: a.slug.split('/')[0],
    url: `/${a.idioma}/${a.slug}`,
    keywords: [],
    headings: [],
    body: '',
    ...a,
  }));
  const build = {
    audiencia: 'publico', generatedAt: 'x', articulos: completos.length, conCuerpo: true, eje, metadata: {},
    idiomas: { default: 'es', valores: [{ id: 'es', label: 'Español' }, { id: 'en', label: 'English' }] },
  };
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify({ schemaVersion: 2, build, mapa: [], articulos: completos }));
  usarRuta(ruta);
}

// ════════════════════════════════════════════════════════════ el analizador

describe('analizador inglés — mínimo, y el castellano no se toca', () => {
  it('las palabras vacías del inglés no se indexan', () => {
    for (const relleno of ['the', 'how', 'do', 'i', 'can', 'want', 'is', 's']) {
      assert.equal(procesarTerminoEn(relleno), null, relleno);
    }
  });

  it('las que también son del dominio quedan: `no`, `not`, `without`, `may`', () => {
    for (const termino of ['no', 'not', 'without', 'may']) assert.equal(procesarTerminoEn(termino), termino);
  });

  it('el plural va a la clave del singular, sin stemmer', () => {
    const pares = [
      ['invoices', 'invoice'], ['customers', 'customer'], ['cases', 'case'], ['purchases', 'purchase'],
      ['companies', 'company'], ['queries', 'query'], ['processes', 'process'], ['taxes', 'tax'],
      ['searches', 'search'],
    ];
    for (const [plural, singular] of pares) {
      assert.equal(procesarTerminoEn(plural), procesarTerminoEn(singular), `${plural} / ${singular}`);
    }
  });

  it('no recorta lo que no es plural ni lo corto', () => {
    for (const t of ['process', 'status', 'analysis', 'news', 'uses', 'running', 'created']) {
      assert.equal(reducirPluralEn(t), t, t);
    }
  });

  it('el castellano sigue igual: `the` no es relleno en castellano y `de` sí', () => {
    assert.equal(procesarTermino('the'), 'the');
    assert.equal(procesarTermino('de'), null);
    assert.equal(STOPWORDS.has('how'), false);
    assert.equal(ANALIZADORES.es, procesarTermino);
  });

  it('terminosDe sin idioma es el castellano de siempre', () => {
    assert.deepEqual(terminosDe('how do I delete the account'), ['how', 'do', 'i', 'delete', 'the', 'account']);
    assert.deepEqual(terminosDe('how do I delete the account', 'en'), ['delete', 'account']);
  });
});

describe('detectarIdioma — cuenta palabras vacías de cada idioma', () => {
  it('reconoce una pregunta en inglés y una en castellano', () => {
    assert.equal(detectarIdioma('How do I delete my account?'), 'en');
    assert.equal(detectarIdioma('¿Cómo hago para borrar la cuenta?'), 'es');
  });

  it('sin palabras vacías, o empatado, no adivina', () => {
    assert.equal(detectarIdioma('Mercado Libre'), null);
    assert.equal(detectarIdioma('factura invoice'), null);
    // `a` y `me` están en las dos listas: no suman para ninguna.
    assert.equal(detectarIdioma('a me'), null);
  });

  // Consultas en castellano con identificadores, siglas o palabras cortas que
  // también son palabras vacías del inglés. Partidas en `_ . -`, dejaban
  // `in`, `is`, `to`, `on`, `s`, `ve`, `do` sueltos y se buscaban en inglés.
  const CASTELLANO_CON_RUIDO = [
    'facturas in_invoice',
    'campo is_company',
    'clientes to_pay',
    'deuda clientes on-premise',
    've a configuración',
    'cliente S.A.',
    'error en to do list',
  ];

  it('mira sólo palabras enteras y pide una señal mínima', () => {
    for (const q of CASTELLANO_CON_RUIDO) assert.equal(detectarIdioma(q), null, q);
    // Una sola palabra vacía larga alcanza; una corta sola, no.
    assert.equal(detectarIdioma('which customers owe money'), 'en');
    assert.equal(detectarIdioma('customers to money'), null);
  });

  it('esas consultas se buscan en castellano y encuentran lo que hay', () => {
    usarVariante('ruido', (j) => {
      const es = (slug, body) => ({
        id: `es:*::casos/${slug}`, slug: `casos/${slug}`, eje: null, idioma: 'es', title: slug, description: '',
        keywords: [], seccion: 'casos', url: `/es/${slug}`, headings: [], body,
      });
      j.articulos.push(
        es('tipos', 'El tipo in_invoice es una factura de cliente.'),
        es('contactos', 'El campo is_company marca si el contacto es una empresa.'),
        es('cobros', 'Los clientes con estado to_pay.'),
        es('instalacion', 'La deuda de clientes en una instalación on-premise.'),
        es('configuracion', 'La configuración general.'),
        es('razon-social', 'El cliente S.A. y su razón social.'),
        es('errores', 'Un error en la to do list.'),
      );
      return j;
    });
    for (const q of CASTELLANO_CON_RUIDO) {
      const r = buscar({ q });
      assert.equal(r.idioma, 'es', q);
      assert.ok(r.total > 0, q);
      assert.equal(r.sugerencias, undefined, q);
    }
  });

  it('si el idioma detectado no da nada y el default sí, usa el default y lo dice', () => {
    usarFixture('idiomas');
    // Detecta inglés (`how`, `do`, `i`), pero de cheques sólo hay en castellano.
    const r = buscar({ q: 'how do i cheques' });
    assert.equal(r.idioma, 'es');
    assert.equal(r.idiomaElegidoPor, 'default-tras-deteccion');
    assert.equal(r.idiomaDetectado, 'en');
    assert.match(r.mensajeIdioma, /parecía en "en"/);
    assert.deepEqual(slugs(r), ['casos/cheques-propios']);
  });

  it('con cero en los dos, el hint dice en qué idioma buscó', () => {
    usarFixture('idiomas');
    const r = buscar({ q: 'how do i xyzzyq' });
    assert.equal(r.total, 0);
    assert.equal(r.idiomaElegidoPor, 'deteccion');
    assert.ok(r.sugerencias.some((s) => /documentación en "en"\. Ese idioma salió de detectar/.test(s)), r.sugerencias.join(' | '));
  });
});

// ═════════════════════════════════════════════════════════ la política

describe('politicaDeIdioma — un idioma o varios, nunca los dos campos', () => {
  it('sin nada es castellano, de un solo idioma', () => {
    assert.deepEqual(politicaDeIdioma({ eje: { tipo: 'none' } }).ids, ['es']);
    assert.equal(politicaDeIdioma({ eje: { tipo: 'none' } }).multi, false);
  });

  it('`build.idioma` elige el analizador de un corpus de un idioma', () => {
    const p = politicaDeIdioma({ eje: { tipo: 'none' }, idioma: 'en' });
    assert.equal(p.multi, false);
    assert.equal(p.default, 'en');
    assert.equal(opcionesDelIndice({ eje: { tipo: 'none' }, idioma: 'en' }).processTerm, procesarTerminoEn);
  });

  it('`build.idiomas` declara varios, con su default', () => {
    const p = politicaDeIdioma(crudo().build);
    assert.equal(p.multi, true);
    assert.deepEqual(p.ids, ['es', 'en']);
    assert.equal(p.default, 'es');
  });

  it('tira con los dos campos, con un default fuera de la lista, o con un idioma sin analizador', () => {
    assert.throws(() => politicaDeIdioma({ ...crudo().build, idioma: 'es' }), /a la vez/);
    assert.throws(() => politicaDeIdioma({ idiomas: { default: 'pt', valores: ['es', 'en'] } }), /no está en `valores`/);
    assert.throws(() => politicaDeIdioma({ idiomas: { valores: ['es', 'pt'] } }), /no hay analizador para el idioma "pt"/);
    assert.throws(() => politicaDeIdioma({ idiomas: { valores: ['es', 'es-AR'] } }), /repite un idioma/);
  });

  it('normaliza los códigos: mayúsculas, espacios y región', () => {
    for (const [crudo, id] of [['EN', 'en'], [' en', 'en'], ['en-US', 'en'], ['es_AR', 'es'], ['', null], [null, null]]) {
      assert.equal(normalizarIdioma(crudo), id, String(crudo));
    }
    assert.equal(politicaDeIdioma({ idioma: 'es-AR' }).default, 'es');
    assert.equal(politicaDeIdioma({ idioma: 'EN' }).default, 'en');
    const p = politicaDeIdioma({ idiomas: { default: 'ES', valores: ['ES', { id: 'en-US', label: 'English' }] } });
    assert.deepEqual(p.ids, ['es', 'en']);
    assert.equal(p.default, 'es');
  });

  it('un índice de un idioma sin analizador se lee en castellano, como en v0.19.0', () => {
    // v0.19.0 no miraba `build.idioma`: un índice v1 con `pt` o `es-AR` cargaba.
    assert.equal(politicaDeIdioma({ idioma: 'pt' }).default, 'es');
    usarFixture('eje-none');
    const antes = buscar({ q: 'ticket' });
    for (const idioma of ['es-AR', 'ES', 'pt']) {
      usarVariante(`v1-${idioma}`, () => {
        const j = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/eje-none.json', import.meta.url)), 'utf8'));
        j.build.idioma = idioma;
        return j;
      });
      assert.deepEqual(buscar({ q: 'ticket' }).resultados, antes.resultados, idioma);
    }
  });

  it('`build.idiomas` con un solo valor es un índice de un idioma, como lo ve el MCP', () => {
    usarVariante('v2-uno', (j) => ({
      ...j,
      build: { ...j.build, idiomas: { default: 'es', valores: [{ id: 'es', label: 'Español' }] } },
      mapa: j.mapa.filter((n) => n.idioma === 'es'),
      articulos: j.articulos.filter((a) => a.idioma === 'es'),
    }));
    assert.equal(indice().idiomas.multi, false);
    assert.equal('idiomas' in mapa(), false);
    const r = buscar({ q: 'cheques' });
    assert.ok(r.total > 0);
    assert.equal('idioma' in r, false);
    assert.equal('traducciones' in r.resultados[0], false);
  });
});

describe('construir — el contrato con idiomas', () => {
  it('un índice con idiomas en schemaVersion 1 no carga: el guard de los motores viejos es la versión', () => {
    usarVariante('v1', (j) => ({ ...j, schemaVersion: 1 }));
    assert.throws(() => indice(), /schemaVersion 2, para que un motor que no sabe de idiomas lo rechace/);
  });

  it('un artículo sin idioma, o con uno no declarado, no carga', () => {
    usarVariante('sin-idioma', (j) => {
      delete j.articulos[0].idioma;
      return j;
    });
    assert.throws(() => indice(), /trae idioma undefined/);
  });

  it('dos artículos con el mismo id no cargan, y el mensaje dice por qué', () => {
    usarVariante('id-repetido', (j) => {
      j.articulos[6].id = j.articulos[3].id;
      return j;
    });
    assert.throws(() => indice(), /se repite: con idiomas el build lo emite con el idioma adelante/);
  });

  it('una clave de traducción con dos artículos del mismo idioma no carga', () => {
    usarVariante('traduccion-doble', (j) => {
      j.articulos[2].traduccion = 'deuda-clientes';
      return j;
    });
    assert.throws(() => indice(), /tiene dos artículos en "es"/);
  });

  it('un schemaVersion 2 sin idiomas se lee como uno de un idioma', () => {
    usarFixture('eje-none');
    const antes = buscar({ q: 'ticket' });
    usarVariante('v2-mono', () => ({ ...JSON.parse(readFileSync(process.env.DOCS_INDICE_PATH, 'utf8')), schemaVersion: 2 }));
    assert.ok(antes.resultados.length > 0);
    assert.deepEqual(buscar({ q: 'ticket' }).resultados, antes.resultados);
  });
});

// ═════════════════════════════════════════════ sin idiomas, nada cambia

describe('un índice sin idiomas ignora el parámetro `idioma`', () => {
  it('buscar, leer y mapa devuelven lo mismo con y sin `idioma`', () => {
    usarFixture('eje-none');
    assert.deepEqual(buscar({ q: 'ticket', idioma: 'en' }), buscar({ q: 'ticket' }));
    const slug = buscar({ q: 'ticket' }).resultados[0].slug;
    assert.deepEqual(leer({ slug, idioma: 'en' }), leer({ slug }));
    assert.deepEqual(mapa({ idioma: 'en' }), mapa());
  });

  it('y ninguna respuesta gana campos de idioma', () => {
    usarFixture('eje-none');
    const r = buscar({ q: 'ticket' });
    assert.equal('idioma' in r, false);
    assert.equal('traducciones' in r.resultados[0], false);
    assert.equal('idiomas' in mapa(), false);
  });
});

// ════════════════════════════════════════════════════════════════ buscar

describe('buscar — un MiniSearch por idioma', () => {
  it('con `idioma` busca sólo en ese idioma, y el hit trae sus traducciones con url', () => {
    usarFixture('idiomas');
    const r = buscar({ q: 'overdue invoices', idioma: 'en' });
    assert.deepEqual(slugs(r), ['use-cases/customer-debt']);
    assert.equal(r.idioma, 'en');
    assert.equal(r.idiomaElegidoPor, 'pedido');
    assert.equal(r.resultados[0].idioma, 'en');
    assert.deepEqual(r.resultados[0].traducciones, {
      es: { slug: 'casos/deuda-clientes', url: 'https://docs.ejemplo.ar/es/deuda-clientes' },
    });
  });

  it('un artículo sin traducción trae `traducciones: {}`', () => {
    usarFixture('idiomas');
    const r = buscar({ q: 'cheques', idioma: 'es' });
    assert.deepEqual(r.resultados[0].traducciones, {});
  });

  it('sin `idioma` detecta por la query, y lo anuncia', () => {
    usarFixture('idiomas');
    const en = buscar({ q: 'Which customers owe me money?' });
    assert.equal(en.idioma, 'en');
    assert.equal(en.idiomaElegidoPor, 'deteccion');
    assert.equal(en.resultados[0].slug, 'use-cases/customer-debt');
    const es = buscar({ q: '¿Qué clientes me deben?' });
    assert.equal(es.idioma, 'es');
    assert.equal(es.idiomaElegidoPor, 'deteccion');
  });

  it('sin `idioma` y sin señal en la query, el default del índice', () => {
    usarFixture('idiomas');
    const r = buscar({ q: 'privacidad' });
    assert.equal(r.idioma, 'es');
    assert.equal(r.idiomaElegidoPor, 'default');
  });

  it('un idioma que el índice no tiene es un soft-fail, nunca otro idioma', () => {
    usarFixture('idiomas');
    const r = buscar({ q: 'privacy', idioma: 'pt' });
    assert.equal(r.total, 0);
    assert.equal(r.motivo, 'idioma-inexistente');
    assert.deepEqual(r.idiomasDisponibles, ['es', 'en']);
  });

  it('el fragmento se arma con el analizador del idioma del hit', () => {
    // `companies` es `company` para el inglés y `companie` para el castellano:
    // con el analizador equivocado el primer bloque no tiene apariciones y el
    // fragmento sale del segundo.
    usarVariante('fragmento-en', (j) => {
      j.articulos.push({
        id: 'en:*::use-cases/companies', slug: 'use-cases/companies', eje: null, idioma: 'en', title: 'Setup',
        description: '', keywords: [], seccion: 'use-cases', url: '/en/companies',
        headings: [{ id: 'many', text: 'Many', level: 2 }, { id: 'one', text: 'One', level: 2 }],
        body: '# Setup\n\n## Many\n\nAll the companies and more companies.\n\n## One\n\nA company.',
      });
      return j;
    });
    const r = buscar({ q: 'companies', idioma: 'en' });
    assert.equal(r.resultados[0].slug, 'use-cases/companies');
    assert.equal(r.resultados[0].ancla.id, 'many');
    assert.match(r.resultados[0].fragmento, /All the companies/);
  });

  it('`idioma` se normaliza: mayúsculas, espacios y región', () => {
    usarFixture('idiomas');
    for (const idioma of ['EN', ' en', 'en-US']) {
      const r = buscar({ q: 'overdue invoices', idioma });
      assert.equal(r.idioma, 'en', idioma);
      assert.equal(r.idiomaElegidoPor, 'pedido', idioma);
    }
    assert.equal(leer({ slug: 'legal/privacy', idioma: 'EN' }).title, 'Privacy policy');
    assert.equal(mapa({ idioma: 'en-US' }).idioma, 'en');
  });

  it('el castellano de un índice bilingüe rankea igual que un índice sólo en castellano', () => {
    usarVariante('solo-es', (j) => ({
      ...j,
      schemaVersion: 1,
      build: { ...j.build, idiomas: undefined, idioma: 'es' },
      mapa: j.mapa.filter((n) => n.idioma === 'es'),
      articulos: j.articulos.filter((a) => a.idioma === 'es'),
    }));
    const consultas = ['clientes deben', 'facturas vencidas', 'cuenta', 'datos personales', 'cheques'];
    const solo = consultas.map((q) => buscar({ q }).resultados);
    usarFixture('idiomas');
    const sinCamposDeIdioma = ({ idioma, traducciones, ...resto }) => resto;
    const bilingue = consultas.map((q) => buscar({ q, idioma: 'es' }).resultados.map(sinCamposDeIdioma));
    assert.deepEqual(bilingue, solo);
  });
});

// ═══════════════════════════════════════════════════ el ranking, por idioma

describe('el ranking corre sobre el idioma elegido', () => {
  it('el idf de la cobertura se cuenta sobre los artículos de ese idioma', () => {
    usarFixture('idiomas');
    // `debt` sólo existe en inglés: en castellano es un término ausente. Con
    // N = 4 (los artículos en castellano) la cobertura de `clientes` es
    // log(1 + 3,5/1,5) / (esa + log(1 + 4,5/0,5)) = 0,34; con los 7 del
    // índice daría 0,38.
    const r = buscar({ q: 'clientes debt', idioma: 'es' });
    assert.equal(r.modo, 'or-fallback');
    assert.deepEqual(r.terminosAusentes, ['debt']);
    assert.equal(r.resultados[0].cobertura, 0.34);
  });

  it('la raíz liviana es del castellano: el inglés no tiene campo `raices`', () => {
    usarFixture('idiomas');
    const { build } = indice();
    assert.ok(opcionesDelIndice(build, 'es').fields.includes('raices'));
    assert.equal(opcionesDelIndice(build, 'en').fields.includes('raices'), false);
    // `eliminé` llega a «Eliminar» por la raíz; `deleted` no llega a «Delete».
    assert.equal(buscar({ q: 'eliminé la cuenta', idioma: 'es' }).modo, 'and');
    const en = buscar({ q: 'deleted account', idioma: 'en' });
    assert.equal(en.modo, 'or-fallback');
    assert.deepEqual(en.terminosAusentes, ['deleted']);
  });

  it('un índice de un idioma con `build.idioma: "en"` busca en inglés, sin campos de idioma', () => {
    usarVariante('solo-en', (j) => ({
      ...j,
      schemaVersion: 1,
      build: { ...j.build, idiomas: undefined, idioma: 'en' },
      mapa: j.mapa.filter((n) => n.idioma === 'en'),
      articulos: j.articulos.filter((a) => a.idioma === 'en'),
    }));
    const r = buscar({ q: 'the overdue invoices', idioma: 'es' });
    assert.equal(r.modo, 'and', '`the` es relleno en inglés');
    assert.deepEqual(slugs(r), ['use-cases/customer-debt']);
    assert.equal(r.idioma, undefined);
    assert.equal(opcionesDelIndice(indice().build).fields.includes('raices'), false);
  });
});

// ═════════════════════════════════════════════════════════════════ leer

describe('leer — el idioma se resuelve antes que el eje', () => {
  it('un slug de un solo idioma se lee sin pedir idioma', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'use-cases/delete-account' });
    assert.equal(r.encontrado, true);
    assert.equal(r.idioma, 'en');
    assert.equal('idiomaElegidoPor' in r, false);
    assert.deepEqual(r.traducciones, { es: { slug: 'casos/eliminar-cuenta', url: 'https://docs.ejemplo.ar/es/eliminar-cuenta' } });
  });

  it('un slug que existe en los dos idiomas, sin idioma: el default, anunciado', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'legal/privacy' });
    assert.equal(r.idioma, 'es');
    assert.equal(r.idiomaElegidoPor, 'default');
    assert.equal(r.traducciones.en.slug, 'legal/privacy');
  });

  it('con idioma, el del idioma pedido', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'legal/privacy', idioma: 'en' });
    assert.equal(r.title, 'Privacy policy');
    assert.equal('idiomaElegidoPor' in r, false);
  });

  it('el slug de otro idioma con idioma pedido devuelve su traducción, y lo dice', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'casos/deuda-clientes', idioma: 'en' });
    assert.equal(r.encontrado, true);
    assert.equal(r.slug, 'use-cases/customer-debt');
    assert.equal(r.idiomaElegidoPor, 'traduccion');
  });

  it('sin traducción al idioma pedido es un soft-fail con el camino', () => {
    usarFixture('idiomas');
    const r = leer({ slug: 'casos/cheques-propios', idioma: 'en' });
    assert.equal(r.encontrado, false);
    assert.equal(r.motivo, 'slug-fuera-del-idioma-pedido');
    assert.deepEqual(r.idiomasDelSlug, ['es']);
  });

  it('un slug inexistente sigue el soft-fail de siempre', () => {
    usarFixture('idiomas');
    assert.equal(leer({ slug: 'no/existe' }).motivo, 'slug-inexistente');
  });

  it('el idioma se valida antes que el slug, y las sugerencias son de ese idioma', () => {
    usarFixture('idiomas');
    const pt = leer({ slug: 'no/existe', idioma: 'pt' });
    assert.equal(pt.motivo, 'idioma-inexistente');
    const en = leer({ slug: 'legal/privacidad', idioma: 'en' });
    assert.equal(en.motivo, 'slug-inexistente');
    assert.ok(en.sugerencias.length > 0);
    assert.deepEqual([...new Set(en.sugerencias.map((s) => s.idioma))], ['en']);
  });

  it('sin idioma, el eje se resuelve primero: no niega lo que existe en otro idioma', () => {
    // `legal/privacy` está en castellano para la 18 y en inglés para la 19.
    usarBilingue(
      'eje-y-idioma',
      [
        { slug: 'legal/privacy', idioma: 'es', eje: '18', title: 'Privacidad', traduccion: 'privacy' },
        { slug: 'legal/privacy', idioma: 'en', eje: '19', title: 'Privacy', traduccion: 'privacy' },
      ],
      { tipo: 'version', default: '19', valores: [{ id: '19', label: '19.0' }, { id: '18', label: '18.0' }] },
    );
    const r = leer({ slug: 'legal/privacy', version: '19' });
    assert.equal(r.encontrado, true);
    assert.equal(r.title, 'Privacy');
    assert.equal(r.idiomaElegidoPor, 'eje');
    // Con la 18 sigue ganando el default del idioma.
    const r18 = leer({ slug: 'legal/privacy', version: '18' });
    assert.equal(r18.title, 'Privacidad');
    assert.equal(r18.idiomaElegidoPor, 'default');
  });

  it('un artículo fuera del eje empareja con su traducción versionada', () => {
    usarBilingue(
      'comodin',
      [
        { slug: 'casos/guia', idioma: 'es', eje: null, title: 'Guía', traduccion: 'guia' },
        { slug: 'use-cases/guide', idioma: 'en', eje: '19', title: 'Guide', traduccion: 'guia' },
      ],
      { tipo: 'version', default: '19', valores: [{ id: '19', label: '19.0' }] },
    );
    assert.equal(leer({ slug: 'casos/guia' }).traducciones.en.slug, 'use-cases/guide');
    assert.equal(leer({ slug: 'use-cases/guide' }).traducciones.es.slug, 'casos/guia');
    const r = leer({ slug: 'casos/guia', idioma: 'en' });
    assert.equal(r.slug, 'use-cases/guide');
    assert.equal(r.idiomaElegidoPor, 'traduccion');
  });

  it('un fuera del eje traducido en varias versiones da la de la versión pedida', () => {
    usarBilingue(
      'comodin-versiones',
      [
        { slug: 'casos/guia', idioma: 'es', eje: null, title: 'Guía', traduccion: 'guia' },
        { slug: 'use-cases/guide', idioma: 'en', eje: '18', title: 'Guide 18', traduccion: 'guia' },
        { slug: 'use-cases/guide', idioma: 'en', eje: '19', title: 'Guide 19', traduccion: 'guia' },
      ],
      { tipo: 'version', default: '19', valores: [{ id: '19', label: '19.0' }, { id: '18', label: '18.0' }] },
    );
    const r18 = leer({ slug: 'casos/guia', idioma: 'en', version: '18' });
    assert.equal(r18.encontrado, true, r18.motivo);
    assert.equal(r18.title, 'Guide 18');
    assert.equal(leer({ slug: 'casos/guia', idioma: 'en' }).title, 'Guide 19');
  });

  it('la traducción es la del grupo del artículo, no otra con el mismo slug', () => {
    // `en/B/guide` comparte slug con la traducción de `es/A/guia` pero es de
    // otro project, y B es el default: antes se devolvía ese.
    usarBilingue(
      'otro-project',
      [
        { slug: 'guia', idioma: 'es', eje: 'A', title: 'Guía de A', traduccion: 'guia' },
        { slug: 'guide', idioma: 'en', eje: 'A', title: 'Guide of A', traduccion: 'guia' },
        { slug: 'guide', idioma: 'en', eje: 'B', title: 'Guide of B', traduccion: 'otra' },
      ],
      { tipo: 'project', default: 'B', valores: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }] },
    );
    const r = leer({ slug: 'guia', idioma: 'en' });
    assert.equal(r.encontrado, true);
    assert.equal(r.title, 'Guide of A');
    assert.equal(r.project, 'A');
  });
});

// ═════════════════════════════════════════════════════════════════ mapa

describe('mapa — el de un idioma, y la cabecera dice cuáles hay', () => {
  it('sin idioma, el default y anunciado', () => {
    usarFixture('idiomas');
    const m = mapa();
    assert.equal(m.idioma, 'es');
    assert.equal(m.idiomaElegidoPor, 'default');
    assert.deepEqual(m.idiomas.valores.map((v) => v.id), ['es', 'en']);
    assert.equal(m.articulos, 4);
    assert.deepEqual([...new Set(m.mapa.map((n) => n.idioma))], ['es']);
  });

  it('con idioma, las ramas y los artículos de ese idioma', () => {
    usarFixture('idiomas');
    const m = mapa({ idioma: 'en' });
    assert.equal(m.articulos, 3);
    assert.deepEqual(m.mapa.map((n) => n.seccion), ['use-cases', 'legal']);
    const legal = mapa({ seccion: 'legal', idioma: 'en' });
    assert.deepEqual(legal.articulos.map((a) => a.title), ['Privacy policy']);
  });

  it('una sección de otro idioma no existe en este', () => {
    usarFixture('idiomas');
    assert.equal(mapa({ seccion: 'use-cases' }).motivo, 'seccion-inexistente');
  });
});
