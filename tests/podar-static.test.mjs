/**
 * Suite de la poda de `static/`. `node --test podar-static.test.mjs`
 *
 * Cada caso arma una salida de build de mentira en un temporal: un `img/` con
 * archivos y unos artefactos textuales que referencian a algunos. No hace falta
 * Docusaurus — el contrato de la poda es "lo que ningún artefacto nombra se
 * va", y eso se escribe a mano, que es lo que permite testear los modos de
 * falla (referencia con baseUrl, referencia solo desde JSON, salida vacía).
 *
 * El caso que da nombre a todo esto es `la captura interna se poda`: reproduce
 * una fuga real —una imagen que solo estaba en un bloque :::interno, que por
 * eso no aparece en ninguna página del build público, y que igual se publicaba
 * porque `static/` se copia entero.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { podarStatic } from '../lib/podar-static.mjs';

/** Arma una salida de build: {archivos relativos → contenido}. */
function salidaDeMentira(archivos) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'podar-'));
  for (const [rel, contenido] of Object.entries(archivos)) {
    const p = path.join(raiz, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenido);
  }
  return raiz;
}

const PNG = 'binario-de-mentira';

describe('poda de la copia cruda de static/', () => {
  it('la captura interna se poda: no la referencia ninguna página del build público', () => {
    const salida = salidaDeMentira({
      // La pública: el HTML la sirve HASHEADA desde assets/images, así que por
      // ahí la copia cruda no se salva. Quien la mantiene viva es el índice
      // para agentes, que lleva el markdown con la ruta original.
      'index.html': '<img src="/assets/images/publica-abc123.png">',
      'assets/images/publica-abc123.png': PNG,
      'agente/md/una-pagina.md': '![Una captura](/img/publica.png)',
      // Las dos copias crudas de static/. La interna no la nombra nadie: su
      // bloque :::interno lo borró el preprocesador, así que no está ni en el
      // HTML ni en el índice de agentes del build público.
      'img/publica.png': PNG,
      'img/captura-solo-interna.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/captura-solo-interna.png']);
    assert.equal(fs.existsSync(path.join(salida, 'img/captura-solo-interna.png')), false);
    assert.equal(fs.existsSync(path.join(salida, 'img/publica.png')), true);
    // La copia procesada NO se toca: no vive en un subdir podable.
    assert.equal(fs.existsSync(path.join(salida, 'assets/images/publica-abc123.png')), true);
  });

  it('el índice para agentes mantiene viva la imagen aunque el HTML la sirva hasheada', () => {
    // Regresión del modo de falla que encontró el test de arriba: sin `.md`
    // entre los artefactos escaneados, la poda se lleva las imágenes de todo el
    // contenido que se consume por MCP y las deja rotas del lado del agente,
    // con el sitio viéndose perfecto.
    const salida = salidaDeMentira({
      'index.html': '<img src="/assets/images/x-deadbeef.png">',
      'agente/md/pagina.md': 'texto\n\n![alt](/img/x.png)\n',
      'img/x.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, [], 'la nombra el índice de agentes: no se poda');
  });

  it('conserva lo que se referencia desde cualquier artefacto textual, no solo HTML', () => {
    const salida = salidaDeMentira({
      'index.html': '<p>sin imágenes acá</p>',
      'assets/js/main.js': 'const logo = "/img/adhoc-iso.png";',
      'manifest.webmanifest': '{"icons":[{"src":"/img/favicon.ico"}]}',
      'assets/css/x.css': 'body { background: url(/img/fondo.png) }',
      'img/adhoc-iso.png': PNG,
      'img/favicon.ico': PNG,
      'img/fondo.png': PNG,
      'img/nadie-la-nombra.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    // El logo y el favicon sobreviven sin lista blanca: alcanza con que el
    // build los nombre.
    assert.deepEqual(r.podados, ['img/nadie-la-nombra.png']);
    assert.equal(r.referenciados, 3);
  });

  it('la referencia puede venir relativa o con baseUrl adelante', () => {
    const salida = salidaDeMentira({
      'index.html': '<img src="../../img/con-baseurl.png"><img src="/manual/img/con-prefijo.png">',
      'img/con-baseurl.png': PNG,
      'img/con-prefijo.png': PNG,
      'img/huerfana.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/huerfana.png']);
  });

  it('una URL EXTERNA que casualmente termina igual no salva al archivo local', () => {
    // Antes sí lo salvaba: se comparaba por nombre, así que
    // `https://cdn.example/x/absoluta.png` mantenía viva a `img/absoluta.png`,
    // que no tiene nada que ver.
    const salida = salidaDeMentira({
      'index.html': '<img src="https://cdn.example/otro-sitio/absoluta.png">',
      'img/absoluta.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/absoluta.png']);
  });

  it('DOS archivos con el mismo nombre: se poda el que nadie referencia', () => {
    // El bug que anulaba el bin entero. Con índice por basename, la pública
    // mantenía viva a la interna y la fuga seguía. Con capturas de manual
    // (captura.png, 1.png, factura.png) la colisión es lo normal, no el borde.
    const salida = salidaDeMentira({
      'agente/md/p.md': '![alt](/img/publico/captura.png)',
      'img/publico/captura.png': PNG,
      'img/interno/captura.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/interno/captura.png']);
    assert.equal(fs.existsSync(path.join(salida, 'img/publico/captura.png')), true);
  });

  it('un nombre que es SUFIJO de otro no lo salva', () => {
    // `"matrix.png".includes("x.png")` es true: con substring pelado, cualquier
    // nombre que fuera sufijo de otro mencionado en el build se conservaba.
    const salida = salidaDeMentira({
      'index.html': '<img src="/img/matrix.png">',
      'img/matrix.png': PNG,
      'img/x.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/x.png']);
  });

  it('un nombre con espacios se reconoce percent-encodeado y NO se borra estando en uso', () => {
    // El HTML emite `captura%20de%20pantalla.png`. Sin decodificar, el archivo
    // no matcheaba con su referencia y se borraba una imagen viva — probable en
    // un repo en español con capturas subidas a mano.
    const salida = salidaDeMentira({
      'index.html': '<img src="/img/captura%20de%20pantalla.png">',
      'img/captura de pantalla.png': PNG,
      'img/huerfana.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/huerfana.png']);
  });

  it('un SVG interno también se poda: es imagen, no solo contenedor de texto', () => {
    // `svg` está en TEXTUALES; si no está también en PODABLES, un diagrama
    // interno en SVG no es candidato y queda publicado para siempre.
    const salida = salidaDeMentira({
      'index.html': '<img src="/img/logo.svg">',
      'img/logo.svg': '<svg/>',
      'img/diagrama-interno.svg': '<svg/>',
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, ['img/diagrama-interno.svg']);
  });

  it('referencia ambigua sin directorio: se conserva y se REPORTA', () => {
    // Dos homónimos y una referencia que no dice cuál. Nadie puede saber a cuál
    // apuntaba: se conservan los dos y el caso sale en el reporte para que lo
    // mire una persona, en vez de resolverse a la suerte.
    const salida = salidaDeMentira({
      'index.html': '<img src="captura.png">',
      'img/a/captura.png': PNG,
      'img/b/captura.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados, []);
    assert.deepEqual(r.ambiguos.sort(), ['img/a/captura.png', 'img/b/captura.png']);
  });

  it('--extra suma dirs de afuera de la salida que también referencian', () => {
    // El índice del MCP vive fuera de site/build (api/_generated). Sin esto, una
    // imagen que solo él referencia se borra.
    const raiz = salidaDeMentira({
      'build/index.html': '<p>nada</p>',
      'build/img/solo-en-el-indice.png': PNG,
      'api/_generated/index.json': '{"body":"![x](/img/solo-en-el-indice.png)"}',
    });

    const r = podarStatic({
      salida: path.join(raiz, 'build'),
      subdirs: ['img'],
      extra: [path.join(raiz, 'api/_generated')],
    });

    assert.deepEqual(r.podados, []);
  });

  it('una imagen NO se salva por nombrarse desde otro archivo del subdir podable', () => {
    // El escaneo saltea los subdirs podables: si no, un `.svg` suelto ahí
    // adentro podría mantener viva a media carpeta. Los dos se van.
    const salida = salidaDeMentira({
      'index.html': '<p>nada</p>',
      'img/indice.svg': '<svg><image href="interna.png"/></svg>',
      'img/interna.png': PNG,
    });

    const r = podarStatic({ salida, subdirs: ['img'] });

    assert.deepEqual(r.podados.sort(), ['img/indice.svg', 'img/interna.png']);
  });

  it('--dry-run informa sin borrar', () => {
    const salida = salidaDeMentira({ 'index.html': '<p>nada</p>', 'img/huerfana.png': PNG });

    const r = podarStatic({ salida, subdirs: ['img'], dryRun: true });

    assert.deepEqual(r.podados, ['img/huerfana.png']);
    assert.equal(fs.existsSync(path.join(salida, 'img/huerfana.png')), true, 'dry-run no borra');
  });

  it('salida inexistente: error, no silencio', () => {
    const r = podarStatic({ salida: path.join(os.tmpdir(), 'no-existe-' + Date.now()), subdirs: ['img'] });
    assert.match(r.error, /no existe la salida/);
  });

  it('sin subdirs podables no hace nada y no rompe', () => {
    const salida = salidaDeMentira({ 'index.html': '<p>nada</p>' });
    const r = podarStatic({ salida, subdirs: ['img'] });
    assert.equal(r.candidatos, 0);
    assert.deepEqual(r.podados, []);
  });

  it('reporta los bytes liberados, que es lo que se mira para saber si sirvió', () => {
    const salida = salidaDeMentira({ 'index.html': '<p>nada</p>', 'img/pesada.png': 'x'.repeat(2048) });
    const r = podarStatic({ salida, subdirs: ['img'] });
    assert.equal(r.bytes, 2048);
  });
});
