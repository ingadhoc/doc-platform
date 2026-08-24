/**
 * La decisión del gate del sitio — TODA la lógica del middleware, separada
 * del runtime para poder testearla desde Node (`tests/middleware.test.mjs`):
 * recibe el request y el entorno, devuelve `null` si hay que dejar pasar, o
 * la `Response` a devolver. `middleware()` es esta función más el `next()`.
 *
 * ESM puro y sin builtins de Node (`atob`, `TextEncoder`, `Response` y `URL`
 * son globales tanto en el edge como en Node): apto para el bundle del edge.
 * NADA de `auth.mjs` acá: usa `node:crypto`, que en el edge no existe.
 *
 * UNIFICADO (etapa A) desde los tres forks: oba-docs, odumbo-docs y
 * adhoc-docs, y desde los dos entregables de esta etapa (el núcleo del MCP
 * parametrizó la fábrica; la capa de seguridad trajo la estrictez). Cuando
 * las dos diferían, gana la más estricta.
 *
 * ── FAIL-CLOSED SOBRE LA VARIABLE, NO SOLO SOBRE SU VALOR ──────────────────
 * En oba-docs la primera línea de `decidir()` era
 * `if (env.DOCS_AUDIENCE !== 'interno') return null`: con la variable sin
 * setear, el sitio quedaba público POR DESCARTE — el mismo modo de falla que
 * el guard de fuga ataca del lado del build, pero en runtime. Y las env vars
 * de Vercel se hornean en el build: un deployment buildeado ANTES de que la
 * variable existiera queda sin gate para siempre (le pasó a oba-docs).
 *
 * Acá la audiencia se valida contra la lista que el repo declara saber
 * servir (`config.audiencias`). Ausente o desconocida → 503, y el 503 corta
 * TODO: el HTML, el índice de búsqueda, los assets y el MCP **incluso con un
 * Bearer válido**. El costo es explícito: si alguien borra `DOCS_AUDIENCE` del
 * proyecto, el sitio devuelve 503 en vez de servir. Es la dirección segura, y
 * el buildCommand ya exige la variable de todos modos.
 *
 * DEFAULT DELIBERADAMENTE ESTRICTO: `['interno']`. Un consumidor que no
 * declara nada obtiene el comportamiento de adhoc-docs (gate incondicional,
 * cualquier audiencia distinta de `interno` es 503), no el de oba-docs
 * (público por descarte). Si el olvido tiene que costar algo, que cueste
 * disponibilidad y no una fuga. Y ese caso importa por una razón concreta:
 * adhoc-docs NO tiene el guard de fuga, así que el día que alguien ponga
 * `publico` ahí, mejor 503 que una fuga silenciosa.
 *
 * LOS PREVIEWS ENTRAN POR LA MISMA PUERTA: el gate no mira ninguna variable
 * de deployment del hosting — producción, preview de PR y branch alias pasan
 * por acá con la misma decisión. Hay un test que lo verifica sobre el CÓDIGO,
 * no sobre el comportamiento.
 *
 * Config (todo opcional; los defaults son los estrictos):
 *   audiencias         audiencias que este repo sabe servir, p. ej.
 *                      ['publico','interno'] o ['interno'].
 *                      Default ['interno'].
 *   audienciasConGate  cuáles llevan gate. Default ['interno'].
 *   realm              realm del challenge Basic (ASCII, ver abajo).
 *   rutaMcp            path de la función del MCP. Default '/api/mcp'.
 *   usuarioDefault     usuario Basic si no hay DOCS_AUTH_USER. Default 'adhoc'.
 *   cartelMcp          { <audiencia>: texto } del GET sin auth al MCP.
 *                      Compartido con el handler: un solo texto, no dos.
 *
 * La lista de audiencias viaja por CÓDIGO (config del consumidor) y no desde
 * `docs.config.json`: el edge no lee del filesystem. Es la única lista
 * duplicada de la plataforma; el drift-check del CI la compara.
 */

import { paresDeTokens } from './tokens.mjs';

// ASCII a propósito: los headers HTTP son ASCII, así que un acento acá sale
// percent-encoded y el browser se lo muestra crudo al usuario en el prompt
// de login (verificado en oba-docs: "Documentaci%C3%B3n").
export const REALM_DEFAULT = 'Documentacion interna de Adhoc';

/** Path de la función del MCP. Constante estática, no una env var: una env
 *  var acá es una superficie para dejar el MCP fuera del gate. */
export const RUTA_MCP_DEFAULT = '/api/mcp';

/**
 * Las audiencias que asume un consumidor que no declara ninguna: la estricta.
 * Ver el encabezado.
 */
export const AUDIENCIAS_POR_DEFECTO = ['interno'];

/**
 * Cartel del GET sin auth al MCP con auth. Texto plano, cero datos del
 * índice: es un cartel, no una tool. Mitiga el bug #82534 de Claude Code,
 * cuyo preflight de conectividad omite los headers configurados y trata el
 * 401 resultante como fatal.
 */
export const CARTEL_MCP_INTERNO =
  'MCP de documentación interna de Adhoc — configurá tu token.\n\n' +
  'Este endpoint habla MCP (Streamable HTTP) por POST. Un GET no te sirve de nada.\n' +
  'Para conectarte, mandá el header:\n\n' +
  '  Authorization: Bearer <token de tu consumidor>\n\n' +
  'Pedile el token a quien administra la documentación.\n';

/** Comparación en tiempo constante: no filtra la contraseña por timing. */
export function equal(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Longitudes distintas ya no son secretas, pero igual recorremos todo.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/**
 * ¿A qué consumidor pertenece este token? La gramática de la variable la
 * parsea `tokens.mjs` (compartido con la función); acá solo se compara.
 * Recorre TODAS las entradas sin cortar en el primer match: cortar antes
 * filtraría por timing en qué posición de la lista está el token válido.
 */
function consumidorDelToken(crudo, candidato) {
  if (!crudo || !candidato) return null;
  let encontrado = null;
  for (const { nombre, token } of paresDeTokens(crudo)) {
    if (equal(token, candidato)) encontrado = nombre;
  }
  return encontrado;
}

function malConfigurado(detalle) {
  // "Sitio", no "Sitio interno": el 503 lo puede ver cualquiera y no tiene por
  // qué contar si detrás hay un sitio interno.
  return new Response(`Sitio mal configurado: ${detalle}. No se sirve contenido.`, {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function pedirCredencial(realm) {
  return new Response('Necesitás autenticarte para ver la documentación interna.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * 401 para máquinas. NUNCA con challenge `Basic`: los clientes MCP del TS SDK
 * fallan en seco ante un challenge no-Bearer (`extractWWWAuthenticateParams`
 * devuelve `{}` y además borra el `resource_metadata` guardado). Va un `Bearer`
 * pelado, sin `resource_metadata`: no publicamos el Protected Resource Metadata
 * hasta que exista un authorization server de verdad (72391).
 */
function pedirToken() {
  return new Response('Token inválido o ausente. Mandá Authorization: Bearer <token>.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Bearer error="invalid_token"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function cartelMcp(metodo, texto) {
  return new Response(metodo === 'HEAD' ? null : texto, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * La audiencia NO es el eje del corpus (`version`/`project`): es ortogonal, y
 * el gate solo conoce la audiencia. Este encapsulado existe para que la única
 * lista duplicada del repo entre por config y no por una constante inline.
 */
function audienciaServible(env, audiencias) {
  const declarada = env.DOCS_AUDIENCE;
  if (audiencias.includes(declarada)) return null;
  return malConfigurado(
    declarada
      ? `DOCS_AUDIENCE="${declarada}" no es una audiencia servible (esperaba ${audiencias.join(' | ')})`
      : 'falta DOCS_AUDIENCE',
  );
}

/**
 * Fabrica el `decidir(request, env)` del repo. El middleware es
 * `decidir(request, process.env) ?? next()`.
 */
export function crearGate(config = {}) {
  const audiencias =
    Array.isArray(config.audiencias) && config.audiencias.length
      ? config.audiencias
      : AUDIENCIAS_POR_DEFECTO;
  const conGate = config.audienciasConGate ?? ['interno'];
  const realm = config.realm ?? REALM_DEFAULT;
  const rutaMcp = config.rutaMcp ?? RUTA_MCP_DEFAULT;
  const usuarioDefault = config.usuarioDefault ?? 'adhoc';
  const carteles = config.cartelMcp ?? { interno: CARTEL_MCP_INTERNO };

  return function decidir(request, env = process.env) {
    // Antes que nada: ¿este deployment declara una audiencia que sabemos
    // servir? No es el interruptor del gate, es el chequeo de que el build
    // está bien configurado, y corta todo lo que sigue —incluido el MCP con
    // un Bearer válido. El por qué, en el encabezado del archivo.
    const malaAudiencia = audienciaServible(env, audiencias);
    if (malaAudiencia) return malaAudiencia;

    // Las audiencias sin gate (el sitio público) pasan de largo sin costo. En
    // un repo que declara solo `['interno']` esta línea nunca se alcanza con
    // otra audiencia: el chequeo de arriba ya devolvió 503.
    if (!conGate.includes(env.DOCS_AUDIENCE)) return null;

    const esMcp = new URL(request.url).pathname === rutaMcp;
    const header = request.headers.get('authorization');

    if (esMcp) {
      // Fail-closed: sin tokens configurados, el MCP no atiende a nadie.
      // Decidir por "¿hay tokens?" lo dejaría abierto si alguien borra la
      // variable.
      if (!env.DOCS_MCP_TOKENS) return malConfigurado('falta DOCS_MCP_TOKENS');

      if (request.method === 'GET' || request.method === 'HEAD') {
        // El cartel va ante CUALQUIER GET sin Bearer válido, no solo sin
        // header: un browser autenticado en el sitio manda `Basic` en cada
        // request — justo los humanos a los que el cartel les habla
        // recibirían 401. Un Bearer válido pasa a la función (que también
        // responde el cartel).
        const tok = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
        if (tok && consumidorDelToken(env.DOCS_MCP_TOKENS, tok)) return null;
        return cartelMcp(request.method, carteles[env.DOCS_AUDIENCE] ?? CARTEL_MCP_INTERNO);
      }
      if (!header?.startsWith('Bearer ')) return pedirToken();
      if (!consumidorDelToken(env.DOCS_MCP_TOKENS, header.slice(7).trim())) return pedirToken();
      return null;
    }

    // Fuera del MCP también aceptamos Bearer: los consumidores máquina piden
    // los estáticos (`index.json`, los `.md`) además de hablar MCP.
    if (header?.startsWith('Bearer ')) {
      if (!env.DOCS_MCP_TOKENS) return pedirToken();
      return consumidorDelToken(env.DOCS_MCP_TOKENS, header.slice(7).trim()) ? null : pedirToken();
    }

    // Camino humano (Basic). Fail-closed POR CAPA: la contraseña de humanos
    // gatea a los humanos — sin ella no se sirve nada por Basic, pero las
    // máquinas con Bearer válido siguen andando (rotar la contraseña no tiene
    // por qué tirar el MCP ni los estáticos de los agentes).
    const esperada = env.DOCS_AUTH_PASSWORD;
    if (!esperada) return malConfigurado('falta DOCS_AUTH_PASSWORD');

    if (!header?.startsWith('Basic ')) return pedirCredencial(realm);

    let usuario, clave;
    try {
      const plano = atob(header.slice(6));
      const corte = plano.indexOf(':');
      if (corte < 0) return pedirCredencial(realm);
      usuario = plano.slice(0, corte);
      clave = plano.slice(corte + 1);
    } catch {
      return pedirCredencial(realm);
    }

    const usuarioOk = equal(usuario, env.DOCS_AUTH_USER || usuarioDefault);
    const claveOk = equal(clave, esperada);
    if (!(usuarioOk && claveOk)) return pedirCredencial(realm);

    return null;
  };
}

/**
 * La misma decisión, en la firma que consume `middleware.js` del repo:
 * `decidir(request, env, { audiencias })`. Existe además de `crearGate()`
 * porque el middleware del edge quiere una función y no una fábrica, y porque
 * es la firma con la que se midió la suite contra los tres gates originales.
 *
 * Sin `opciones.audiencias`, aplica el default estricto (`['interno']`).
 */
export function decidir(request, env = process.env, opciones = {}) {
  return crearGate(opciones)(request, env);
}
