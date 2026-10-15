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

/** Lo que un cliente puede dejar de la `description` de una tool: Tuqui corta ahí. */
export const LARGO_ESENCIAL = 600;

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
 *   · `cross` (artículos que aplican a todos los valores del eje) = lo que
 *     MIDE el índice: `seccionesConComodin()` devuelve las secciones que
 *     tienen artículos sin valor de eje, y ya incluye la condición del eje
 *     (sin comodín devuelve vacío). No se declara en ningún config: una
 *     declaración no se entera de que el contenido se movió, y esta prosa
 *     termina en la `description` de `buscar()` que lee el LLM. El texto
 *     nombra las secciones porque son la única forma de que el agente
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
    describeBuscar: 'Versión de Odoo (p. ej. "19"). Filtro exacto y duro.',
    describeLeer:
      'Versión de Odoo. Si la omitís se devuelve la declarada por default en el corpus, y la ' +
      'respuesta lo dice (`elegidoPor: "default"`) y lista las otras en `otrosDelEje`.',
    describeFeedback: 'Versión de Odoo sobre la que se detectó.',
    cross: 'los que aplican a todas las versiones',
    // Las dos frases del comodín, separadas de su prosa base: las enciende el
    // MISMO contenido que enciende `cross`, no el tipo de eje.
    crossBuscar: ' Los artículos que aplican a todas las versiones (`version: null`) pasan igual.',
    crossLeer: ' Un artículo que aplica a todas las versiones se devuelve para cualquiera que pidas.',
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
    crossBuscar: null,
    crossLeer: null,
  },
};

function describirEje(eje, seccionesConComodin = []) {
  if (!eje || eje.tipo === 'none' || !PROSA[eje.tipo]) return { hay: false };
  const base = PROSA[eje.tipo];
  // Sin artículos bajo el comodín no hay contenido cross que anunciar, aunque
  // el eje sea `version` y el comodín del motor siga encendido. Un `cross` en
  // null saca la frase entera de la `description` de `buscar()`.
  const cross =
    eje.cross ??
    (base.cross && seccionesConComodin.length
      ? `${base.cross}: ${seccionesConComodin.map((s) => `\`${s}/\``).join(', ')}`
      : null);
  return {
    hay: true,
    tipo: eje.tipo,
    param: eje.tipo,
    duro: eje.duro ?? base.duro,
    // El comodín del motor sigue encendido con eje `version` —un artículo con
    // `eje: null` pasa cualquier filtro—, pero eso es una capacidad, no una
    // promesa: sin secciones declaradas no hay un solo artículo detrás, y la
    // frase le ofrece al agente algo que el corpus no tiene. Un override de
    // config pisa la frase entera, cross incluido.
    describeBuscar: eje.describeBuscar ?? base.describeBuscar + (cross ? base.crossBuscar ?? '' : ''),
    describeLeer: eje.describeLeer ?? base.describeLeer + (cross ? base.crossLeer ?? '' : ''),
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
  // Las secciones con comodín las MIDE el índice, no las declara el config
  // (`secciones.fueraDelEje`). Una declaración no se entera de que el contenido
  // se movió: entre la #73556 y la v0.8.0 oba-docs anunció artículos
  // `version: null` que ya no existían porque nadie se acordó de apagar el
  // campo. El `?.` cubre al índice que no cargó y al fake de un test viejo.
  const seccionesComodin = errorIndice ? [] : (idx.seccionesConComodin?.() ?? []);
  const E = describirEje(ejeHabilitado(config.eje, m) ? config.eje : null, seccionesComodin);

  // La faceta `paises` la declara el ÍNDICE (`build.metadata.paises`), no el
  // config del repo: es el mismo criterio con el que `politicaDeEje()` decide
  // ofrecer el filtro adentro del motor. Declararla en dos lugares es la doble
  // fuente que se pudre — y una tool que ofrece un filtro que el motor no
  // aplica manda al agente contra una pared.
  const PAISES = Array.isArray(m?.metadata?.paises) && m.metadata.paises.length > 0 ? m.metadata.paises : null;
  const PAIS_POR_DEFECTO = PAISES?.includes(m.metadata.paisPorDefecto) ? m.metadata.paisPorDefecto : null;

  // Los doc sets, por el mismo camino y por el mismo motivo: lo dice el índice.
  // Cada entrada es `{id, label}` — el id es lo que filtra, el label es lo que
  // el LLM necesita para saber QUÉ es cada uno sin abrir un artículo.
  // Se normaliza igual que en `politicaDeEje()`: el vocabulario se acepta como
  // objetos `{id,label}` o como strings pelados, y sin esto la prosa que lee el
  // LLM sale `\`undefined\` = undefined` — justo en el texto que existe para
  // darle los ids.
  const DOC_SETS_CRUDOS = Array.isArray(m?.metadata?.docSets) ? m.metadata.docSets : [];
  const DOC_SETS = DOC_SETS_CRUDOS.length
    ? DOC_SETS_CRUDOS.map((d) =>
        typeof d === 'string' ? { id: d, label: d } : { id: String(d.id), label: String(d.label ?? d.id) },
      )
    : null;

  // Los idiomas, por el mismo camino: los declara el ÍNDICE (`mapa().idiomas`,
  // que sólo viaja cuando el índice trae varios). Sin idiomas el parámetro no
  // se ofrece y el motor se comporta como siempre. "Varios" es más de uno, el
  // mismo criterio que `politicaDeIdioma().multi` en el motor.
  const IDIOMAS = Array.isArray(m?.idiomas?.valores) && m.idiomas.valores.length > 1 ? m.idiomas : null;
  const LISTA_IDIOMAS = IDIOMAS ? IDIOMAS.valores.map((v) => `\`${v.id}\` = ${v.label}`).join(' · ') : '';
  const esquemaIdioma = (describe) =>
    IDIOMAS ? { idioma: z.string().optional().describe(`Idioma de la documentación (${LISTA_IDIOMAS}). ${describe}`) } : {};

  /**
   * El prompt del filtro de documentación. Dice las tres cosas que el nombre
   * del parámetro no dice: que es duro, qué separa, y —lo importante— que
   * mezclar las dos documentaciones produce una respuesta equivocada, no solo
   * ruidosa. Un agente que cita una nota de cambio como procedimiento vigente
   * le está diciendo al cliente que haga algo que ya no se hace así.
   */
  const PROSA_DOC_SETS = DOC_SETS
    ? '`docSet`: cuál de las documentaciones del corpus (' +
      DOC_SETS.map((d) => `\`${d.id}\` = ${d.label}`).join(' · ') +
      '). El filtro es duro y excluye. Filtrá cuando la pregunta es claramente de una sola: ' +
      'cómo se hace algo hoy no vive en la misma documentación que qué cambió respecto de la ' +
      'versión anterior. Sin filtro se buscan todas y la respuesta avisa si mezcló.'
    : '';

  /**
   * El prompt del filtro de país. Dice las TRES cosas que el LLM no puede
   * deducir del nombre del parámetro: que es duro, que EXCLUYE, y que la
   * ausencia de país en un artículo significa "todos" (no "ninguno").
   */
  const PROSA_PAISES =
    '`paises`: filtrá cuando la pregunta es de un país. El filtro es duro y excluye — ' +
    'un artículo de otro país no se devuelve. Un artículo sin país aplica a todos y se ' +
    'devuelve siempre.' +
    (PAIS_POR_DEFECTO
      ? ` Sin \`paises\`, los artículos de otro país bajan en el orden (no se excluyen): se prefiere ` +
        `el país que nombra la consulta o, si no nombra ninguno, \`${PAIS_POR_DEFECTO}\`, el del sitio. ` +
        'La respuesta dice cuál en `paisesAplicados` y `paisElegidoPor`; si el usuario es de otro ' +
        'país, filtrá por el suyo.'
      : '');

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

  /**
   * Las `description` de las tools van en dos partes: lo esencial primero y el
   * detalle después. Hay clientes que las cortan (Tuqui, a `LARGO_ESENCIAL`
   * caracteres, en el último espacio antes del tope), y lo que el agente tiene
   * que saber sí o sí —qué hace la tool, que un hit no es fuente, qué hacer con
   * las señales de resultado pobre, que declinar está bien, qué filtros poner—
   * no puede quedar del otro lado del corte. Un test lo verifica sobre la
   * descripción armada, para cada combinación de facetas.
   */
  // Un corpus que apaga el filtro de sección (`filtros.seccion: false`) tampoco
  // lo ofrece en `mapa`.
  const CON_SECCION = config.filtros?.seccion !== false;
  const PALABRA_DEL_FILTRO = { version: 'la versión', project: 'el producto' };
  const filtrosNombrables = [
    ...(E.hay && PALABRA_DEL_FILTRO[E.param] ? [[PALABRA_DEL_FILTRO[E.param], E.param]] : []),
    ...(PAISES ? [['el país', 'paises']] : []),
  ];
  const ESENCIAL = {
    buscar: [
      `Busca en la documentación y devuelve hasta ${PAGINA_BUSCAR} artículos por página, cada ` +
        'uno con el `fragmento` y la `urlAncla` de lo que matcheó.',
      'Un hit no es fuente: el match es por palabras, así que antes de citar leé el artículo o ' +
        'su sección con `leer` y verificá que responda.',
      'Con `modo: "or-fallback"` o `resultadosDebiles: true` ningún artículo tiene todo lo ' +
        'pedido: verificá o reformulá.',
      'Si nada responde, decí que la documentación no lo cubre: declinar es correcto.',
      ...(filtrosNombrables.length
        ? [
            `Si la pregunta nombra ${filtrosNombrables.map(([p]) => p).join(' o ')}, filtrá por ` +
              `${filtrosNombrables.map(([, f]) => `\`${f}\``).join(' o ')}.`,
          ]
        : []),
    ],
    leer: [
      'Lee un artículo: el markdown, su `url` canónica y sus `headings` con anclas. Es lo que ' +
        'podés citar.',
      'Con `ancla` (el `id` de un heading, o el `ancla.id` de un hit de `buscar`) devuelve sólo ' +
        'esa sección, hasta el siguiente heading de igual o mayor nivel, con su `urlAncla`: ' +
        'preferila cuando el hit ya dice dónde está.',
      'Si el slug o el ancla no existen no da error: devuelve sugerencias o las anclas disponibles.',
    ],
    mapa: [
      'Qué hay documentado' +
        (CON_SECCION ? '. Sin `seccion`: las secciones' : ': las secciones') +
        ' y categorías' +
        (config.filtros?.modules ? ' y módulos' : '') +
        ', con conteos.',
      ...(CON_SECCION ? ['Con `seccion`: los artículos de esa sección con su `description`, paginados (`page`).'] : []),
      'Empezá por acá cuando la pregunta sea de navegación ("qué hay documentado de X")' +
        (E.hay ? ` o no sepas a qué \`${E.param}\` pertenece el tema` : '') +
        '.',
    ],
  };

  const DETALLE = {
    buscar: [
      'Busca en título, descripción, keywords, headings y cuerpo. Podés pasar la pregunta tal ' +
        'como la escribieron: las palabras vacías no se indexan y, si ' +
        'ningún artículo tiene TODOS los términos, la búsqueda cae a OR (`or-fallback`), con la ' +
        '`cobertura` de cada hit y los `terminosAusentes` del corpus. Los términos del dominio ' +
        'rankean mejor que la frase larga.',
      // La contracara del or-fallback (75201): el match confiado y equivocado
      // no tiene señal medible, así que la obligación vive en el contrato.
      'Y al revés: `modo: "and"` quiere decir que hay artículos con TODOS los términos, no que ' +
        'respondan la pregunta. Antes de declinar mirá `hayMas` y `paginas`: la respuesta puede ' +
        'estar en otra página o bajo otro valor de los filtros.',
      E.hay
        ? E.duro +
          (E.cross
            ? ` La única excepción son los artículos CROSS-${E.param.toUpperCase()} (${E.cross}): ` +
              `aparecen bajo cualquier filtro y vienen con \`${E.param}: null\` en el hit.`
            : '')
        : 'Los filtros por metadata son exactos y duros.',
      // `paises` y `docSet` se explican en la description de su parámetro.
      `Cada hit trae${E.hay ? ` su \`${E.param}\` y` : ''} los headings principales del artículo ` +
        '(`headingsOmitidos` cuenta los que no vienen). Con 0 resultados devuelve hints accionables.',
    ],
    leer: [
      ...(E.desambiguaEnLeer
        ? [
            `Si el mismo slug existe para varios \`${E.param}\` y no aclarás cuál, no elige por su ` +
              'cuenta: te devuelve los candidatos.',
          ]
        : []),
    ],
    mapa: [
      ...(PAISES ? [`Trae los países del vocabulario (${PAISES.join(', ')}).`] : []),
      ...(DOC_SETS
        ? [`Trae las documentaciones del corpus (${DOC_SETS.map((d) => `${d.id} = ${d.label}`).join(' · ')}).`]
        : []),
      ...(E.hay ? [`Trae los valores de \`${E.param}\` disponibles.`] : []),
      ...(IDIOMAS ? [`Es el mapa de UN idioma: el \`idioma\` pedido o, sin él, \`${IDIOMAS.default}\`.`] : []),
    ],
  };
  const descripcion = (tool) => [...ESENCIAL[tool], ...DETALLE[tool]].join(' ');

  function registrar(server) {
    server.registerTool(
      'mapa',
      {
        title: config.titulos?.mapa ?? 'Mapa de la documentación',
        description: descripcion('mapa'),
        inputSchema: z.object({
          ...(CON_SECCION
            ? {
                seccion: z
                  .string()
                  .optional()
                  .describe(`${config.filtros?.seccion ?? 'Sección del árbol.'} Sin ella, el árbol entero.`),
              }
            : {}),
          ...(E.hay && CON_SECCION
            ? {
                [E.param]: z
                  .string()
                  .optional()
                  .describe(
                    `Con \`seccion\`: lista los artículos de este \`${E.param}\`. Sin él, los del ` +
                      'valor por defecto del corpus.',
                  ),
              }
            : {}),
          ...esquemaIdioma(`Sin él, el mapa es el de \`${IDIOMAS?.default}\`.`),
          ...(CON_SECCION
            ? { page: z.number().int().min(1).optional().describe('Página de artículos con `seccion`, base 1.') }
            : {}),
        }),
      },
      async (args = {}) => {
        if (errorIndice) return sinIndice();
        const pedido = {};
        if (CON_SECCION && args.seccion != null) pedido.seccion = args.seccion;
        if (CON_SECCION && args.page != null) pedido.page = args.page;
        if (E.hay && CON_SECCION && args[E.param] != null) pedido[E.param] = args[E.param];
        if (IDIOMAS && args.idioma) pedido.idioma = args.idioma;
        return texto(Object.keys(pedido).length ? idx.mapa(pedido) : idx.mapa());
      },
    );

    server.registerTool(
      'buscar',
      {
        title: config.titulos?.buscar ?? 'Buscar en la documentación',
        description: descripcion('buscar'),
        inputSchema: z.object({
          q: z
            .string()
            .min(1)
            .describe(
              'Términos a buscar; podés escribirlos con tildes y como los dijo el cliente ' +
                '(se normaliza solo). Los términos precisos del dominio rankean mejor.',
            ),
          ...esquemaEje(E, { multiple: true }),
          ...esquemaIdioma(
            'Pasá el idioma en el que te preguntaron. Sin él se detecta por las palabras de la ' +
              `pregunta y, si no hay señal, se busca en \`${IDIOMAS?.default}\`; la respuesta dice cuál ` +
              'usó (`idioma`, `idiomaElegidoPor`) y cada hit trae sus `traducciones`.',
          ),
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
          ...(DOC_SETS
            ? {
                docSet: z
                  .union([z.string(), z.array(z.string())])
                  .optional()
                  .describe(PROSA_DOC_SETS),
              }
            : {}),
          ...(!CON_SECCION
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
        description: descripcion('leer'),
        inputSchema: z.object({
          slug: z.string().min(1).describe('Slug del artículo, tal como vino en un hit de `buscar()`.'),
          ancla: z
            .string()
            .optional()
            .describe(
              'Id del heading cuya sección querés (el `ancla.id` de un hit, o un `id` de `headings`). ' +
                'Sin ella, el artículo entero.',
            ),
          ...esquemaEje(E, { multiple: false }),
          ...esquemaIdioma(
            'Con el slug de otro idioma te devuelve su traducción a este, si la hay, y lo avisa ' +
              '(`idiomaElegidoPor: "traduccion"`).',
          ),
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

  // `esenciales`: las frases que tienen que entrar antes del corte de la description.
  return { handler, default: { fetch: handler }, esenciales: ESENCIAL };
}
