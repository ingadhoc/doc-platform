/**
 * Suite del login con el usuario de Odoo. `node --test tests/login-odoo.test.mjs`
 *
 * El ida y vuelta con Odoo se prueba con `fetch` sustituido: lo que importa acá
 * no es que Odoo conteste bien —eso se verifica contra la base de test— sino
 * qué hace esta función cuando Odoo contesta MAL, que es donde un login se
 * vuelve un agujero: state que no coincide, intento vencido, respuesta sin
 * identidad, destino de vuelta apuntando afuera.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COOKIE_INTENTO,
  destinoSeguro,
  manejarCallback,
  manejarLogin,
  manejarLogout,
} from '../lib/login-odoo.mjs';
import {
  COOKIE_SESION,
  PROPOSITO_INTENTO,
  firmarSesion,
  verificarSesion,
} from '../lib/mcp/sesion.mjs';

const ENV = {
  DOCS_ODOO_URL: 'https://test-adhoc.example.com',
  DOCS_ODOO_CLIENT_ID: 'un-client-id',
  DOCS_ODOO_CLIENT_SECRET: 'un-secreto',
  DOCS_SESION_SECRET: 'secreto-de-firma',
  DOCS_ODOO_SCOPE: 'docs_interna',
};

const get = (path, cookie, host = 'docs-interna.example.com') =>
  new Request(`https://${host}${path}`, {
    headers: cookie ? { cookie } : {},
  });

/** Sustituye `fetch` por respuestas de mentira y devuelve lo que se pidió. */
async function conFetch(respuestas, fn) {
  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url: String(url), init });
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return new Response(JSON.stringify(siguiente.cuerpo ?? {}), {
      status: siguiente.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    return { resultado: await fn(), pedidos };
  } finally {
    globalThis.fetch = original;
  }
}

/** Arma el par (cookie de intento, state) como lo dejaría el paso 1. */
async function intento(state, volver = '/19/manual/x') {
  const valor = await firmarSesion({ state, volver }, ENV.DOCS_SESION_SECRET, {
    ttlSegundos: 600,
    proposito: PROPOSITO_INTENTO,
  });
  return `${COOKIE_INTENTO}=${valor}`;
}

describe('paso 1 — mandar a la persona a Odoo', () => {
  it('redirige a /oauth2/authorize con lo que Odoo espera', async () => {
    const r = await manejarLogin(get('/api/auth/login?volver=%2F19%2Fmanual%2Fx'), ENV);
    assert.equal(r.status, 302);
    const destino = new URL(r.headers.get('location'));
    assert.equal(destino.origin, 'https://test-adhoc.example.com');
    assert.equal(destino.pathname, '/oauth2/authorize');
    assert.equal(destino.searchParams.get('response_type'), 'code');
    assert.equal(destino.searchParams.get('client_id'), 'un-client-id');
    // El scope no es decorativo: es el que filtra a los internos. Ver el
    // encabezado de `login-odoo.mjs`.
    assert.equal(destino.searchParams.get('scope'), 'docs_interna');
    assert.equal(
      destino.searchParams.get('redirect_uri'),
      'https://docs-interna.example.com/api/auth/callback',
    );
    assert.ok(destino.searchParams.get('state'));
  });

  it('el secreto del cliente NUNCA viaja al browser', async () => {
    const r = await manejarLogin(get('/api/auth/login'), ENV);
    const todo = r.headers.get('location') + (r.headers.get('set-cookie') ?? '');
    assert.ok(!todo.includes('un-secreto'));
  });

  it('deja el intento en una cookie firmada, no en la URL', async () => {
    const r = await manejarLogin(get('/api/auth/login?volver=%2Fx'), ENV);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`^${COOKIE_INTENTO}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\/api\/auth/);
    const valor = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    const datos = await verificarSesion(valor, ENV.DOCS_SESION_SECRET, {
      proposito: PROPOSITO_INTENTO,
    });
    assert.equal(datos.volver, '/x');
    assert.equal(datos.state, new URL(r.headers.get('location')).searchParams.get('state'));
  });

  it('dos logins seguidos no comparten el state', async () => {
    const uno = await manejarLogin(get('/api/auth/login'), ENV);
    const dos = await manejarLogin(get('/api/auth/login'), ENV);
    assert.notEqual(
      new URL(uno.headers.get('location')).searchParams.get('state'),
      new URL(dos.headers.get('location')).searchParams.get('state'),
    );
  });

  it('el redirect_uri sale del host del request, no de una variable', async () => {
    // Un preview de PR tiene otro host. Con un valor fijo, quien lo abría se
    // logueaba y terminaba en PRODUCCIÓN sin enterarse. Ahora el `redirect_uri`
    // apunta al deployment donde está parado: si ese host no está registrado en
    // Odoo, Odoo rechaza el login a la vista de todos.
    const preview = await manejarLogin(
      get('/api/auth/login', undefined, 'oba-docs-interno-git-mi-rama.vercel.app'),
      ENV,
    );
    assert.equal(
      new URL(preview.headers.get('location')).searchParams.get('redirect_uri'),
      'https://oba-docs-interno-git-mi-rama.vercel.app/api/auth/callback',
    );
  });

  it('un `x-forwarded-host` gana sobre el host interno del hosting', async () => {
    const r = await manejarLogin(
      new Request('https://algo-interno.vercel-internal/api/auth/login', {
        headers: { 'x-forwarded-host': 'wiki.adhoc.inc', 'x-forwarded-proto': 'https' },
      }),
      ENV,
    );
    assert.equal(
      new URL(r.headers.get('location')).searchParams.get('redirect_uri'),
      'https://wiki.adhoc.inc/api/auth/callback',
    );
  });

  it('sin configuración completa: 503 que dice qué falta', async () => {
    const { DOCS_ODOO_CLIENT_SECRET, ...incompleto } = ENV;
    const r = await manejarLogin(get('/api/auth/login'), incompleto);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /falta DOCS_ODOO_CLIENT_SECRET/);
  });
});

describe('destinoSeguro — que el login no sea un trampolín', () => {
  it('deja pasar rutas del sitio', () => {
    assert.equal(destinoSeguro('/19/manual/facturas?q=arca'), '/19/manual/facturas?q=arca');
  });

  it('manda a la home cualquier cosa que apunte afuera', () => {
    // `//otro.com` y `/\otro.com` los lee el browser como otro host: sin esto,
    // `?volver=//sitio-de-otro` te loguea en Odoo y te deja en otra parte.
    for (const afuera of [
      '//sitio-de-otro.com',
      '/\\sitio-de-otro.com',
      'https://sitio-de-otro.com',
      'sin-barra',
      '',
      null,
      undefined,
      42,
    ]) {
      assert.equal(destinoSeguro(afuera), '/', `no bloqueó: ${afuera}`);
    }
  });
});

describe('paso 2 — la vuelta de Odoo', () => {
  const OK_TOKEN = { cuerpo: { access_token: 'tok-de-odoo', odoo_user_id: 1866 } };
  const OK_QUIEN = { cuerpo: { id: 1866, email: 'vib@example.com', name: 'Virginia (vib)' } };

  it('camino feliz: deja la sesión firmada y devuelve a donde iba', async () => {
    const { resultado: r, pedidos } = await conFetch([OK_TOKEN, OK_QUIEN], async () =>
      manejarCallback(get('/api/auth/callback?code=un-code&state=abc', await intento('abc')), ENV),
    );

    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/19/manual/x');

    const cookies = r.headers.getSetCookie();
    const sesion = cookies.find((c) => c.startsWith(`${COOKIE_SESION}=`));
    const valor = sesion.slice(sesion.indexOf('=') + 1, sesion.indexOf(';'));
    const datos = await verificarSesion(valor, ENV.DOCS_SESION_SECRET);
    assert.equal(datos.sub, 1866);
    assert.equal(datos.email, 'vib@example.com');

    // El intento ya se usó: se borra.
    assert.ok(cookies.some((c) => c.startsWith(`${COOKIE_INTENTO}=;`) && c.includes('Max-Age=0')));

    // El secreto va al endpoint de token, por POST, y no en la URL.
    assert.match(pedidos[0].url, /\/oauth2\/token$/);
    assert.equal(pedidos[0].init.method, 'POST');
    assert.match(pedidos[0].init.body.toString(), /client_secret=un-secreto/);
    // El `redirect_uri` del intercambio tiene que ser IDÉNTICO al del paso 1, o
    // el proveedor rechaza el code. Sale del mismo lugar: el host del request.
    assert.match(
      pedidos[0].init.body.toString(),
      /redirect_uri=https%3A%2F%2Fdocs-interna.example.com%2Fapi%2Fauth%2Fcallback/,
    );
  });

  it('el state que no coincide se descarta', async () => {
    // El caso que importa: alguien te hace completar un login que arrancó él.
    const r = await manejarCallback(
      get('/api/auth/callback?code=un-code&state=el-mio', await intento('el-tuyo')),
      ENV,
    );
    assert.equal(r.status, 400);
    assert.match(await r.text(), /state no coincide/);
  });

  it('sin cookie de intento no se completa nada', async () => {
    const r = await manejarCallback(get('/api/auth/callback?code=un-code&state=abc'), ENV);
    assert.equal(r.status, 400);
  });

  it('un intento vencido no sirve', async () => {
    const viejo = await firmarSesion({ state: 'abc', volver: '/x' }, ENV.DOCS_SESION_SECRET, {
      ttlSegundos: 1,
      ahora: Date.now() - 10_000,
      proposito: PROPOSITO_INTENTO,
    });
    const r = await manejarCallback(
      get('/api/auth/callback?code=un-code&state=abc', `${COOKIE_INTENTO}=${viejo}`),
      ENV,
    );
    assert.equal(r.status, 400);
  });

  it('si Odoo avisa que la persona no autorizó, se dice', async () => {
    const r = await manejarCallback(get('/api/auth/callback?error=access_denied'), ENV);
    assert.equal(r.status, 403);
    assert.match(await r.text(), /access_denied/);
  });

  it('falta el code: 400', async () => {
    const r = await manejarCallback(get('/api/auth/callback?state=abc', await intento('abc')), ENV);
    assert.equal(r.status, 400);
  });

  it('Odoo caído es 502, no 401: el login no está roto del lado de la persona', async () => {
    const { resultado: r } = await conFetch([new Error('ECONNREFUSED')], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
  });

  it('token con HTTP de error: 502', async () => {
    const { resultado: r } = await conFetch([{ status: 401, cuerpo: {} }], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
    assert.match(await r.text(), /HTTP 401/);
  });

  it('respuesta sin access_token: 502', async () => {
    const { resultado: r } = await conFetch([{ cuerpo: { algo: 'otra cosa' } }], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
    assert.match(await r.text(), /sin access_token/);
  });

  it('sin `odoo_user_id` no hay sesión: entrar como nadie es lo que vinimos a sacar', async () => {
    const { resultado: r } = await conFetch([{ cuerpo: { access_token: 'tok' } }], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
    assert.match(await r.text(), /de qué usuario es el token/);
  });

  it('userinfo vacío es un NO: así se quedan afuera los usuarios portal', async () => {
    // ESTE ES EL CONTROL DE ACCESO. El `authorize` de `oauth_provider` se lo
    // permite a cualquiera que pueda loguearse en nuestro Odoo, y ahí adentro
    // están los miles de usuarios portal de los clientes. Lo único que los
    // separa de la documentación interna es el filtro del scope, que les hace
    // contestar `{}` — y esta línea, que lo lee como un no.
    const { resultado: r } = await conFetch([OK_TOKEN, { cuerpo: {} }], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 403);
    assert.match(await r.text(), /no tiene acceso a la documentación interna/);
    assert.equal(r.headers.getSetCookie().length, 0, 'no puede quedar sesión');
  });

  it('userinfo caído es 502 y tampoco deja sesión: ante la duda no se abre', async () => {
    const { resultado: r } = await conFetch([OK_TOKEN, new Error('timeout')], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
    assert.equal(r.headers.getSetCookie().length, 0);
  });

  it('userinfo con HTTP de error: 502, sin sesión', async () => {
    const { resultado: r } = await conFetch([OK_TOKEN, { status: 500, cuerpo: {} }], async () =>
      manejarCallback(get('/api/auth/callback?code=c&state=abc', await intento('abc')), ENV),
    );
    assert.equal(r.status, 502);
    assert.equal(r.headers.getSetCookie().length, 0);
  });
});

describe('la cookie del intento no es una sesión', () => {
  it('lo que reparte la puerta sin credencial no abre el gate', async () => {
    // El agujero que esto cierra: `/api/auth/login` pasa sin credencial y
    // contesta con una cookie firmada. Si esa cookie valiera como sesión,
    // cualquiera desde internet la pedía, le cambiaba el nombre a `docs_sesion`
    // y entraba a toda la documentación interna sin pasar por Odoo.
    const r = await manejarLogin(get('/api/auth/login?volver=%2Fx'), ENV);
    const cookie = r.headers.get('set-cookie');
    const valor = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));

    assert.equal(await verificarSesion(valor, ENV.DOCS_SESION_SECRET), null);
    assert.ok(
      await verificarSesion(valor, ENV.DOCS_SESION_SECRET, { proposito: PROPOSITO_INTENTO }),
      'como intento sí tiene que valer',
    );
  });

  it('y una sesión tampoco vale como intento', async () => {
    const sesion = await firmarSesion({ sub: 1866, state: 'abc' }, ENV.DOCS_SESION_SECRET);
    const r = await manejarCallback(
      get('/api/auth/callback?code=c&state=abc', `${COOKIE_INTENTO}=${sesion}`),
      ENV,
    );
    assert.equal(r.status, 400);
  });
});

describe('salir', () => {
  it('borra la cookie de sesión y devuelve a donde se pidió', async () => {
    const r = await manejarLogout(get('/api/auth/logout?volver=%2F19%2Fmanual%2Fx'), ENV);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/19/manual/x');
    const cookie = r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_SESION}=`));
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Path=\//);
  });

  it('el destino de vuelta se valida igual que en el login', async () => {
    const r = await manejarLogout(get('/api/auth/logout?volver=%2F%2Fsitio-de-otro.com'), ENV);
    assert.equal(r.headers.get('location'), '/');
  });
});
