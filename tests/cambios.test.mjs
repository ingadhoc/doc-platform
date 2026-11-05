/**
 * The `/changes` page of a PR preview: the diff between the base commit's
 * agent index and this build's. `node --test tests/cambios.test.mjs`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { bloquesDe, cambiosEntreIndices, partesDe } from '../lib/cambios.mjs';

const require = createRequire(import.meta.url);

function articulo(eje, slug, title, body, extra = {}) {
  return { id: `${eje ?? '*'}::${slug}`, slug, eje, title, url: `/${eje ? `${eje}/` : ''}${slug}`, body, ...extra };
}

function indice(articulos) {
  return {
    schemaVersion: 1,
    build: { eje: { tipo: 'version', default: '19', valores: [{ id: '19', label: '19.0' }, { id: '18', label: '18.0' }] } },
    articulos,
  };
}

const REMITOS = '# Remitos\n\nEl remito sale de la entrega.\n';
const REMITOS_NUEVO = '# Remitos\n\nEl remito sale de la entrega validada.\n';

describe('cambiosEntreIndices', () => {
  it('two equal indexes change nothing', () => {
    const i = indice([articulo('19', 'remitos', 'Remitos', REMITOS)]);
    assert.deepEqual(cambiosEntreIndices(i, structuredClone(i)), {
      resumen: { modificadas: 0, nuevas: 0, borradas: 0 },
      paginas: [],
    });
  });

  it('a body that changes gives the word diff and the link to the page', () => {
    const { resumen, paginas } = cambiosEntreIndices(
      indice([articulo('19', 'remitos', 'Remitos', REMITOS)]),
      indice([articulo('19', 'remitos', 'Remitos', REMITOS_NUEVO)]),
    );
    assert.deepEqual(resumen, { modificadas: 1, nuevas: 0, borradas: 0 });
    assert.equal(paginas[0].estado, 'modificada');
    assert.deepEqual(paginas[0].versiones, [{ eje: '19', label: '19.0', url: '/19/remitos' }]);
    const cambio = paginas[0].bloques.find((b) => b.tipo === 'cambio');
    assert.deepEqual(
      cambio.partes.filter((p) => p.tipo !== 'igual'),
      [{ tipo: 'agregado', texto: ' validada' }],
    );
  });

  it('the same change in two versions is listed once, with the versions in the order of the axis', () => {
    const { paginas } = cambiosEntreIndices(
      indice([articulo('18', 'remitos', 'Remitos', REMITOS), articulo('19', 'remitos', 'Remitos', REMITOS)]),
      indice([articulo('18', 'remitos', 'Remitos', REMITOS_NUEVO), articulo('19', 'remitos', 'Remitos', REMITOS_NUEVO)]),
    );
    assert.equal(paginas.length, 1);
    assert.deepEqual(paginas[0].versiones.map((v) => v.eje), ['19', '18']);
  });

  it('a different change in each version is listed once per version', () => {
    const { paginas } = cambiosEntreIndices(
      indice([articulo('19', 'remitos', 'Remitos', REMITOS), articulo('18', 'remitos', 'Remitos', REMITOS)]),
      indice([articulo('19', 'remitos', 'Remitos', REMITOS_NUEVO), articulo('18', 'remitos', 'Remitos', '# Remitos\n\nOtro texto.\n')]),
    );
    assert.equal(paginas.length, 2);
  });

  it('new and deleted pages go after the modified ones; a deleted page keeps its old URL', () => {
    const { resumen, paginas } = cambiosEntreIndices(
      indice([articulo('19', 'remitos', 'Remitos', REMITOS), articulo('19', 'viejo', 'Viejo', 'Chau.\n')]),
      indice([articulo('19', 'remitos', 'Remitos', REMITOS_NUEVO), articulo('19', 'alta', 'Alta', 'Hola.\n')]),
    );
    assert.deepEqual(resumen, { modificadas: 1, nuevas: 1, borradas: 1 });
    assert.deepEqual(paginas.map((p) => [p.estado, p.titulo]), [
      ['modificada', 'Remitos'],
      ['nueva', 'Alta'],
      ['borrada', 'Viejo'],
    ]);
    assert.equal(paginas[2].versiones[0].url, '/19/viejo');
    assert.equal(paginas[1].bloques, undefined);
  });

  it('a new title or description is a field change, without a body diff', () => {
    const { paginas } = cambiosEntreIndices(
      indice([articulo('19', 'remitos', 'Remitos', REMITOS, { description: 'Cómo sale.' })]),
      indice([articulo('19', 'remitos', 'Remitos de venta', REMITOS, { description: 'Cómo sale el remito.' })]),
    );
    assert.deepEqual(paginas[0].campos.map((c) => c.campo), ['titulo', 'descripcion']);
    assert.deepEqual(paginas[0].bloques, []);
    assert.equal(paginas[0].titulo, 'Remitos de venta');
  });

  it('a page without a version has no label', () => {
    const { paginas } = cambiosEntreIndices(
      indice([articulo(null, 'glosario', 'Glosario', 'A.\n')]),
      indice([articulo(null, 'glosario', 'Glosario', 'B.\n')]),
    );
    assert.deepEqual(paginas[0].versiones, [{ eje: null, url: '/glosario' }]);
  });
});

describe('bloquesDe: the context around each change', () => {
  const texto = (n, prefijo = 'l') => Array.from({ length: n }, (_, i) => `${prefijo}${i + 1}`).join('\n') + '\n';

  it('keeps two lines before and after, and counts the rest', () => {
    const antes = texto(10) + 'viejo\n' + texto(10, 'm');
    const despues = texto(10) + 'nuevo\n' + texto(10, 'm');
    assert.deepEqual(
      bloquesDe(antes, despues).map((b) => b.tipo === 'cambio' ? 'cambio' : `${b.tipo}:${Array.isArray(b.lineas) ? b.lineas.join(',') : b.lineas}`),
      ['omitido:8', 'contexto:l9,l10', 'cambio', 'contexto:m1,m2', 'omitido:8'],
    );
  });

  it('shows a short stretch between two changes whole, and collapses a long one', () => {
    const corto = bloquesDe('a\nx\ny\nb\n', 'A\nx\ny\nB\n');
    assert.deepEqual(corto.map((b) => b.tipo), ['cambio', 'contexto', 'cambio']);
    const largo = bloquesDe(`a\n${texto(6)}b\n`, `A\n${texto(6)}B\n`);
    assert.deepEqual(largo.map((b) => b.tipo), ['cambio', 'contexto', 'omitido', 'contexto', 'cambio']);
    assert.equal(largo[2].lineas, 2);
  });

  it('a removed line is all removed', () => {
    assert.deepEqual(partesDe('fuera', ''), [{ tipo: 'quitado', texto: 'fuera' }]);
    assert.deepEqual(bloquesDe('a\nb\n', 'a\n'), [{ tipo: 'contexto', lineas: ['a'] }, { tipo: 'cambio', partes: [{ tipo: 'quitado', texto: 'b\n' }] }]);
  });
});

describe('the plugin registers /changes only with a base index', () => {
  function sitio(conBase) {
    const raiz = mkdtempSync(join(tmpdir(), 'cambios-'));
    mkdirSync(join(raiz, 'api', '_generated'), { recursive: true });
    mkdirSync(join(raiz, 'site'));
    writeFileSync(join(raiz, 'api', '_generated', 'index.json'), JSON.stringify(indice([articulo('19', 'remitos', 'Remitos', REMITOS_NUEVO)])));
    if (conBase) writeFileSync(join(raiz, 'base.json'), JSON.stringify(indice([articulo('19', 'remitos', 'Remitos', REMITOS)])));
    return join(raiz, 'site');
  }

  async function rutas(plugin) {
    const registradas = [];
    const datos = {};
    const content = await plugin.loadContent();
    await plugin.contentLoaded({
      content,
      actions: {
        addRoute: (r) => registradas.push(r),
        createData: async (nombre, texto) => {
          datos[nombre] = JSON.parse(texto);
          return `/datos/${nombre}`;
        },
      },
    });
    return { registradas, datos };
  }

  it('with the base index, the page and its data', async () => {
    const plugin = require('../lib/docusaurus-plugin.cjs')({ siteDir: sitio(true), baseUrl: '/' }, { indiceBase: '../base.json' });
    const { registradas, datos } = await rutas(plugin);
    assert.deepEqual(registradas[1], { path: '/changes', component: '@theme/ChangesPage', exact: true, modules: { cambios: '/datos/cambios.json' } });
    assert.equal(datos['cambios.json'].resumen.modificadas, 1);
  });

  it('without it, only /search', async () => {
    const plugin = require('../lib/docusaurus-plugin.cjs')({ siteDir: sitio(true), baseUrl: '/' });
    const { registradas } = await rutas(plugin);
    assert.deepEqual(registradas.map((r) => r.path), ['/search']);
  });

  it('a base index that is configured and missing fails the build', async () => {
    const plugin = require('../lib/docusaurus-plugin.cjs')({ siteDir: sitio(false), baseUrl: '/' }, { indiceBase: '../base.json' });
    await assert.rejects(plugin.loadContent(), /no existe el índice base/);
  });
});
