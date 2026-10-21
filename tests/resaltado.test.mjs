/**
 * El resaltado del buscador del sitio: cada hit de la persona trae los términos
 * del índice que matchearon (`resaltar`), y `ubicarTerminos` los encuentra en
 * el texto con el mismo analizador. `node --test resaltado.test.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { crearMotor, PERFIL, ubicarTerminos } from '../lib/mcp/motor.mjs';

const fixture = (nombre) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${nombre}.json`, import.meta.url), 'utf8'));

function articulo(slug, title, body) {
  return { id: `19::${slug}`, slug, eje: '19', title, seccion: 'manual', url: `/19/${slug}`, keywords: [], headings: [], body };
}

// The cases of the original report (task 73605): prefix, missing accent,
// plural, typo and a stopword that used to be painted inside other words.
const base = fixture('eje-version');
const motor = crearMotor({
  ...base,
  build: { ...base.build, articulos: 3 },
  articulos: [
    articulo('costo', 'Costo de mercadería vendida', '# Costo de mercadería vendida\n\nEl costo depende de dónde quedó la mercadería, en el orden de entrega.\n'),
    articulo('mercado-pago', 'Mercado Pago', '# Mercado Pago\n\nCobrar con Mercado Pago desde el punto de venta.\n'),
    articulo('anular', 'Anulación de facturas', '# Anulación de facturas\n\nUna factura anulada no se puede volver a validar.\n'),
  ],
});

/** The text with each located term between brackets. */
function marcar(texto, resaltar) {
  let salida = '';
  let desde = 0;
  for (const { pos, largo } of ubicarTerminos(texto, resaltar)) {
    salida += `${texto.slice(desde, pos)}[${texto.slice(pos, pos + largo)}]`;
    desde = pos + largo;
  }
  return salida + texto.slice(desde);
}

const primero = (q) => motor.buscar({ q, perfil: PERFIL.persona }).resultados[0];

describe('resaltar: lo que trae cada hit de la persona', () => {
  it('trae el término del índice ya resuelto, no lo que se tipeó', () => {
    const hit = primero('costo de merc');
    assert.equal(hit.slug, 'costo');
    assert.deepEqual(hit.resaltar.terminos.sort(), ['costo', 'mercaderia']);
    assert.equal(hit.resaltar.idioma, 'es');
  });

  it('el agente no lo recibe: su respuesta no cambia', () => {
    const hit = motor.buscar({ q: 'costo de merc' }).resultados[0];
    assert.equal('resaltar' in hit, false);
  });
});

describe('ubicarTerminos: marca lo que matcheó el motor y nada más', () => {
  it('el prefijo marca la palabra entera, y no la de otro término', () => {
    const hit = primero('costo de merc');
    assert.equal(marcar(hit.title, hit.resaltar), '[Costo] de [mercadería] vendida');
    assert.equal(marcar('Mercado Pago', hit.resaltar), 'Mercado Pago');
    assert.equal(marcar('Un costo costoso', hit.resaltar), 'Un [costo] costoso');
  });

  it('nunca marca una palabra vacía, ni adentro de otra palabra', () => {
    const hit = primero('costo de merc');
    const texto = 'El costo depende de dónde quedó la mercadería, en el orden de entrega.';
    assert.equal(marcar(texto, hit.resaltar), 'El [costo] depende de dónde quedó la [mercadería], en el orden de entrega.');
  });

  it('sin tilde y en plural encuentra la forma con tilde y en singular', () => {
    const hit = primero('costos de mercaderias');
    assert.equal(marcar(hit.title, hit.resaltar), '[Costo] de [mercadería] vendida');
  });

  it('un tipeo rescatado marca la palabra correcta, no la tipeada', () => {
    const hit = primero('mercaderia vendda');
    assert.equal(hit.slug, 'costo');
    assert.equal(marcar(hit.title, hit.resaltar), 'Costo de [mercadería] [vendida]');
  });

  it('lo que matcheó por raíz se marca por raíz', () => {
    const hit = primero('anular factura');
    assert.equal(hit.slug, 'anular');
    assert.ok(hit.resaltar.raices.includes('anul'), JSON.stringify(hit.resaltar));
    assert.equal(
      marcar('Una factura anulada no se puede volver a validar.', hit.resaltar),
      'Una [factura] [anulada] no se puede volver a validar.',
    );
  });

  it('un término que es su propia raíz marca también sus otras formas', () => {
    const conBorrador = crearMotor({
      ...base,
      build: { ...base.build, articulos: 1 },
      articulos: [articulo('borrador', 'Facturas en borrador', '# Facturas en borrador\n\nLos borradores se validan después.\n')],
    });
    for (const q of ['borrador', 'borradores']) {
      const hit = conBorrador.buscar({ q, perfil: PERFIL.persona }).resultados[0];
      assert.equal(marcar('Los borradores y un borrador', hit.resaltar), 'Los [borradores] y un [borrador]', q);
    }
  });

  it('sin términos no marca nada', () => {
    assert.deepEqual(ubicarTerminos('Costo de mercadería', {}), []);
    assert.deepEqual(ubicarTerminos(null, { terminos: ['costo'] }), []);
  });

  it('usa el analizador del idioma del hit', () => {
    const bilingue = crearMotor(fixture('idiomas'));
    const hit = bilingue.buscar({ q: 'customer debt', idioma: 'en', perfil: PERFIL.persona }).resultados[0];
    assert.equal(hit.resaltar.idioma, 'en');
    assert.equal(marcar('The debts of a customer', hit.resaltar), 'The [debts] of a [customer]');
    // the Spanish analyzer would leave «companie»
    assert.equal(marcar('The companies of a company', { idioma: 'en', terminos: ['company'] }), 'The [companies] of a [company]');
  });

  it('en la página 2 cada hit trae lo que matcheó su propio artículo', () => {
    const letras = 'abcdefghijkl';
    const paginado = crearMotor({
      ...base,
      build: { ...base.build, articulos: letras.length },
      articulos: [...letras].map((l) => articulo(`fact${l}`, `Fact${l}z`, `# Fact${l}z\n\nTexto.\n`)),
    });
    const { resultados } = paginado.buscar({ q: 'fact', page: 2, perfil: PERFIL.persona });
    assert.ok(resultados.length > 0);
    for (const hit of resultados) assert.equal(marcar(hit.title, hit.resaltar), `[${hit.title}]`, hit.slug);
  });
});
