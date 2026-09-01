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
 *   3. `/oauth2/userinfo`   le preguntamos a Odoo quién es, y si nos contesta.
 *
 * Solo el paso 1 es un redirect; los otros dos los hace esta función, así que el
 * secreto del cliente nunca sale de acá.
 *
 * EL PASO 3 ES LA AUTORIZACIÓN, NO UN ADORNO. `oauth_provider` no sabe
 * restringir quién puede autorizar un cliente —no hay campo de grupos en
 * `oauth.provider.client`—, así que cualquiera que pueda loguearse en nuestro
 * Odoo completa el flujo, y ahí adentro están los miles de usuarios portal de
 * los clientes. El filtro vive en el scope (`DOCS_ODOO_SCOPE`): un
 * `oauth.provider.scope` sobre `res.users` con un `ir.filters` de
 * `share = False`, que hace que `userinfo` devuelva `{}` para todo el que no sea
 * interno. Por eso una respuesta vacía es un NO y no un "seguimos sin el
 * nombre". El qué configurar en Odoo está en `docs/login-con-odoo.md`.
 */

import {
  COOKIE_SESION,
  PROPOSITO_INTENTO,
  cookieDeSesion,
  firmarSesion,
  leerCookie,
  verificarSesion,
} from './mcp/sesion.mjs';

/** Cookie que recuerda el intento mientras la persona está en Odoo. */
export const COOKIE_INTENTO = 'docs_login';

const TTL_INTENTO = 10 * 60;
const CONFIG = [
  'DOCS_ODOO_URL',
  'DOCS_ODOO_CLIENT_ID',
  'DOCS_ODOO_CLIENT_SECRET',
  'DOCS_SESION_SECRET',
  // Sin default a propósito: el scope es el que decide quién es interno, así que
  // un valor por descarte sería una regla de acceso inventada por el paquete.
  'DOCS_ODOO_SCOPE',
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

/**
 * La URL del pedido, absoluta.
 *
 * NO ALCANZA CON `new URL(request.url)`. En el runtime de la función, Vercel
 * pasa `request.url` como RUTA RELATIVA (`/api/auth/login?volver=%2F`) y el
 * constructor tira `ERR_INVALID_URL`: las tres rutas de la puerta contestaban
 * 500 y nadie podía loguearse. En el edge la misma propiedad viene absoluta,
 * así que el gate andaba y esto solo se veía del lado de la función —
 * verificado en producción el 01/09/2026.
 *
 * De `request.url` salen SIEMPRE la ruta y la query. El origen lo pone el
 * proxy cuando lo dice, incluso si `request.url` traía uno: ahí puede venir el
 * host interno del hosting, y el `redirect_uri` tiene que ser el público o
 * Odoo no lo reconoce.
 */
export function urlDelPedido(request) {
  const delProxy = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  // El proto solo es `http` de verdad en desarrollo local.
  const proto =
    request.headers.get('x-forwarded-proto') ||
    (delProxy.startsWith('localhost') || delProxy.startsWith('127.0.0.1') ? 'http' : 'https');

  const url = new URL(request.url, delProxy ? `${proto}://${delProxy}` : undefined);
  if (delProxy) {
    url.protocol = proto;
    url.host = delProxy;
  }
  return url;
}

/**
 * A dónde vuelve Odoo. SALE DEL REQUEST, no de una variable.
 *
 * Una variable con la URL del sitio solo podía decir dos cosas: lo mismo que el
 * host real —y entonces sobra— o algo distinto, y entonces manda a la gente a
 * otro deployment. Eso último no es hipotético: con un valor fijo, cualquiera
 * que abriera un preview de PR se logueaba y terminaba en PRODUCCIÓN, con la
 * cookie en el dominio de producción, sin enterarse de que nunca vio el preview.
 *
 * Derivarlo del request no afeja nada aunque el `Host` lo controle quien llama:
 * la lista de `redirect_uri` válidos la valida Odoo. Un host inventado no
 * redirige a ningún lado — hace que Odoo rechace el login, que es lo que tiene
 * que pasar. Y un deployment cuyo host no esté registrado falla con un error de
 * Odoo a la vista, en vez de mandar a alguien a otro sitio en silencio.
 *
 * Se mira `x-forwarded-host` / `host` antes que `request.url` porque en el
 * runtime de la función esa URL puede venir con el host interno del hosting.
 */
export function redirectUri(request) {
  return `${urlDelPedido(request).origin}/api/auth/callback`;
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

  const volver = destinoSeguro(urlDelPedido(request).searchParams.get('volver'));
  const state = crypto.randomUUID();
  const intento = await firmarSesion({ state, volver }, env.DOCS_SESION_SECRET, {
    ttlSegundos: TTL_INTENTO,
    // Firmado como INTENTO. Esta cookie se la lleva cualquiera que pida la
    // puerta, sin credencial: si valiera como sesión, el gate estaría abierto.
    proposito: PROPOSITO_INTENTO,
  });

  const authorize = new URL('/oauth2/authorize', env.DOCS_ODOO_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.DOCS_ODOO_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', redirectUri(request));
  authorize.searchParams.set('scope', env.DOCS_ODOO_SCOPE);
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

  const params = urlDelPedido(request).searchParams;

  // Odoo avisa acá si la persona no autorizó, o si el cliente está mal armado.
  const errorDeOdoo = params.get('error');
  if (errorDeOdoo) return texto(`Odoo rechazó el login: ${errorDeOdoo}`, 403);

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return texto('Login incompleto: falta el code o el state.', 400);

  const intento = await verificarSesion(
    leerCookie(request.headers.get('cookie'), COOKIE_INTENTO),
    env.DOCS_SESION_SECRET,
    { proposito: PROPOSITO_INTENTO },
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
        // El mismo que el del paso 1: el callback llegó al host que lo emitió.
        redirect_uri: redirectUri(request),
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

  // ── Y ACÁ SE DECIDE SI ENTRA ────────────────────────────────────────────
  //
  // `userinfo` responde con los registros que deja ver el scope, y el scope de
  // la docu interna filtra por `share = False`. Traducido: si contesta con
  // datos, es alguien de Adhoc; si contesta `{}` con HTTP 200 —lo que pasa con
  // un usuario portal, y también con uno archivado—, no lo es.
  //
  // Que un `{}` sea un NO y no un "seguimos sin el nombre" es todo el control
  // de acceso: sin esto entran los miles de usuarios portal de los clientes,
  // porque el `authorize` de `oauth_provider` se lo permite a cualquiera que
  // pueda loguearse.
  //
  // Odoo caído es 502 y no 403: no es que la persona no pueda: es que no
  // pudimos preguntar, y ante la duda no se abre.
  let quien;
  try {
    const respuesta = await fetch(new URL('/oauth2/userinfo', env.DOCS_ODOO_URL), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!respuesta.ok) return texto(`Odoo no dijo quién sos (HTTP ${respuesta.status}).`, 502);
    quien = await respuesta.json();
  } catch {
    return texto('No se pudo preguntarle a Odoo quién sos.', 502);
  }

  if (!quien || Object.keys(quien).length === 0) {
    return texto(
      'Tu usuario de Odoo no tiene acceso a la documentación interna de Adhoc.',
      403,
    );
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

/**
 * Salir: se borra la cookie y listo. No hay nada que avisarle a Odoo —la sesión
 * es nuestra, no suya—, y por eso tampoco cierra la sesión de Odoo: quien hace
 * logout acá quiere salir de la documentación, no de todo.
 *
 * Sirve para la máquina prestada y para probar con otro usuario. NO es lo que
 * saca a quien se fue de Adhoc: eso lo hace archivar el usuario en Odoo, que
 * corta el próximo login y vence la sesión que esté viva en menos de
 * `TTL_POR_DEFECTO`.
 */
export async function manejarLogout(request, env = process.env) {
  const volver = destinoSeguro(urlDelPedido(request).searchParams.get('volver'));
  return new Response(null, {
    status: 302,
    headers: [
      ['Location', volver],
      ['Cache-Control', 'no-store'],
      // Mismos atributos que al ponerla, si no el browser la deja donde está.
      ['Set-Cookie', `${COOKIE_SESION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
    ],
  });
}

/**
 * LAS TRES RUTAS, LISTAS PARA MONTAR. El consumidor hace una línea por archivo:
 *
 *   export { puertaLogin as default } from '@ingadhoc/docs-platform/login-odoo';
 *
 * SON OBJETOS CON `fetch`, NO FUNCIONES, y no es un detalle de estilo: es lo
 * único que hace que el hosting las invoque con un `Request` web. Exportar una
 * función pelada hace que Vercel la trate como handler de Node y le pase
 * `(req, res)` — `request.headers.get` no existe, `request.url` es una ruta
 * relativa, y las tres rutas contestan 500. Pasó en producción el 01/09/2026,
 * con el sitio interno sin acceso humano hasta el fix.
 *
 * Es la misma forma que ya usaba `mcp-handler` (`default: { fetch: handler }`),
 * que por eso nunca tuvo el problema. Que vivan acá y no en el pegamento de
 * cada repo es para que el próximo sitio no lo vuelva a descubrir solo.
 */
export const puertaLogin = { fetch: (request) => manejarLogin(request) };
export const puertaCallback = { fetch: (request) => manejarCallback(request) };
export const puertaLogout = { fetch: (request) => manejarLogout(request) };
