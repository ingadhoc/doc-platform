/**
 * Suite del widget de Tuqui. `node --test tests/tuqui-embed.test.mjs`
 *
 * Dos cosas que se testean acá y en ningún otro lado:
 *
 * 1. **La ausencia.** Sin `TUQUI_EMBED_ID` el array tiene que salir vacío. Es la
 *    diferencia entre "el chat es opt-in del proyecto de Vercel" y "el chat se
 *    filtró al build interno y al fork de cualquiera".
 * 2. **El rechazo.** El id termina interpolado en un tag `<script>` del HTML de
 *    todas las páginas de un sitio público. Los casos malformados de acá abajo
 *    son el vector real: espacios, comillas y un `"><script` que cierra el tag.
 *
 * El env se pasa por parámetro a propósito: nada de tocar `process.env` en un
 * test, que después el orden de los archivos decide si pasa.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SRC_EMBED, tuquiEmbedScripts } from '../lib/tuqui-embed.mjs';

const ID = '3f2a9c14-8b7e-4d61-9a02-5e6c7d8f1234';

describe('sin la variable no hay widget', () => {
  it('env sin TUQUI_EMBED_ID devuelve []', () => {
    assert.deepEqual(tuquiEmbedScripts({}), []);
  });

  it('otras variables del entorno no la activan', () => {
    assert.deepEqual(tuquiEmbedScripts({ DOCS_URL: 'https://x', TUQUI: ID }), []);
  });

  it('declarada vacía (un `TUQUI_EMBED_ID=` en un .env) devuelve []', () => {
    assert.deepEqual(tuquiEmbedScripts({ TUQUI_EMBED_ID: '' }), []);
  });

  it('solo espacios devuelve [] — no rompe el build por un pegado vacío', () => {
    assert.deepEqual(tuquiEmbedScripts({ TUQUI_EMBED_ID: '   ' }), []);
  });
});

describe('con la variable válida, la forma exacta del script', () => {
  it('un solo script, con src, defer y data-embed-id y nada más', () => {
    assert.deepEqual(tuquiEmbedScripts({ TUQUI_EMBED_ID: ID }), [
      { src: 'https://tuqui.com/embed.js', defer: true, 'data-embed-id': ID },
    ]);
  });

  it('sin data-color: el estilo lo gobierna Tuqui, no el sitio', () => {
    const [script] = tuquiEmbedScripts({ TUQUI_EMBED_ID: ID });
    assert.deepEqual(Object.keys(script).sort(), ['data-embed-id', 'defer', 'src']);
    assert.equal('data-color' in script, false);
  });

  it('el src es el constante exportado, y `defer` es booleano true', () => {
    const [script] = tuquiEmbedScripts({ TUQUI_EMBED_ID: ID });
    assert.equal(script.src, SRC_EMBED);
    assert.equal(script.defer, true);
  });

  it('los espacios de alrededor se recortan y el id sale limpio', () => {
    const [script] = tuquiEmbedScripts({ TUQUI_EMBED_ID: `  ${ID}\n` });
    assert.equal(script['data-embed-id'], ID);
  });

  it('un UUID en mayúsculas también es válido', () => {
    const [script] = tuquiEmbedScripts({ TUQUI_EMBED_ID: ID.toUpperCase() });
    assert.equal(script['data-embed-id'], ID.toUpperCase());
  });
});

describe('con la variable malformada, el build aborta', () => {
  const rechazados = {
    'un espacio en el medio': '3f2a9c14-8b7e-4d61 9a02-5e6c7d8f1234',
    'dos ids pegados con un espacio': `${ID} ${ID}`,
    'comilla doble': `${ID}"`,
    'comilla simple': `'${ID}'`,
    'cierre de tag + script (el vector)': `${ID}"><script>alert(1)</script>`,
    'cierre de tag pelado': `${ID}>`,
    'atributo inyectado': `${ID}" onload="alert(1)`,
    'salto de línea en el medio': `${ID}\n<script>`,
    'no es un UUID': 'odumbo',
    'UUID sin guiones': ID.replaceAll('-', ''),
    'UUID con un grupo corto': '3f2a9c14-8b7e-4d61-9a02-5e6c7d8f123',
    'caracter no hexadecimal': '3f2a9c14-8b7e-4d61-9a02-5e6c7d8fzzzz',
  };

  for (const [caso, valor] of Object.entries(rechazados)) {
    it(`tira con ${caso}`, () => {
      assert.throws(
        () => tuquiEmbedScripts({ TUQUI_EMBED_ID: valor }),
        /TUQUI_EMBED_ID malformada/,
      );
    });
  }

  it('el mensaje nombra la variable y muestra el valor recibido', () => {
    assert.throws(() => tuquiEmbedScripts({ TUQUI_EMBED_ID: 'odumbo' }), (err) => {
      assert.match(err.message, /TUQUI_EMBED_ID/);
      assert.match(err.message, /UUID/);
      assert.match(err.message, /"odumbo"/);
      return true;
    });
  });

  it('un valor que no es string tampoco pasa', () => {
    assert.throws(
      () => tuquiEmbedScripts({ TUQUI_EMBED_ID: 123 }),
      /TUQUI_EMBED_ID tiene que ser un string/,
    );
  });
});

describe('el default del parámetro es process.env', () => {
  it('lee process.env cuando no se le pasa nada', () => {
    const previo = process.env.TUQUI_EMBED_ID;
    try {
      process.env.TUQUI_EMBED_ID = ID;
      assert.deepEqual(tuquiEmbedScripts(), [
        { src: SRC_EMBED, defer: true, 'data-embed-id': ID },
      ]);
    } finally {
      if (previo === undefined) delete process.env.TUQUI_EMBED_ID;
      else process.env.TUQUI_EMBED_ID = previo;
    }
  });
});
