/**
 * One-letter hyphen compounds (`e-ticket`, `e-factura`) are one word when
 * indexing, searching and locating terms. `node --test compuestos.test.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { crearMotor, normalizarTermino, PERFIL, procesarTermino, ubicarTerminos } from '../lib/mcp/motor.mjs';

const base = JSON.parse(readFileSync(new URL('./fixtures/eje-version.json', import.meta.url), 'utf8'));
const articulo = (slug, title, body) => ({ id: `19::${slug}`, slug, eje: '19', title, seccion: 'manual', url: `/19/${slug}`, keywords: [], headings: [], body });
const motor = crearMotor({
  ...base,
  build: { ...base.build, articulos: 2 },
  articulos: [
    articulo('e-ticket', 'Emitir un e-ticket', '# Emitir un e-ticket\n\nEl e-ticket se envía a la DGI.\n'),
    articulo('tickets', 'Tickets de soporte', '# Tickets de soporte\n\nCada ticket tiene un responsable.\n'),
  ],
});
const slugs = (q) => motor.buscar({ q, perfil: PERFIL.persona }).resultados.map((h) => h.slug);

describe('compuestos de una letra con guion', () => {
  it('se normalizan a una sola palabra', () => {
    assert.equal(normalizarTermino('E-Ticket'), 'eticket');
    assert.equal(procesarTermino('e-remitos'), 'eremito');
    assert.equal(normalizarTermino('de-ticket'), 'de-ticket');
  });

  it('con guion o sin guion encuentran la página del compuesto, y no la de la palabra suelta', () => {
    assert.deepEqual(slugs('e-ticket'), ['e-ticket']);
    assert.deepEqual(slugs('eticket'), ['e-ticket']);
  });

  it('la palabra suelta no trae el compuesto', () => {
    assert.deepEqual(slugs('ticket'), ['tickets']);
  });

  it('un término que también es su raíz conserva el cuerpo: hay fragmento y se marca', () => {
    const hit = motor.buscar({ q: 'e-ticket', perfil: PERFIL.persona }).resultados[0];
    assert.match(hit.fragmento, /e-ticket se envía/);
    assert.ok(hit.resaltar.terminos.includes('eticket'), JSON.stringify(hit.resaltar));
  });

  it('el resaltado marca el compuesto entero', () => {
    const { resaltar } = motor.buscar({ q: 'e-ticket', perfil: PERFIL.persona }).resultados[0];
    assert.deepEqual(ubicarTerminos('Un e-ticket, no un ticket.', resaltar), [{ pos: 3, largo: 8 }]);
  });
});
