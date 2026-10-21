/**
 * The site's search box: the indexes the build emits, the worker's answer and
 * the logic of the combobox. `node --test buscador.test.mjs`.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { indicesDelBuscador } from '../lib/buscador.mjs';
import { COMBOBOX_INICIAL, accionDeTecla, combobox, rutaDelHit, tramos } from '../lib/docusaurus-theme/buscador/logica.mjs';
import { respuestaDelBuscador } from '../lib/docusaurus-theme/buscador/respuesta.mjs';
import { crearMotor } from '../lib/mcp/motor.mjs';

const require = createRequire(import.meta.url);
const fixture = (nombre) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${nombre}.json`, import.meta.url), 'utf8'));

function articulo(eje, slug, title, body) {
  return { id: `${eje ?? '*'}::${slug}`, slug, eje, title, seccion: 'manual', url: `/${eje ? `${eje}/` : ''}${slug}`, keywords: [], headings: [], body };
}

const base = fixture('eje-version');
const conVersiones = {
  ...base,
  build: { ...base.build, eje: { tipo: 'version', default: '19', valores: [{ id: '19' }, { id: '18' }] }, articulos: 3 },
  articulos: [
    articulo('19', 'remitos', 'Configurar remitos', '# Configurar remitos\n\nEl remito sale de la entrega.\n'),
    articulo('18', 'remitos', 'Remitos en la 18', '# Remitos en la 18\n\nEl talonario.\n'),
    articulo(null, 'glosario', 'Glosario', '# Glosario\n\nRemito: el comprobante del traslado.\n'),
  ],
};

describe('indicesDelBuscador: lo que baja el navegador', () => {
  it('uno por versión, con los artículos sin versión en todos, y el de la versión por defecto aparte', () => {
    const indices = indicesDelBuscador(conVersiones);
    const slugs = Object.fromEntries(indices.map((i) => [i.archivo, i.crudo.articulos.map((a) => a.id).sort()]));
    assert.deepEqual(slugs, {
      '19.json': ['*::glosario', '19::remitos'],
      '18.json': ['*::glosario', '18::remitos'],
      'indice.json': ['*::glosario', '19::remitos'],
    });
    for (const { crudo } of indices) assert.equal(crudo.build.articulos, crudo.articulos.length);
  });

  it('sin eje de versión, un solo índice con todo', () => {
    const sinEje = { ...conVersiones, build: { ...conVersiones.build, eje: { tipo: 'project', valores: [{ id: 'a' }] } } };
    const indices = indicesDelBuscador(sinEje);
    assert.deepEqual(indices.map((i) => i.archivo), ['indice.json']);
    assert.equal(indices[0].crudo, sinEje);
  });

  it('cada índice lo arma el motor tal cual', () => {
    for (const { crudo } of indicesDelBuscador(conVersiones)) assert.ok(crearMotor(crudo).buscar({ q: 'remito' }).total > 0);
  });
});

describe('el plugin escribe los índices en el build', () => {
  it('postBuild deja buscador/<versión>.json desde api/_generated/index.json', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'buscador-'));
    mkdirSync(join(raiz, 'api', '_generated'), { recursive: true });
    mkdirSync(join(raiz, 'site'));
    writeFileSync(join(raiz, 'api', '_generated', 'index.json'), JSON.stringify(conVersiones));
    const plugin = require('../lib/docusaurus-plugin.cjs')({ siteDir: join(raiz, 'site'), baseUrl: '/' });
    await plugin.postBuild({ outDir: join(raiz, 'build') });
    assert.deepEqual(readdirSync(join(raiz, 'build', 'buscador')).sort(), ['18.json', '19.json', 'indice.json']);
  });

  it('registra la página de resultados en /search', async () => {
    const rutas = [];
    const plugin = require('../lib/docusaurus-plugin.cjs')({ siteDir: tmpdir(), baseUrl: '/' });
    await plugin.contentLoaded({ actions: { addRoute: (r) => rutas.push(r) } });
    assert.deepEqual(rutas, [{ path: '/search', component: '@theme/SearchPage', exact: true }]);
  });
});

describe('respuestaDelBuscador: lo que contesta el worker', () => {
  const motor = crearMotor(indicesDelBuscador(conVersiones)[0].crudo);

  it('busca con el perfil de la persona y trae los rangos a marcar', () => {
    const { total, resultados } = respuestaDelBuscador(motor, { q: 'remitos' });
    assert.equal(total, 2);
    const hit = resultados.find((h) => h.slug === 'remitos');
    assert.equal(hit.url, '/19/remitos');
    assert.deepEqual(hit.rangosTitulo, [{ pos: 11, largo: 7 }]);
    assert.ok(hit.resaltar.terminos.length + hit.resaltar.raices.length > 0);
  });

  it('lo que no está documentado da cero, no un relleno', () => {
    assert.equal(respuestaDelBuscador(motor, { q: 'impresora fiscal epson' }).total, 0);
  });
});

describe('logica: sin React ni DOM', () => {
  it('tramos parte el texto en lo marcado y lo que no', () => {
    assert.deepEqual(tramos('Costo de mercadería', [{ pos: 0, largo: 5 }, { pos: 9, largo: 10 }]), [
      { texto: 'Costo', marca: true },
      { texto: ' de ', marca: false },
      { texto: 'mercadería', marca: true },
    ]);
    assert.deepEqual(tramos('nada', []), [{ texto: 'nada', marca: false }]);
  });

  it('rutaDelHit va al ancla y respeta el baseUrl', () => {
    assert.equal(rutaDelHit({ url: '/19/x', urlAncla: '/19/x#y' }), '/19/x#y');
    assert.equal(rutaDelHit({ url: '/19/x', urlAncla: null }, '/docs/'), '/docs/19/x');
  });

  it('el primer resultado queda activo y las flechas dan la vuelta', () => {
    let e = combobox(COMBOBOX_INICIAL, { tipo: 'resultados', total: 3, abrir: true });
    assert.deepEqual(e, { abierto: true, activo: 0, total: 3 });
    e = combobox(e, { tipo: 'arriba' });
    assert.equal(e.activo, 2);
    e = combobox(e, { tipo: 'abajo' });
    assert.equal(e.activo, 0);
    assert.equal(combobox({ ...e, total: 0, activo: -1 }, { tipo: 'abajo' }).activo, -1);
  });

  it('con la lista cerrada, la flecha la abre sin mover el activo', () => {
    const e = combobox({ abierto: false, activo: 0, total: 3 }, { tipo: 'abajo' });
    assert.deepEqual(e, { abierto: true, activo: 0, total: 3 });
  });

  it('Enter elige el activo, Escape cierra y después limpia', () => {
    const abierto = { abierto: true, activo: 1, total: 3 };
    assert.deepEqual(accionDeTecla({ key: 'Enter' }, abierto), { tipo: 'elegir', indice: 1 });
    assert.equal(accionDeTecla({ key: 'Enter' }, { ...abierto, abierto: false }), null);
    assert.deepEqual(accionDeTecla({ key: 'Escape' }, abierto), { tipo: 'cerrar' });
    assert.deepEqual(accionDeTecla({ key: 'Escape' }, { ...abierto, abierto: false }), { tipo: 'limpiar' });
  });

  it('mientras se compone un acento o un ideograma, las teclas son del navegador', () => {
    assert.equal(accionDeTecla({ key: 'Enter', isComposing: true }, { abierto: true, activo: 0, total: 1 }), null);
  });
});

describe('la capa de theme resuelve en el build', () => {
  it('los imports relativos llevan extensión: el paquete es ESM y el bundler no la completa', () => {
    const raiz = fileURLToPath(new URL('../lib/docusaurus-theme/', import.meta.url));
    const sinExtension = [];
    for (const archivo of readdirSync(raiz, { recursive: true })) {
      if (!/\.m?js$/.test(archivo)) continue;
      const fuente = readFileSync(join(raiz, archivo), 'utf8');
      for (const [, ruta] of fuente.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
        if (!/\.m?js$/.test(ruta)) sinExtension.push(`${archivo}: ${ruta}`);
      }
    }
    assert.deepEqual(sinExtension, []);
  });
});
