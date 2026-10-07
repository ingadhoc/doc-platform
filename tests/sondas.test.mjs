/**
 * Suite del cálculo de sondas. `node --test tests/sondas.test.mjs`
 *
 * Los cuatro primeros casos vienen de `oba-docs/tests/sondas.test.mjs`, que se
 * va con la copia del cálculo. Los demás fijan lo que `odumbo-docs` no tenía:
 * el filtro de sondas que no discriminan y el fail-closed de las líneas sin
 * sonda. El último corre el guard de verdad sobre el manifiesto que escribe
 * este módulo: el contrato productor ↔ consumidor, de punta a punta.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  calcularSondas,
  comoSePublica,
  discrimina,
  escribirManifiesto,
  explicarSinCobertura,
  normalizar,
  trigramas,
} from '../lib/sondas.mjs';

const GUARD = fileURLToPath(new URL('../bin/guard-fuga.mjs', import.meta.url));

// El caso del PR #163 de oba-docs. El párrafo cierra con un link cuyo TEXTO
// termina en «las facturas A» y el bloque siguiente arranca «Esta página
// cubre…». En el sitio publicado la frase es «…facturas a esta página…».
const PUBLICO = [
  'Ver [el detalle de las retenciones en las facturas A](../retencion-de-ganancias-e-iva-en-facturas-a.md).',
  '',
  'Esta página cubre el circuito completo.',
].join('\n');

describe('los dos dominios de texto', () => {
  it('el trigrama que cruza el link se calcula como se publica, no como se escribe', () => {
    assert.ok(
      trigramas(PUBLICO).includes('a esta página'),
      'sin esto el trigrama nunca entra en `publicado` y queda de sonda contra el índice de búsqueda',
    );
  });

  it('en el dominio publicado el destino del link no corre el n-grama', () => {
    assert.equal(
      normalizar(comoSePublica('Ver [las facturas A](../facturas-a.md).')),
      'ver las facturas a',
    );
  });

  // La otra mitad, y la que decide que el arreglo no afloja el guard: el índice
  // del MCP lleva el cuerpo en markdown CRUDO, así que los trigramas del destino
  // siguen siendo alcanzables ahí.
  it('los trigramas del dominio markdown siguen estando: el índice del MCP los alcanza', () => {
    const gs = trigramas(PUBLICO);
    assert.ok(gs.includes('retencion de ganancias'));
    assert.ok(gs.includes('e iva en'));
  });

  it('la imagen no deja texto publicado, pero su alt sigue en el dominio markdown', () => {
    const md = [
      '![El campo Referencia de Proveedor](/img/manual/compras/orden-1385140.png)',
      '',
      '![El campo Fecha de Confirmación](/img/manual/compras/orden-1389973.png)',
    ].join('\n');
    const gs = trigramas(md);
    assert.ok(!gs.includes('proveedor el campo'));
    assert.ok(gs.includes('referencia de proveedor'));
    assert.ok(gs.includes('orden 1385140 png'));
  });
});

describe('una sonda tiene que discriminar', () => {
  it('un número de versión o tres palabras funcionales no son sonda', () => {
    assert.equal(discrimina('la 19 0'), false);
    assert.equal(discrimina('que verificar qué'), true, '`verificar` es palabra de contenido');
    assert.equal(discrimina('para todo esto'), false);
  });

  it('el trigrama que está en lo publicado no es sonda', () => {
    const publicado = new Set(trigramas('Desde la 19.0 el diario se configura solo.'));
    const r = calcularSondas({
      removido: ['El webservice de AFIP corta por timeout en la 19.0.'],
      publicado,
    });
    assert.ok(r.sondas.includes('webservice de afip'));
    assert.ok(!r.sondas.includes('la 19 0'), 'está publicado y además no discrimina');
    assert.equal(r.bloques, 1);
    assert.deepEqual(r.sinCobertura, []);
  });

  it('una línea interna cuyos trigramas no discriminan queda sin cobertura: falla, no aviso', () => {
    const r = calcularSondas({ removido: ['y la 18.0 o la 19.0'], publicado: new Set() });
    assert.deepEqual(r.sondas, []);
    assert.deepEqual(r.sinCobertura, ['y la 18.0 o la 19.0']);
    assert.ok(r.descartadas > 0);
    assert.match(explicarSinCobertura(r.sinCobertura), /y la 18\.0 o la 19\.0/);
  });

  it('una línea cuyos trigramas ya están todos publicados no queda sin cobertura', () => {
    // No hay nada que verificar: lo que dice ya es público.
    const texto = 'El diario de ventas se configura en Contabilidad.';
    const r = calcularSondas({ removido: [texto], publicado: new Set(trigramas(texto)) });
    assert.deepEqual(r.sondas, []);
    assert.deepEqual(r.sinCobertura, []);
  });
});

describe('el manifiesto, contra el guard', () => {
  const repo = () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sondas-test-'));
    fs.writeFileSync(path.join(tmp, 'docs.config.json'), JSON.stringify({
      schemaVersion: 1,
      eje: { tipo: 'none' },
      audiences: ['publico', 'interno'],
      deploy: { proyectos: { prj_publico: 'publico' }, guardDeFuga: { activo: true } },
    }));
    fs.mkdirSync(path.join(tmp, 'site', 'build'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'site', 'generated.json'), JSON.stringify({ audience: 'publico' }));
    fs.mkdirSync(path.join(tmp, 'api', '_generated'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'api', '_generated', 'index.json'), '{"articulos":[]}');
    return tmp;
  };
  const guard = (cwd) => spawnSync(process.execPath, [GUARD, '--esperada=publico'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, VERCEL: '', VERCEL_PROJECT_ID: '' },
  });
  const material = {
    audience: 'publico',
    target: 'docusaurus',
    content: 'content',
    removido: ['El webservice de AFIP corta por timeout a los 30 segundos.'],
    publicado: new Set(trigramas('El diario se configura en Contabilidad.')),
  };

  it('el guard encuentra la línea interna que llegó al sitio', () => {
    const tmp = repo();
    const r = escribirManifiesto({ raiz: tmp, ...material });
    assert.equal(r.ok, true);
    fs.writeFileSync(
      path.join(tmp, 'site', 'build', 'index.html'),
      '<p>El webservice de AFIP corta por timeout a los 30 segundos.</p>',
    );
    const g = guard(tmp);
    assert.equal(g.status, 1, `esperaba deploy BLOQUEADO.\n${g.stdout}${g.stderr}`);
    assert.match(`${g.stdout}${g.stderr}`, /FUGA:/, 'tiene que bloquear por la sonda, no por otra falla');
  });

  it('y aprueba el sitio que no la tiene', () => {
    const tmp = repo();
    escribirManifiesto({ raiz: tmp, ...material });
    fs.writeFileSync(path.join(tmp, 'site', 'build', 'index.html'), '<p>El diario se configura en Contabilidad.</p>');
    const g = guard(tmp);
    assert.equal(g.status, 0, `esperaba deploy APROBADO.\n${g.stdout}${g.stderr}`);
  });

  it('con líneas sin cobertura no escribe el manifiesto', () => {
    const tmp = repo();
    const r = escribirManifiesto({ raiz: tmp, ...material, removido: ['y la 18.0 o la 19.0'] });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(path.join(tmp, '.guard', 'removido.json')), false);
  });
});
