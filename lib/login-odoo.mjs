/**
 * Login con el usuario de nuestro Odoo (task 72391). Corre del lado de la
 * función (runtime Node), no del edge: el gate solo verifica la cookie.
 *
 * SE LLAMA `login-odoo` Y NO `oidc` A PROPÓSITO. Nuestro Odoo tiene el
 * `oauth_provider` de OCA, que es OAuth2 pelado: sin discovery, sin JWKS y sin
 * `id_token`. Son tres endpoints y con eso alcanza:
 *
 *   1. `/oauth2/authorize`  mandamos a la persona a loguearse.
 *   2. `/oauth2/token`      cambiamos el `code` que trajo por un token.
 *   3. `/oauth2/userinfo`   le preguntamos a Odoo quién es (scope `userinfo`).
 *
 * Solo el paso 1 es un redirect; los otros dos los hace esta función, así que el
 * secreto del cliente nunca sale de acá.
 */

import { cookieDeSesion, firmarSesion, leerCookie, verificarSesion } from './mcp/sesion.mjs';

/** Cookie que recuerda el intento mientras la persona está en Odoo. */
export const COOKIE_INTENTO = 'docs_login';

const SCOPE = 'userinfo';
const TTL_INTENTO = 10 * 60;
const CONFIG = [
  'DOCS_ODOO_URL',
  'DOCS_ODOO_CLIENT_ID',
  'DOCS_ODOO_CLIENT_SECRET',
  'DOCS_SESION_SECRET',
  'DOCS_SITIO_URL',
];

function texto(cuerpo, status) {
  return new Response(cuerpo, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Fail-closed: si falta cualquiera de las cinco, el login dice qué falta y corta. */
function faltante(env) {
  const falta = CONFIG.filter((v) => !env[v]);
  return falta.length ? texto(`Login mal configurado: falta ${falta.join(', ')}.`, 503) : null;
}

/**
 * ¿Es un destino interno al sitio? Tiene que empezar con una sola `/`.
 * `//otro.com` y `/\otro.com` los lee el browser como otro host: sin esto,
 * `?volver=//sitio-de-otro` convierte al login en un trampolín.
 */
export function destinoSeguro(volver) {
  if (typeof volver !== 'string' || !volver.startsWith('/')) return '/';
  if (volver.startsWith('//') || volver.startsWith('/\\')) return '/';
  return volver;
}

function redirectUri(env) {
  return `${env.DOCS_SITIO_URL.replace(/\/$/, '')}/api/auth/callback`;
}

/**
 * Paso 1: mandar a la persona a loguearse a Odoo.
 *
 * El `state` viaja por dos caminos —en la URL hacia Odoo y firmado en una cookie
 * nuestra— y en el paso 2 tienen que coincidir: quien no puede escribir esa
 * cookie en tu browser no puede hacerte completar un login que arrancó él. A
 * dónde querías ir viaja en la misma cookie firmada, no en la URL.
 */
export async function manejarLogin(request, env = process.env) {
  const mal = faltante(env);
  if (mal) return mal;

  const volver = destinoSeguro(new URL(request.url).searchParams.get('volver'));
  const state = crypto.randomUUID();
  const intento = await firmarSesion({ state, volver }, env.DOCS_SESION_SECRET, {
    ttlSegundos: TTL_INTENTO,
  });

  const authorize = new URL('/oauth2/authorize', env.DOCS_ODOO_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.DOCS_ODOO_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri(env));
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE_INTENTO}=${intento}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_INTENTO}`,
    },
  });
}

/**
 * Paso 2: Odoo devolvió a la persona con un `code`. Lo cambiamos por un token,
 * preguntamos quién es y le dejamos la sesión firmada.
 *
 * Los problemas de Odoo son 502 y no 401: un 401 mandaría a la persona a
 * reintentar un login que no está roto de su lado.
 */
export async function manejarCallback(request, env = process.env) {
  const mal = faltante(env);
  if (mal) return mal;

  const params = new URL(request.url).searchParams;

  // Odoo avisa acá si la persona no autorizó, o si el cliente está mal armado.
  const errorDeOdoo = params.get('error');
  if (errorDeOdoo) return texto(`Odoo rechazó el login: ${errorDeOdoo}`, 403);

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return texto('Login incompleto: falta el code o el state.', 400);

  const intento = await verificarSesion(
    leerCookie(request.headers.get('cookie'), COOKIE_INTENTO),
    env.DOCS_SESION_SECRET,
  );
  if (!intento) return texto('El intento de login venció. Volvé a entrar.', 400);
  if (intento.state !== state) return texto('El state no coincide. Login descartado.', 400);

  let token;
  try {
    const respuesta = await fetch(new URL('/oauth2/token', env.DOCS_ODOO_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(env),
        client_id: env.DOCS_ODOO_CLIENT_ID,
        client_secret: env.DOCS_ODOO_CLIENT_SECRET,
      }),
    });
    if (!respuesta.ok) return texto(`Odoo no dio el token (HTTP ${respuesta.status}).`, 502);
    token = await respuesta.json();
  } catch {
    return texto('No se pudo hablar con Odoo para cambiar el code por un token.', 502);
  }
  if (!token?.access_token) return texto('Odoo devolvió una respuesta sin access_token.', 502);

  // LA IDENTIDAD SALE DE ACÁ, no de `/oauth2/userinfo`. El endpoint de token ya
  // devuelve `odoo_user_id`, y es el dato que importa: el id no cambia nunca y
  // es con lo que se sabe quién entró.
  //
  // No es una optimización, es lo único que funciona siempre. `userinfo` arma la
  // respuesta con un `search` sobre `res.users`, que excluye los archivados: con
  // un usuario archivado —como `admin` (id 2) en nuestras bases— devuelve `{}` y
  // el login se caería con una sesión válida en la mano. Verificado el 01/09/2026
  // contra test-adhoc-31-08-1.
  if (!token.odoo_user_id) return texto('Odoo no dijo de qué usuario es el token.', 502);

  // El email y el nombre son para mostrar, así que se piden aparte y si no
  // vienen, no pasa nada: la sesión ya tiene identidad.
  let quien = {};
  try {
    const respuesta = await fetch(new URL('/oauth2/userinfo', env.DOCS_ODOO_URL), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (respuesta.ok) quien = await respuesta.json();
  } catch {
    // Sin datos para mostrar, pero con sesión: seguimos.
  }

  const sesion = await firmarSesion(
    { sub: token.odoo_user_id, email: quien.email, nombre: quien.name },
    env.DOCS_SESION_SECRET,
  );

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', intento.volver],
      ['Cache-Control', 'no-store'],
      ['Set-Cookie', cookieDeSesion(sesion)],
      // El `code` es de un solo uso; el intento no tiene por qué sobrevivirlo.
      ['Set-Cookie', `${COOKIE_INTENTO}=; Path=/api/auth; HttpOnly; Secure; Max-Age=0`],
    ],
  });
}
