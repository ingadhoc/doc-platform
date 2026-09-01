/**
 * Suite de la cookie de sesión. `node --test tests/sesion.test.mjs`
 *
 * Lo que se prueba no es "firma y verifica" —eso lo hace WebCrypto— sino los
 * casos en que la sesión NO tiene que valer: firma ajena, payload editado,
 * expirada, sin expiración, secreto rotado. Cada uno es una forma de entrar sin
 * ser nadie, que es exactamente lo que la task 72391 vino a cerrar.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COOKIE_SESION,
  cookieDeSesion,
  firmarSesion,
  leerCookie,
  verificarSesion,
} from '../lib/mcp/sesion.mjs';

const SECRETO = 'secreto-de-firma-de-prueba';
const VIB = { sub: 1866, email: 'vib@example.com', nombre: 'Virginia Bonservizi (vib)' };

describe('firmarSesion / verificarSesion — el camino feliz', () => {
  it('devuelve los datos de la persona que entró', async () => {
    const datos = await verificarSesion(await firmarSesion(VIB, SECRETO), SECRETO);
    assert.equal(datos.sub, 1866);
    assert.equal(datos.email, 'vib@example.com');
    assert.equal(datos.nombre, 'Virginia Bonservizi (vib)');
  });

  it('sobrevive a los acentos del nombre', async () => {
    // `btoa` tira con cualquier cosa fuera de latin1, así que el payload pasa
    // por UTF-8 antes de base64. Un nombre con acento es el caso de todos los
    // días, no un borde.
    const conAcento = { sub: 7, email: 'jjs@example.com', nombre: 'José Ñandú (jñ)' };
    const datos = await verificarSesion(await firmarSesion(conAcento, SECRETO), SECRETO);
    assert.equal(datos.nombre, 'José Ñandú (jñ)');
  });

  it('pone `exp` adentro de la firma, no solo en la cookie', async () => {
    const ahora = 1_700_000_000_000;
    const datos = await verificarSesion(
      await firmarSesion(VIB, SECRETO, { ttlSegundos: 60, ahora }),
      SECRETO,
      { ahora },
    );
    assert.equal(datos.exp, Math.floor(ahora / 1000) + 60);
  });
});

describe('verificarSesion — todo lo que NO tiene que pasar', () => {
  it('rechaza una cookie firmada con otro secreto', async () => {
    const ajena = await firmarSesion(VIB, 'otro-secreto-cualquiera');
    assert.equal(await verificarSesion(ajena, SECRETO), null);
  });

  it('rechaza un payload editado que conserva la firma vieja', async () => {
    // El ataque obvio: agarrar mi propia cookie y cambiarme el email por el de
    // otro. La firma es del cuerpo, así que dejar de cerrar es el punto.
    const valor = await firmarSesion(VIB, SECRETO);
    const [, firma] = valor.split('.');
    const otroCuerpo = btoa(JSON.stringify({ ...VIB, email: 'jefe@example.com', exp: 9e9 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.equal(await verificarSesion(`${otroCuerpo}.${firma}`, SECRETO), null);
  });

  it('rechaza una sesión expirada', async () => {
    const ahora = 1_700_000_000_000;
    const valor = await firmarSesion(VIB, SECRETO, { ttlSegundos: 60, ahora });
    assert.equal(await verificarSesion(valor, SECRETO, { ahora: ahora + 61_000 }), null);
  });

  it('rechaza un payload bien firmado pero SIN `exp`', async () => {
    // Se puede armar con el secreto en mano (o con código viejo que no ponía
    // expiración). Sin `exp` la sesión sería eterna: no se acepta.
    const cuerpo = btoa(JSON.stringify(VIB)).replace(/=+$/, '');
    const { subtle } = crypto;
    const clave = await subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRETO),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const firma = new Uint8Array(
      await subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo)),
    );
    let crudo = '';
    for (const b of firma) crudo += String.fromCharCode(b);
    const firmaB64 = btoa(crudo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(await verificarSesion(`${cuerpo}.${firmaB64}`, SECRETO), null);
  });

  it('fail-closed: sin secreto configurado no pasa nadie', async () => {
    const valor = await firmarSesion(VIB, SECRETO);
    assert.equal(await verificarSesion(valor, undefined), null);
    assert.equal(await verificarSesion(valor, ''), null);
  });

  it('rechaza basura sin explotar', async () => {
    for (const basura of [null, '', 'sin-punto', '.', 'a.b', '...', 'ñ.ñ']) {
      assert.equal(await verificarSesion(basura, SECRETO), null, `no rechazó: ${basura}`);
    }
  });
});

describe('leerCookie', () => {
  it('saca la cookie del header entre varias', () => {
    const header = `otra=1; ${COOKIE_SESION}=elvalor; tercera=3`;
    assert.equal(leerCookie(header), 'elvalor');
  });

  it('se queda con la ÚLTIMA cuando viene repetida', () => {
    // Pasa de verdad cuando conviven una cookie vieja de otro path y la nueva:
    // el browser manda las dos y quedarse con la primera dejaría afuera a
    // alguien que tiene una sesión válida.
    const header = `${COOKIE_SESION}=vieja; ${COOKIE_SESION}=nueva`;
    assert.equal(leerCookie(header), 'nueva');
  });

  it('no confunde una cookie cuyo nombre contiene al nuestro', () => {
    assert.equal(leerCookie(`${COOKIE_SESION}_previa=otra`), null);
  });

  it('devuelve null sin header y ante basura', () => {
    assert.equal(leerCookie(null), null);
    assert.equal(leerCookie(''), null);
    assert.equal(leerCookie('sin-igual'), null);
  });
});

describe('cookieDeSesion', () => {
  it('la sesión va HttpOnly, Secure y SameSite=Lax', () => {
    const cookie = cookieDeSesion('elvalor', { ttlSegundos: 60 });
    assert.match(cookie, /^docs_sesion=elvalor;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    // Lax y no Strict: la persona llega navegando desde Odoo, y con Strict el
    // browser no manda la cookie en ese primer request.
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=60/);
  });
});
