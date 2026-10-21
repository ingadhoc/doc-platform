/**
 * The reader's relaxed AND: a conversational query with few complete matches
 * also gets the pages missing at most a third of its terms.
 * `node --test and-relajado.test.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { crearMotor, PERFIL } from '../lib/mcp/motor.mjs';

const base = JSON.parse(readFileSync(new URL('./fixtures/eje-version.json', import.meta.url), 'utf8'));
const articulo = (slug, title, body) => ({ id: `19::${slug}`, slug, eje: '19', title, seccion: 'manual', url: `/19/${slug}`, keywords: [], headings: [], body });
const motor = crearMotor({
  ...base,
  build: { ...base.build, articulos: 6 },
  articulos: [
    articulo('rechazo', 'Rechazo de un cheque de terceros', '# Rechazo de un cheque de terceros\n\nRegistrar el cheque rechazado por el banco.\n'),
    articulo('cargar', 'Cargar los datos iniciales', '# Cargar los datos iniciales\n\nCargo los saldos al empezar.\n'),
    articulo('pedido', 'Entregar un pedido en partes', '# Entregar un pedido en partes\n\nEntregar lo que hay del pedido.\n'),
    articulo('mitad', 'Mitad de mes', '# Mitad de mes\n\nCierre a mitad de mes.\n'),
    articulo('cobros', 'Cobros', '# Cobros\n\nRegistrar un cobro.\n'),
    articulo('pagos', 'Pagos', '# Pagos\n\nRegistrar un pago.\n'),
  ],
});
const buscar = (q, perfil = PERFIL.persona) => motor.buscar({ q, perfil });

describe('and relajado: sólo la persona, sólo con pocas coincidencias completas', () => {
  it('una palabra de relleno ya no deja afuera la página buena', () => {
    const r = buscar('¿Cómo cargo un cheque rechazado?');
    assert.equal(r.modo, 'and-relajado');
    assert.equal(r.resultados[0].slug, 'rechazo');
  });

  it('una palabra que existe en otra página no la confunde con un tipeo', () => {
    const r = buscar('entregar la mitad del pedido');
    assert.equal(r.modo, 'and-relajado');
    assert.equal(r.resultados[0].slug, 'pedido');
  });

  it('un término que el corpus no tiene no se relaja: sigue dando cero', () => {
    assert.equal(buscar('registrar cheque epson').total, 0);
  });

  it('con dos términos no se relaja: los dos tercios son los dos', () => {
    assert.equal(buscar('cheque mitad').total, 0);
  });

  it('con suficientes coincidencias completas queda en and, sin las parciales', () => {
    const completo = (n) => articulo(`completo-${n}`, `Completo ${n}`, `# Completo ${n}\n\nRegistrar cheque rechazado.\n`);
    const otro = crearMotor({
      ...base,
      build: { ...base.build, articulos: 4 },
      articulos: [completo(1), completo(2), completo(3), articulo('parcial', 'Parcial', '# Parcial\n\nRegistrar cheque.\n')],
    });
    const r = otro.buscar({ q: 'registrar cheque rechazado', perfil: PERFIL.persona });
    assert.equal(r.modo, 'and');
    assert.equal(r.total, 3);
  });

  it('el agente no cambia: sigue con su relleno or', () => {
    assert.equal(buscar('¿Cómo cargo un cheque rechazado?', PERFIL.agente).modo, 'or-fallback');
  });
});
