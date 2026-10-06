/**
 * El motor sin node (`motor.mjs`): el buscador del sitio lo corre en el
 * navegador, así que tiene que responder lo mismo que el MCP sin leer disco
 * ni entorno. `node --test motor.test.mjs`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ORIGIN = 'https://docs.ejemplo.ar';
process.env.DOCS_URL = ORIGIN;

const mcp = await import('../lib/mcp/indice.mjs');
const { crearMotor, PERFIL } = await import('../lib/mcp/motor.mjs');

const rutaDe = (nombre) => fileURLToPath(new URL(`./fixtures/${nombre}.json`, import.meta.url));
const crudoDe = (nombre) => JSON.parse(readFileSync(rutaDe(nombre), 'utf8'));

function delMcp(nombre) {
  process.env.DOCS_INDICE_PATH = rutaDe(nombre);
  mcp._resetIndice();
  return mcp;
}

describe('motor.mjs no depende de node', () => {
  it('no importa módulos de node ni lee process', () => {
    const fuente = readFileSync(new URL('../lib/mcp/motor.mjs', import.meta.url), 'utf8');
    const imports = [...fuente.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.deepEqual(imports, ['minisearch']);
    assert.doesNotMatch(fuente, /\bprocess\./);
  });
});

describe('crearMotor responde lo mismo que el MCP', () => {
  const CASOS = {
    'eje-version': [
      ['buscar', { q: 'conciliación bancaria' }],
      ['buscar', { q: 'factura', version: '18' }],
      // Los dos perfiles: rescate de tipeo y relleno OR, que la persona no tiene.
      ['buscar', { q: 'conciliacon', perfil: PERFIL.persona }],
      ['buscar', { q: 'conciliación tarjeta' }],
      ['buscar', { q: 'conciliación tarjeta', perfil: PERFIL.persona }],
      ['leer', { slug: 'manual/finanzas/cobros-y-pagos/conciliacion-bancaria' }],
      ['mapa', {}],
    ],
    idiomas: [
      ['buscar', { q: 'customer debt', idioma: 'en' }],
      ['buscar', { q: 'deuda de clientes' }],
      ['leer', { slug: 'legal/privacy', idioma: 'en' }],
      ['mapa', { idioma: 'en' }],
    ],
    superficie: [
      ['buscar', { q: 'conciliación' }],
      ['leer', { slug: 'manual/bancos/conciliacion', ancla: 'configurar-el-banco' }],
      ['leer', { slug: 'no/existe' }],
    ],
  };

  for (const [fixture, llamadas] of Object.entries(CASOS)) {
    for (const [tool, args] of llamadas) {
      it(`${fixture}: ${tool}(${JSON.stringify(args)})`, () => {
        const esperado = delMcp(fixture)[tool](args);
        const motor = crearMotor(crudoDe(fixture), { origin: ORIGIN });
        assert.deepEqual(motor[tool](args), esperado);
      });
    }
  }

  it('seccionesConComodin', () => {
    const esperado = delMcp('eje-version').seccionesConComodin();
    assert.deepEqual(crearMotor(crudoDe('eje-version')).seccionesConComodin(), esperado);
  });
});

describe('crearMotor', () => {
  it('sin origin, las URLs quedan relativas al sitio', () => {
    const r = crearMotor(crudoDe('superficie')).buscar({ q: 'conciliación' });
    assert.ok(r.resultados.length > 0);
    for (const hit of r.resultados) assert.match(hit.url, /^\//);
  });

  // El navegador cambia de índice cuando la persona cambia de versión: el
  // motor no puede tener estado de módulo que un índice le deje al otro.
  it('dos motores conviven: cada uno busca sobre su índice', () => {
    const a = crearMotor(crudoDe('superficie'));
    const b = crearMotor(crudoDe('idiomas'));
    assert.equal(a.buscar({ q: 'conciliación' }).total, 1);
    assert.equal(b.buscar({ q: 'conciliación' }).total, 0);
    assert.equal(b.buscar({ q: 'customer debt', idioma: 'en' }).resultados[0].slug, 'use-cases/customer-debt');
    assert.equal(a.buscar({ q: 'customer debt', idioma: 'en' }).total, 0);
  });

  it('el contrato se verifica igual que en el MCP', () => {
    assert.throws(() => crearMotor(crudoDe('sin-schema-version')), /schemaVersion/);
    assert.throws(() => crearMotor(crudoDe('schema-version-futura')), /actualizá @ingadhoc\/docs-platform/);
  });
});
