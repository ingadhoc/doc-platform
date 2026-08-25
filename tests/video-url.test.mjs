/**
 * Suite del parseo de URL del `<Video>`. `node --test tests/video-url.test.mjs`
 *
 * Se testea el parseo y NO el componente: pintar `Video.js` necesitaría React,
 * un renderer y un transpilador de JSX, o sea tres devDependencies en un
 * paquete que tiene CERO y las quiere seguir teniendo (corre en el build de
 * sitios públicos). La decisión de qué se pinta —embed o botón, con qué ID y
 * qué miniatura— está toda acá, que es lo que puede equivocarse en silencio.
 *
 * Las URLs de YouTube son las tres formas que aparecen en el contenido
 * migrado; las de Drive son las dos que usa el equipo para compartir grabaciones.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { idDeYoutube, parsearUrlVideo } from '../lib/video-url.mjs';

const ID = '9YpzkZ8Q5Ns';

describe('idDeYoutube — las tres formas de URL', () => {
  it('watch?v=<id>, la que copia la barra del navegador', () => {
    assert.equal(idDeYoutube(`https://www.youtube.com/watch?v=${ID}`), ID);
    assert.equal(idDeYoutube(`https://youtube.com/watch?v=${ID}`), ID);
    assert.equal(idDeYoutube(`http://m.youtube.com/watch?v=${ID}`), ID);
  });

  it('youtu.be/<id>, la del botón Compartir', () => {
    assert.equal(idDeYoutube(`https://youtu.be/${ID}`), ID);
  });

  it('embed/<id>, la que quedó en los iframes del contenido viejo', () => {
    assert.equal(idDeYoutube(`https://www.youtube.com/embed/${ID}`), ID);
    assert.equal(idDeYoutube(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
  });

  it('no se pierde con los parámetros de más que trae Compartir', () => {
    assert.equal(idDeYoutube(`https://youtu.be/${ID}?t=42&si=abcd`), ID);
    assert.equal(idDeYoutube(`https://www.youtube.com/watch?list=PL1&v=${ID}&index=2`), ID);
  });

  it('/live/ y /shorts/ comparten la forma de /embed/', () => {
    assert.equal(idDeYoutube(`https://www.youtube.com/live/${ID}`), ID);
    assert.equal(idDeYoutube(`https://www.youtube.com/shorts/${ID}`), ID);
  });

  it('devuelve null para lo que no es YouTube', () => {
    assert.equal(idDeYoutube('https://drive.google.com/file/d/1AbC/view'), null);
    assert.equal(idDeYoutube('https://vimeo.com/123456789'), null);
  });

  it('NO adivina: una URL de YouTube sin ID válido no es un embed', () => {
    // El ID tiene 11 caracteres del alfabeto base64url. Cualquier otra cosa
    // daría un iframe que carga la pantalla de error de YouTube adentro del
    // artículo — peor que un link.
    assert.equal(idDeYoutube('https://www.youtube.com/watch?v=corto'), null);
    assert.equal(idDeYoutube('https://youtu.be/tiene-muchisimos-caracteres'), null);
    assert.equal(idDeYoutube('https://www.youtube.com/'), null);
    assert.equal(idDeYoutube('https://www.youtube.com/@adhoc'), null);
  });

  it('no explota con basura ni con esquemas que no son http', () => {
    for (const v of [undefined, null, '', '   ', 42, {}, 'no es una url', 'javascript:alert(1)']) {
      assert.equal(idDeYoutube(v), null, `con ${JSON.stringify(v)}`);
    }
  });
});

describe('parsearUrlVideo — la decisión completa', () => {
  it('YouTube: miniatura derivada del ID y embed con autoplay', () => {
    const v = parsearUrlVideo(`https://youtu.be/${ID}`);
    assert.equal(v.tipo, 'youtube');
    assert.equal(v.id, ID);
    // hqdefault y no maxresdefault: la máxima resolución no existe para todos
    // los videos y el 404 se ve como un hueco gris.
    assert.equal(v.miniatura, `https://img.youtube.com/vi/${ID}/hqdefault.jpg`);
    assert.equal(v.embed, `https://www.youtube.com/embed/${ID}?autoplay=1`);
  });

  it('las tres formas colapsan al MISMO objeto', () => {
    const a = parsearUrlVideo(`https://www.youtube.com/watch?v=${ID}`);
    const b = parsearUrlVideo(`https://youtu.be/${ID}`);
    const c = parsearUrlVideo(`https://www.youtube.com/embed/${ID}`);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });

  it('Drive cae en enlace, no en un embed que va a fallar', () => {
    const u = 'https://drive.google.com/file/d/1AbCdEf/view?usp=sharing';
    assert.deepEqual(parsearUrlVideo(u), { tipo: 'enlace', url: u });
  });

  it('cualquier otra URL también cae en enlace', () => {
    assert.equal(parsearUrlVideo('https://vimeo.com/123456789').tipo, 'enlace');
    assert.equal(parsearUrlVideo('https://cdn.adhoc.com.ar/demo.mp4').tipo, 'enlace');
  });

  it('recorta los espacios que deja un copy/paste', () => {
    assert.deepEqual(parsearUrlVideo('  https://vimeo.com/1  '), {
      tipo: 'enlace',
      url: 'https://vimeo.com/1',
    });
  });

  it('sin URL utilizable devuelve null (el componente no pinta nada)', () => {
    for (const v of [undefined, null, '', '   ']) {
      assert.equal(parsearUrlVideo(v), null, `con ${JSON.stringify(v)}`);
    }
  });
});
