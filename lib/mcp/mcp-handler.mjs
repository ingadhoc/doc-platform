/**
 * MCP de la documentación — `https://<sitio>/api/mcp`. Núcleo unificado.
 *
 * El `api/mcp.mjs` de cada repo queda en tres líneas: importa su config, su
 * índice, y exporta lo que esto devuelve.
 *
 *   import { crearMcp } from '@ingadhoc/adhoc-doc-platform/mcp-handler.mjs';
 *   import * as indice from '../lib/mcp/indice.mjs';
 *   import { config } from '../docs.mcp.config.mjs';
 *   export const { handler, default: fetchHandler } = crearMcp({ config, indice });
 *
 * Es una Vercel Function con firma web estándar. El proyecto tiene
 * `framework: null`, así que no hay route handler de ningún framework: la
 * convención que aplica es el directorio `api/` y el export
 * `export default { fetch(request) }` (`Request` → `Response`), que es
 * justamente lo que devuelve `createMcpHandler` de mcp-handler 2.x.
 *
 * mcp-handler 2.x, no v1: `createMcpHandler(init, options)` + `server.registerTool`
 * con `inputSchema` como schema completo (`z.object({...})`). Nada de
 * `basePath` ni de `server.tool()` variádico — eso es la API v1 que todavía
 * muestra la doc de Vercel.
 *
 * Transporte: Streamable HTTP stateless, sin sesiones ni Redis — el problema
 * histórico de correr un MCP en serverless ya no existe. (Nota honesta: la
 * revisión 2026-07-28 del protocolo eliminó las sesiones, pero el server que
 * bundlea mcp-handler 2.1 todavía negocia 2025-11-25; el transporte corre
 * stateless igual, con `legacy: "stateless"`.)
 *
 * Auth: en las audiencias con gate, `withMcpAuth({required:true})` con un
 * bearer estático por consumidor (ver `auth.mjs`). En una audiencia pública,
 * sin auth (la protección es WAF rate limiting, configurado del lado de
 * Vercel). Un repo con una sola audiencia interna tiene el Bearer siempre:
 * es el mismo código, no un camino aparte.
 *
 * Env:
 *   DOCS_AUDIENCE               una de `config.audiencias`
 *   DOCS_URL                    origin del sitio (la misma que usa Docusaurus)
 *   DOCS_MCP_TOKENS             "tuqui:tok1,claude-code:tok2" (audiencia con gate)
 *   GITHUB_REPO                 repo donde se crean los issues de feedback
 *   DOCS_FEEDBACK_GITHUB_TOKEN  token con permiso de issues
 */

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';

import { consumidorDe, parsearTokens } from './auth.mjs';
import { CARTEL_MCP_INTERNO } from './gate.mjs';

/**
 * EL EJE: la palabra del dominio, derivada del `tipo` del contrato.
 *
 * `config.eje` es EL MISMO objeto que declara `docs.config.json`
 * (`{ tipo, default?, valores[] }`, ver `schema/docs.config.schema.json`): el
 * config y el índice hablan genérico, y esta función traduce el tipo a las
 * palabras que ve el LLM (diseno-eje.md §4). El nombre del parámetro es
 * prompt: `version: "Versión de Odoo…"` y el aviso de atribución entre
 * projects no son intercambiables para un agente.
 *
 * Nada de esto se declara por corpus: sale del tipo. Cada clave de `PROSA`
 * se puede pisar desde `config.eje` (override, no requisito) para el día que
 * un corpus necesite otro texto sin bifurcar el código.
 *
 * Las dos derivaciones que antes eran flags de config:
 *   · `desambiguaEnLeer` = el corpus NO declara `eje.default`. Es la misma
 *     regla única que aplica el motor (diseno-eje.md §3): `leer()` sólo elige
 *     cuando el config declaró a quién elegir.
 *   · `cross` (artículos que aplican a todos los valores del eje) = eje
 *     `version` —donde el comodín del motor está encendido— Y el corpus declara
 *     `config.secciones.fueraDelEje`. Las dos condiciones, no una: el comodín
 *     encendido sin secciones declaradas es un filtro sin contenido detrás, y
 *     esta prosa termina en la `description` de `buscar()` que lee el LLM. El
 *     texto nombra las secciones porque son la única forma de que el agente
 *     reconozca un hit cross al verlo.
 *
 * La decisión de diseño que sobrevive a los tres repos: el eje NO se expone
 * si el corpus no lo tiene. Ofrecerle a un agente un filtro que siempre
 * devuelve cero resultados es peor que no ofrecerlo — lo manda a reintentar
 * contra una pared y lo hace dudar del corpus. (Fix de odumbo-docs.)
 */
const PROSA = {
  version: {
    duro:
      'Los filtros por metadata son exactos y duros en los dos modos: `version` manda — si ' +
      'pedís la 19 no te van a venir artículos de la 18.',
    describeBuscar:
      'Versión de Odoo (p. ej. "19"). Filtro exacto y duro; los artículos que aplican a ' +
      'todas las versiones (`version: null`) pasan igual.',
    describeLeer:
      'Versión de Odoo. Si la omitís se devuelve la declarada por default en el corpus, y la ' +
      'respuesta lo dice (`elegidoPor: "default"`) y lista las otras en `otrosDelEje`. Un ' +
      'artículo que aplica a todas las versiones se devuelve para cualquiera que pidas.',
    describeFeedback: 'Versión de Odoo sobre la que se detectó.',
    cross: 'los que aplican a todas las versiones',
  },
  project: {
    duro:
      'Los filtros por metadata son exactos y duros: `project` manda — si pedís `oba` no te ' +
      'van a venir artículos de `odumbo`.',
    describeBuscar:
      'Project del patrón adhoc-way (p. ej. "adhoc-way", "oba", "odumbo"). Filtro exacto y ' +
      'duro. Ponelo siempre que sepas sobre qué producto te preguntaron.',
    describeLeer:
      'Project del artículo, tal como vino en el hit. Mandalo siempre: los nombres de ' +
      'archivo se repiten entre projects (todos tienen su `index`).',
    describeFeedback: 'Project del artículo. Sin esto, quien haga el triage no sabe a qué repo mandarlo.',
    cross: null,
  },
};

function describirEje(eje, config = {}) {
  if (!eje || eje.tipo === 'none' || !PROSA[eje.tipo]) return { hay: false };
  const base = PROSA[eje.tipo];
  const fueraDelEje = config.secciones?.fueraDelEje ?? [];
  // Sin secciones declaradas no hay contenido cross que anunciar, aunque el
  // eje sea `version` y el comodín del motor siga encendido. Un `cross` en
  // null saca la frase entera de la `description` de `buscar()`.
  const cross =
    eje.cross ??
    (base.cross && fueraDelEje.length
      ? `${base.cross}: ${fueraDelEje.map((s) => `\`${s}/\``).join(', ')}`
      : null);
  return {
    hay: true,
    tipo: eje.tipo,
    param: eje.tipo,
    duro: eje.duro ?? base.duro,
    describeBuscar: eje.describeBuscar ?? base.describeBuscar,
    describeLeer: eje.describeLeer ?? base.describeLeer,
    describeFeedback: eje.describeFeedback ?? base.describeFeedback,
    cross,
    // `leer()` devuelve la ambigüedad en vez de elegir cuando el corpus no
    // declara un default (política única del motor).
    desambiguaEnLeer: eje.default == null,
    // Multivaluado en `buscar()`: los dos ejes lo son.
    multiple: eje.multiple !== false,
  };
}

/**
 * ¿El corpus tiene eje ahora mismo? La config dice QUÉ eje; el índice dice SI
 * hay, y su palabra manda: un índice emitido con `eje.tipo: "none"` apaga el
 * parámetro aunque la config declare uno. Si el índice no opina (no se pudo
 * cargar), manda la config.
 */
function ejeHabilitado(eje, m) {
  if (!eje || eje.tipo === 'none') return false;
  if (!m) return true;
  if (m.eje?.tipo === 'none') return false;
  return true;
}

function esquemaEje(E, { multiple }) {
  if (!E.hay) return {};
  const tipo = multiple && E.multiple ? z.union([z.string(), z.array(z.string())]) : z.string();
  return {
    [E.param]: tipo.optional().describe(multiple ? E.describeBuscar : E.describeLeer),
  };
}

function texto(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Un 401 del path del MCP nunca debe traer un challenge `Basic`: los clientes
 * del TS SDK fallan en seco ante un challenge no-Bearer.
 *
 * Y tampoco debe apuntar a `/.well-known/oauth-protected-resource`: no lo
 * publicamos hasta que exista un authorization server de verdad (72391). Un
 * PRM que apunta a la nada hace que el cliente intente OAuth y falle con un
 * error confuso, en vez de mostrar "configurá el header". Por eso reescribimos
 * el challenge que arma `withMcpAuth` por un `Bearer` pelado.
 */
function challengePelado(handler) {
  return async (request) => {
    const respuesta = await handler(request);
    if (respuesta.status !== 401 && respuesta.status !== 403) return respuesta;
    const headers = new Headers(respuesta.headers);
    headers.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    headers.set('Cache-Control', 'no-store');
    return new Response(respuesta.body, {
      status: respuesta.status,
      statusText: respuesta.statusText,
      headers,
    });
  };
}

/**
 * Fail-closed TAMBIÉN EN LA FUNCIÓN, no solo en el edge.
 *
 * Los tres repos derivaban "¿lleva auth?" de `DOCS_AUDIENCE === 'interno'`
 * (o, en adhoc-docs, de nada: era incondicional). Con la variable ausente,
 * `INTERNO` es `false` y la función sirve el MCP SIN Bearer. Hoy no se nota
 * porque el gate del edge 503ea antes — pero el gate y la función son dos
 * capas, y la función se invoca sin pasar por el gate cuando alguien toca el
 * matcher del middleware (el modo de falla que `middleware.js` documenta como
 * "el bug, no el arreglo"). Unificar sin este chequeo le sacaría a adhoc-docs
 * su Bearer incondicional. Audiencia ausente o desconocida → 503 y nada más.
 */
function audienciaNoServible(audiencia, audiencias) {
  return () =>
    new Response(
      JSON.stringify({
        error: 'mcp-mal-configurado',
        mensaje: audiencia
          ? `DOCS_AUDIENCE="${audiencia}" no es una audiencia servible (esperaba ${audiencias.join(' | ')}). No se sirve nada.`
          : 'falta DOCS_AUDIENCE. No se sirve nada.',
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      },
    );
}

/**
 * Fail-closed: audiencia con gate sin tokens configurados no sirve NADA.
 * Decidir por "¿hay tokens?" en vez de por la audiencia dejaría el MCP con
 * auth abierto en silencio si alguien borra la variable — el mismo modo de
 * falla que el middleware evita.
 */
function todoCerrado() {
  return new Response(
    JSON.stringify({
      error: 'mcp-mal-configurado',
      mensaje: 'MCP con auth sin DOCS_MCP_TOKENS. No se sirve nada.',
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * Fabrica el handler del MCP.
 *
 * @param opciones.config  la config del corpus (ver README del paquete):
 *   nombre            `serverInfo.name`, p. ej. "oba-docs".
 *   version           `serverInfo.version`. Default "1.0.0".
 *   instructions      las instructions del server (DOMINIO del corpus).
 *   audiencias        audiencias que el repo sabe servir.
 *   audienciasConGate cuáles llevan auth. Default ['interno'].
 *   cartelMcp         { <audiencia>: texto } del GET. Compartido con el gate.
 *   eje               el objeto `eje` de `docs.config.json` ({tipo, default?,
 *                     valores}). Ver `describirEje()`.
 *   secciones         { fueraDelEje?: string[] } de `docs.config.json`. Es lo
 *                     que ENCIENDE la prosa cross de `buscar()` y lo que la
 *                     nombra: ausente o vacío, la frase no sale (ver
 *                     `describirEje()`). Opcional, y hoy ningún corpus lo
 *                     declara.
 *   filtros           { modules?: bool, seccion?: string|false } de `buscar()`.
 *   titulos           overrides de los `title` de las tools.
 * @param opciones.indice     módulo del índice: { indice, mapa, buscar, leer, PAGINA_BUSCAR }.
 * @param opciones.crearIssue el `crearIssue` de `feedback.mjs` ya configurado.
 */
export function crearMcp({ config, indice: idx, crearIssue }) {
  const audiencia = process.env.DOCS_AUDIENCE;
  // Default estricto, igual que el gate: un consumidor que se olvida de
  // declarar la lista obtiene el gate incondicional, no el sitio abierto.
  const audiencias = config.audiencias ?? ['interno'];
  const conGate = (config.audienciasConGate ?? ['interno']).includes(audiencia);

  // Antes de armar nada: si el deployment no declara una audiencia que este
  // repo sabe servir, la función no sirve. Ver `audienciaNoServible()`.
  if (!audiencias.includes(audiencia)) {
    const cerrado = audienciaNoServible(audiencia, audiencias);
    const handler = async () => cerrado();
    return { handler, default: { fetch: handler } };
  }

  const PAGINA_BUSCAR = idx.PAGINA_BUSCAR;

  // Scope de módulo: se evalúa una vez por instancia (Fluid Compute).
  const TOKENS = parsearTokens(process.env.DOCS_MCP_TOKENS);

  /**
   * El índice se carga acá, una vez por instancia, no por request: leer el
   * JSON y construir el índice de MiniSearch se paga una sola vez.
   * Si falla, NO tiramos al importar (eso deja la función muerta sin
   * diagnóstico): guardamos el error y cada tool lo reporta.
   */
  let errorIndice = null;
  try {
    idx.indice();
  } catch (error) {
    errorIndice = error;
    console.error('[mcp] no se pudo cargar el índice de la documentación:', error.message);
  }

  const m = errorIndice ? null : idx.mapa();
  const E = describirEje(ejeHabilitado(config.eje, m) ? config.eje : null, config);

  // La faceta `paises` la declara el ÍNDICE (`build.metadata.paises`), no el
  // config del repo: es el mismo criterio con el que `politicaDeEje()` decide
  // ofrecer el filtro adentro del motor. Declararla en dos lugares es la doble
  // fuente que se pudre — y una tool que ofrece un filtro que el motor no
  // aplica manda al agente contra una pared.
  const PAISES = Array.isArray(m?.metadata?.paises) && m.metadata.paises.length > 0 ? m.metadata.paises : null;

  /**
   * El prompt del filtro de país. Dice las TRES cosas que el LLM no puede
   * deducir del nombre del parámetro: que es duro, que EXCLUYE, y que la
   * ausencia de país en un artículo significa "todos" (no "ninguno").
   */
  const PROSA_PAISES =
    '`paises`: filtrá cuando la pregunta es de un país. El filtro es duro y excluye — ' +
    'un artículo de otro país no se devuelve. Un artículo sin país aplica a todos y se ' +
    'devuelve siempre.';

  // El cartel del GET habla según la audiencia: en un sitio PÚBLICO no hay
  // ningún token que configurar — decirle a un usuario que consiga uno que no
  // existe es mandarlo a cazar fantasmas.
  const CONTENIDO_MCP =
    config.cartelMcp?.[audiencia] ?? (conGate ? CARTEL_MCP_INTERNO : config.cartelMcp?.publico ?? CARTEL_MCP_INTERNO);

  function sinIndice() {
    return texto({
      error: 'indice-no-disponible',
      mensaje:
        'El índice de la documentación no se pudo cargar en esta instancia. ' +
        'Es un problema del deploy, no de tu query: reportalo y no inventes la respuesta.',
      detalle: errorIndice?.message,
    });
  }

  function registrar(server) {
    server.registerTool(
      'mapa',
      {
        title: config.titulos?.mapa ?? 'Mapa de la documentación',
        description:
          'Nivel 1 del índice: qué secciones, categorías' +
          (config.filtros?.modules ? ' y módulos' : '') +
          ' hay documentados, con conteos y el build id del índice' +
          (PAISES ? `, más los países del vocabulario (${PAISES.join(', ')})` : '') +
          (E.hay ? `, más los valores de \`${E.param}\` disponibles` : '') +
          '. Empezá por acá cuando la pregunta sea de navegación ("qué hay documentado de X")' +
          (E.hay ? ` o cuando no sepas a qué \`${E.param}\` pertenece el tema` : '') +
          '.',
        inputSchema: z.object({}),
      },
      async () => {
        if (errorIndice) return sinIndice();
        return texto(idx.mapa());
      },
    );

    server.registerTool(
      'buscar',
      {
        title: config.titulos?.buscar ?? 'Buscar en la documentación',
        description:
          'Búsqueda full-text sobre título, descripción, keywords, headings y CUERPO de los ' +
          'artículos, con boost por campo y prefix matching. ' +
          // El or-fallback ya no es una capacidad por repo: el motor es uno
          // (era `capacidades.orFallback`, true sólo en oba porque sólo su
          // `indice.mjs` lo tenía). Esta prosa es la mejor descripción de tool
          // de los tres y era la que se perdía al unificar.
          'Podés pasar la pregunta del cliente tal como la escribió: las palabras vacías ' +
          'del español no se indexan, y si ningún artículo contiene TODOS los términos, la ' +
          'búsqueda cae automáticamente a OR y te devuelve los que matchean más términos ' +
          'con `modo: "or-fallback"` más una `nota` (en ese modo, verificá pertinencia ' +
          'antes de citar). Igual, cuanto más precisos los términos, mejor rankea: el ' +
          'vocabulario del dominio le gana a la frase larga. ' +
          (E.hay
            ? E.duro +
              ' ' +
              (E.cross
                ? `La única excepción son los artículos CROSS-${E.param.toUpperCase()} (${E.cross}): ` +
                  `aparecen bajo cualquier filtro y vienen con \`${E.param}: null\` en el hit. `
                : '')
            : 'Los filtros por metadata son exactos y duros. ') +
          (PAISES ? PROSA_PAISES + ' ' : '') +
          'Devuelve hasta ' +
          PAGINA_BUSCAR +
          ' hits por página, cada uno con' +
          (E.hay ? ` su \`${E.param}\` y` : '') +
          ' sus headings para que puedas citar el deep-link al topic sin leer el artículo ' +
          'entero. Con 0 resultados (ni el OR encontró nada) devuelve hints accionables.',
        inputSchema: z.object({
          q: z
            .string()
            .min(1)
            .describe(
              'Términos a buscar; podés escribirlos con tildes y como los dijo el cliente ' +
                '(se normaliza solo). Los términos precisos del dominio rankean mejor.',
            ),
          ...esquemaEje(E, { multiple: true }),
          ...(config.filtros?.modules
            ? {
                modules: z
                  .union([z.string(), z.array(z.string())])
                  .optional()
                  .describe('Módulos técnicos. Matchea si el artículo declara alguno.'),
              }
            : {}),
          ...(PAISES
            ? {
                paises: z
                  .union([z.string(), z.array(z.string())])
                  .optional()
                  .describe(
                    `País del cliente, ISO alpha-2 (${PAISES.join(' | ')}). ` + PROSA_PAISES,
                  ),
              }
            : {}),
          ...(config.filtros?.seccion === false
            ? {}
            : {
                seccion: z
                  .union([z.string(), z.array(z.string())])
                  .optional()
                  .describe(config.filtros?.seccion ?? 'Sección del árbol.'),
              }),
          page: z.number().int().min(1).optional().describe('Página de resultados, base 1.'),
        }),
      },
      async (args) => {
        if (errorIndice) return sinIndice();
        return texto(idx.buscar(args));
      },
    );

    server.registerTool(
      'leer',
      {
        title: config.titulos?.leer ?? 'Leer un artículo',
        description:
          'Nivel 3: el markdown completo del artículo, su URL canónica y sus headings con ' +
          'anclas (para citar el deep-link al topic). Si el slug no existe NO da error: ' +
          'devuelve sugerencias por similitud y te pide re-ejecutar `buscar()`.' +
          (E.desambiguaEnLeer
            ? ` Si el mismo slug existe para varios \`${E.param}\` y no aclarás cuál, tampoco ` +
              'elige por su cuenta: te devuelve los candidatos.'
            : ''),
        inputSchema: z.object({
          slug: z.string().min(1).describe('Slug del artículo, tal como vino en un hit de `buscar()`.'),
          ...esquemaEje(E, { multiple: false }),
          page: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Página del cuerpo, base 1. Solo hace falta en artículos enormes.'),
        }),
      },
      async (args) => {
        if (errorIndice) return sinIndice();
        return texto(idx.leer(args));
      },
    );

    // `feedback()` SOLO se registra donde hay auth: en un MCP público sería un
    // endpoint anónimo de creación de issues, spameable con un curl o vía
    // prompt injection en un agente de cliente (spec §Feedback). En un repo de
    // una sola audiencia interna esto es siempre verdadero.
    if (conGate && crearIssue) {
      server.registerTool(
        'feedback',
        {
          title: config.titulos?.feedback ?? 'Reportar un problema de la documentación',
          description:
            'Cuando detectes que la documentación está mal, desactualizada o le falta algo ' +
            'mientras respondés, reportalo acá: crea un issue con label `docs-feedback` en el ' +
            'repo de la documentación' +
            (config.feedbackRutea ? ', que rutea al dueño del archivo' : '') +
            '. Es para agentes; el feedback de humanos va por otro lado.',
          inputSchema: z.object({
            slug: z.string().min(1).describe('Slug del artículo con el problema.'),
            problema: z.string().min(1).describe('Qué está mal o qué falta, concreto y accionable.'),
            ...(E.hay
              ? {
                  [E.param]: z
                    .string()
                    .optional()
                    .describe(E.describeFeedback),
                }
              : {}),
          }),
        },
        async (args, ctx) => {
          const clientId = ctx?.http?.authInfo?.clientId;
          const buildId = errorIndice ? 'desconocido' : idx.mapa().buildId;
          const resultado = await crearIssue({
            slug: args.slug,
            problema: args.problema,
            eje: E.hay ? args[E.param] : undefined,
            clientId,
            buildId,
          });
          return texto({ buildId, ...resultado });
        },
      );
    }
  }

  const base = createMcpHandler(registrar, {
    serverInfo: { name: config.nombre, version: config.version ?? '1.0.0' },
    instructions: config.instructions,
  });

  function respuestaInformativa(request) {
    return new Response(request.method === 'HEAD' ? null : CONTENIDO_MCP, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  }

  function verificarToken(_request, bearerToken) {
    const nombre = consumidorDe(TOKENS, bearerToken);
    if (!nombre) return undefined;
    // `clientId` = el consumidor. Es toda la trazabilidad que hay hoy: dentro
    // de Tuqui el token es de workspace, así que no hay identidad por usuario.
    return { token: bearerToken, clientId: nombre, scopes: [] };
  }

  const protegido = conGate
    ? TOKENS.length === 0
      ? todoCerrado
      : challengePelado(withMcpAuth(base, verificarToken, { required: true }))
    : base;

  async function handler(request) {
    // Mitigación del bug #82534 de Claude Code: su preflight de conectividad
    // omite los headers configurados y trata el 401 resultante como fatal. Un
    // GET/HEAD devuelve texto informativo, sin un solo dato del índice.
    // (El middleware hace lo mismo antes en las audiencias con gate; esto
    // cubre además al MCP público y a la función invocada sin pasar por el
    // gate.)
    if (request.method === 'GET' || request.method === 'HEAD') {
      return respuestaInformativa(request);
    }
    return protegido(request);
  }

  return { handler, default: { fetch: handler } };
}
