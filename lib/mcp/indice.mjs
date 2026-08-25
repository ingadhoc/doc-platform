/**
 * Carga del índice del agente y motor de búsqueda. VERSIÓN UNIFICADA
 * (best-of-three de oba-docs / odumbo-docs / adhoc-docs).
 *
 * TODO ESTE MÓDULO CORRE UNA SOLA VEZ POR INSTANCIA. Vercel corre las
 * funciones con Fluid Compute (default en proyectos nuevos — hay que
 * verificar el toggle en cada proyecto): el scope de módulo persiste entre
 * invocaciones, así que leer el JSON y construir el índice de MiniSearch acá
 * se paga una vez por instancia, no por request.
 *
 * De dónde sale el archivo: lo emite el preprocesador (`tools/build.mjs`,
 * target `agente`) en `api/_generated/index.json`, por audiencia, en cada
 * build. Vive adentro de `api/` a propósito para que quede al lado de la
 * función; como es `.json`, Vercel no lo convierte en un endpoint.
 *
 * Cómo entra al bundle de la función: `fs.readFileSync` con una ruta armada
 * en runtime NO la puede trazar `@vercel/nft`, así que el archivo se declara
 * a mano en `vercel.json`:
 *
 *   "functions": { "api/mcp.mjs": { "includeFiles": "api/_generated/**" } }
 *
 * (La alternativa —`import ... with { type: 'json' }`— sí se trazaría sola,
 * pero deja el índice entero en el grafo de módulos ESM y no permite el
 * fallback de rutas de abajo, que es lo que hace testeable esto en local.)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL EJE ES UN OBJETO DEL CONTRATO, NO UN DIALECTO
 *
 * Los tres repos de origen tenían el mismo motor con tres ejes distintos:
 * `version` (oba), ninguno (odumbo, `versionado: false`) y `project`
 * (adhoc). Acá el eje entra por el índice como el MISMO objeto que declara
 * `docs.config.json` (`{ tipo, default?, valores[] }`, ver
 * `schema/docs.config.schema.json` y `docs/unificacion/diseno-eje.md`), y el
 * artículo lo materializa en UN campo genérico: `articulos[].eje`
 * (`null` = fuera del eje). La palabra del dominio —`version` / `project`—
 * vive sólo en la superficie que ve el LLM: el nombre del parámetro de las
 * tools, el campo del hit y los textos. Ver `VOCABULARIO`.
 *
 * LA REGLA DEL LECTOR (contrato-indice.md §4): el índice declara
 * `schemaVersion` y este módulo TIRA si falta o si el emisor es más nuevo de
 * lo que sabe leer. No hay degradación blanda: un índice equivocado que
 * responde mal es peor que uno que no responde.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import MiniSearch from 'minisearch';

/** Versión del contrato índice ↔ motor que este módulo sabe leer. */
export const INDICE_SOPORTADO = 1;

/**
 * Fuzzy por distancia de edición: APAGADO a propósito (spec, review 19/08).
 * Quien escribe la query es un LLM, que reformula limpio y reintenta gratis;
 * sobre español el fuzzy mete falsos positivos. Queda tras este flag hasta
 * que un caso real lo pida.
 */
export const FUZZY = false;

/** Tope de hits por página de `buscar()`. */
export const PAGINA_BUSCAR = 20;

/** Umbral de paginado del body. El límite real de Vercel es 4,5 MB por
 *  respuesta; con 200K caracteres por página quedamos un orden de magnitud
 *  abajo aun contando el escape de JSON. En la práctica no debería activarse. */
export const PAGINA_LEER = 200_000;

// ───────────────────────────────────────────────────────────── el eje

/** Los tres tipos de eje del contrato. */
export const TIPOS_DE_EJE = ['version', 'project', 'none'];

/**
 * Traduce el objeto `eje` del contrato al descriptor que consume el resto del
 * módulo. Es la única función que sabe qué implica cada `tipo`.
 *
 * Entra: `build.eje = { tipo, default?, valores? }` — el mismo objeto de
 * `docs.config.json`, emitido por el build (contrato-indice.md §3.3).
 *
 * Campos del descriptor:
 *   · `tipo`     `version` | `project` | `none`.
 *   · `hay`      hay eje (todo menos `none`).
 *   · `campo`    propiedad del artículo que lo materializa: `eje`, o `null`
 *                si el corpus no tiene eje. Genérica a propósito: es UN campo
 *                y no `version`/`project`, así que `pasaFiltros`, `hitDe`,
 *                `leer()` y los hints son UN código y no tres.
 *   · `param`    la palabra del DOMINIO: el nombre del parámetro en las tools
 *                y del campo en las respuestas (`version` / `project`).
 *   · `default`  el valor que gana cuando nadie lo pide. Su PRESENCIA es la
 *                política de desambiguación de `leer()` (diseno-eje.md §3).
 *   · `comodin`  un artículo con el campo en `null` aplica a TODOS los
 *                valores del eje (el caso cross-version de oba). Con eje
 *                `project` es `false`: un doc sin project no es "de todos".
 *   · `orden`    cómo se ordena la lista de valores (desc para versiones,
 *                alfabético para projects: entre projects no hay "el nuevo").
 *   · `sinValor` qué hace `leer()` sin valor del eje pedido: `default` (hay
 *                a quién elegir, y se ANUNCIA) o `ambiguo` (no lo hay: se
 *                devuelve la ambigüedad en vez de elegir por orden de
 *                inserción del índice).
 *   · `avisoMezcla`  `buscar()` sin filtro que trae varios valores del eje
 *                avisa que están mezclados, para que el agente atribuya antes
 *                de redactar. Encendido para los dos ejes (diseno-eje.md §3:
 *                mezclar la 18 con la 19 sin atribuir es tan caro como
 *                mezclar `oba` con `odumbo`).
 *   · `hintAgrupaPorEje` los hints agrupan por `eje/seccion` en vez de por
 *                `seccion` sola (tiene sentido cuando el eje es la unidad de
 *                atribución: projects).
 *   · `filtrosDominio` / `camposDominio` facetas de dominio del corpus, que
 *                salen de `build.metadata` (`modules` en OBA/Odumbo, `type`
 *                en adhoc-docs, `paises` en OBA). No son ejes: un artículo
 *                pertenece a UN valor del eje y a N valores de una faceta.
 *   · `dominiosComodin` las facetas cuya AUSENCIA significa "todos" en vez de
 *                "ninguno" (ver `pasaFiltros`). `paises` es la única hoy;
 *                `modules` NO: un artículo que no declara módulos no es "de
 *                todos los módulos".
 *
 * `paises` NO es un eje y por eso no entra en `TIPOS_DE_EJE`: no multiplica el
 * build ni bifurca URLs (frontmatter.md § "Países: una faceta, no un eje"). Es
 * un campo que viaja al índice y se filtra duro, como `modules`.
 */
export function politicaDeEje(build) {
  const declarado = build?.eje;
  if (!declarado || typeof declarado !== 'object' || Array.isArray(declarado)) {
    throw new Error(
      'el índice no declara `build.eje` como objeto { tipo, default?, valores? }: ' +
        'lo emitió un build pre-unificación (el `versionado`/`projects`/`latest` de los tres ' +
        'dialectos ya no se lee). Corré el build del paquete actual.',
    );
  }
  if (!TIPOS_DE_EJE.includes(declarado.tipo)) {
    throw new Error(
      `\`build.eje.tipo\` = ${JSON.stringify(declarado.tipo)} no es un tipo de eje: ` +
        `esperaba ${TIPOS_DE_EJE.join(' | ')}.`,
    );
  }

  const tipo = declarado.tipo;
  const hay = tipo !== 'none';
  const metadata = build?.metadata ?? {};
  const conModules = metadata.modules === true;
  const conTypes = Array.isArray(metadata.types) && metadata.types.length > 0;
  // El vocabulario de países lo declara el corpus (`metadata.paises`). Lista
  // vacía o ausente = el corpus no tiene la faceta y el MCP no ofrece el
  // filtro: una tool que ofrece un filtro sin contenido detrás miente.
  const conPaises = Array.isArray(metadata.paises) && metadata.paises.length > 0;

  return {
    tipo,
    hay,
    campo: hay ? 'eje' : null,
    param: hay ? tipo : null,
    default: hay ? (declarado.default ?? null) : null,
    valoresDeclarados: Array.isArray(declarado.valores) ? declarado.valores : [],
    comodin: tipo === 'version',
    orden: tipo === 'version' ? 'desc' : 'asc',
    sinValor: hay && declarado.default != null ? 'default' : 'ambiguo',
    avisoMezcla: hay,
    hintAgrupaPorEje: tipo === 'project',
    filtrosDominio: [...(conModules ? ['modules'] : []), ...(conPaises ? ['paises'] : [])],
    camposDominio: [
      ...(conModules ? ['modules'] : []),
      ...(conPaises ? ['paises'] : []),
      ...(conTypes ? ['type'] : []),
    ],
    dominiosComodin: new Set(conPaises ? ['paises'] : []),
    paisesDeclarados: conPaises ? metadata.paises.map(String) : [],
  };
}

/**
 * Los nombres y los textos que hablan el idioma del dominio. El índice y el
 * config hablan genérico (`eje`); las tools y las respuestas que lee el LLM
 * hablan `version` o `project` (diseno-eje.md §4): el nombre del parámetro es
 * prompt, y "otra versión de lo mismo" no es lo mismo que "otro documento que
 * comparte nombre de archivo".
 *
 * Lo que SÍ se unificó de nombre (diseno-eje.md §3): `otrosDelEje` (era
 * `otrasVersiones` / `mismoSlugEnOtrosProjects`) y los `motivo` de los
 * soft-fail (`slug-fuera-del-valor-pedido`, `ambiguo-en-eje`), que son
 * machine-readable y no tienen por qué diferir por corpus.
 */
const VOCABULARIO = {
  version: {
    pedido: 'versionPedida',
    disponibles: 'versionesDisponibles',
    hintAflojar: (valores, cuantos, deDonde) =>
      `Sacando el filtro \`version\` (${valores.join(', ')}) hay ${cuantos} resultado(s), ` +
      `de: ${deDonde.join(', ')}. ` +
      'Ojo: eso devuelve otras versiones de Odoo — decilo explícitamente si las citás.',
    noCoincide: (slug, valor) =>
      `El slug "${slug}" existe, pero no para la versión ${valor}. ` +
      'La versión pedida manda: no te devuelvo otra sin que la pidas.',
    ambiguo: (slug, cuantos, valores) =>
      `El slug "${slug}" existe en ${cuantos} versiones (${valores.join(', ')}) y no me dijiste ` +
      'cuál. No elijo por mi cuenta: el corpus no declara una versión por default ' +
      '(`eje.default` en docs.config.json), y devolverte la equivocada te haría citar ' +
      'documentación de otra versión de Odoo. Repetí el `leer()` con la `version` que corresponda.',
    elegido: (valor) =>
      `No pediste versión: te devuelvo la ${valor}, que es la declarada por default en el corpus. ` +
      'Las otras están en `otrosDelEje` — si el usuario preguntó por otra, repetí el `leer()`.',
    mezcla: (valores) =>
      `Los resultados vienen de ${valores.length} versiones distintas (${valores.join(', ')}). ` +
      'Cada hit trae su `version`: citá siempre de cuál es, o volvé a buscar con el filtro ' +
      '`version` puesto si ya sabés sobre cuál te preguntaron.',
  },
  project: {
    pedido: 'projectPedido',
    disponibles: 'projectsDisponibles',
    // El aviso que con eje versión es "ojo, eso devuelve otras versiones de
    // Odoo". Acá el riesgo no es citar una versión vieja: es citar la
    // documentación de OTRO project como si fuera del que preguntaron.
    // `oba` y `odumbo` describen temas parecidos con criterios propios, y un
    // párrafo de uno leído como del otro es una respuesta creíble y
    // equivocada. Por eso el hint NOMBRA los projects de donde salen los
    // resultados: el agente tiene que poder atribuir sin volver a buscar.
    hintAflojar: (valores, cuantos, deDonde) =>
      `Sacando el filtro \`project\` (${valores.join(', ')}) hay ${cuantos} ` +
      `resultado(s), pero son de otro(s) project(s): ${deDonde.join(', ')}. ` +
      'La documentación de projects distintos habla de temas parecidos con criterios ' +
      'propios, así que NO sirve como respuesta sobre ' +
      `${valores.join(', ')}: si la citás, decí de qué project es y aclará que ` +
      'no es la del que te preguntaron.',
    noCoincide: (slug, valor) =>
      `El slug "${slug}" existe, pero no en el project "${valor}". ` +
      'El project pedido manda: no te devuelvo el artículo de otro sin que lo pidas, ' +
      'porque la documentación de dos projects distintos no es intercambiable.',
    ambiguo: (slug, cuantos, valores) =>
      `El slug "${slug}" existe en ${cuantos} projects (${valores.join(', ')}) y no me dijiste ` +
      'cuál. No elijo por mi cuenta: entre projects no hay uno "por default", y devolverte el ' +
      'equivocado te haría citar la documentación de otro producto. Repetí el `leer()` ' +
      'con el `project` que corresponda.',
    elegido: (valor) =>
      `No pediste project: te devuelvo "${valor}", que es el declarado por default en el corpus.`,
    mezcla: (valores) =>
      `Los resultados vienen de ${valores.length} projects distintos (${valores.join(', ')}). ` +
      'Cada hit trae su `project`: citá siempre de cuál es, o volvé a buscar con el filtro ' +
      '`project` puesto si ya sabés sobre cuál te preguntaron.',
  },
};

/**
 * El eje que expone `mapa()`: el MISMO objeto del contrato, más los valores
 * presentes en el índice y los declarados por la config. Un valor declarado
 * que no aparece no tiene docu o su fetch falló — y eso se ve acá (fix de
 * observabilidad de adhoc-docs).
 *
 * Con `tipo: 'none'` no viaja nada más: un `valores: []` con un `default: null`
 * al lado invita al agente a preguntarse cuál falta (criterio de odumbo-docs).
 */
function ejeEnMapa(idx) {
  const p = idx.eje;
  if (!p.hay) return { eje: { tipo: 'none' } };
  const eje = { tipo: p.tipo, param: p.param, valores: idx.valoresDeEje };
  if (p.default != null) eje.default = p.default;
  if (idx.ejeDeclarado.length) eje.declarados = idx.ejeDeclarado;
  return { eje };
}

// ─────────────────────────────────────────────────── normalización y términos

/**
 * Normalización compartida entre la construcción del índice y la query.
 * MiniSearch no trae nada de español de fábrica: esto y las STOPWORDS de abajo
 * es todo lo que hay, y build y runtime tienen que usar exactamente la misma
 * función (no hay stemming).
 *
 * Minúsculas + sin tildes (NFD y fuera los diacríticos), para que
 * "posicion fiscal" matchee "posición fiscal".
 */
export function normalizarTermino(termino) {
  return termino
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Stopwords del español, corta y conservadora. (Fix #11 de oba-docs.)
 *
 * POR QUÉ: la query no siempre la escribe alguien que tipea keywords — la
 * escribe un LLM que a veces pega la frase literal del cliente ("quiero
 * suscribirme al enterprise"). `buscar()` combina los términos con AND, así
 * que cada palabra de relleno es un filtro más que el artículo tiene que
 * cumplir; encima, con `prefix: true`, "de"/"la" matchean medio corpus sin
 * aportar señal. Sacar el relleno es lo que hace que la frase conversacional
 * recupere la página correcta.
 *
 * Va escrita SIN tildes a propósito: se compara contra el término YA
 * normalizado por `normalizarTermino`.
 *
 * CRITERIO DE INCLUSIÓN: solo palabras de función (artículos, preposiciones,
 * pronombres, demostrativos, interrogativos) y los verbos de encuadre de una
 * frase conversacional ("quiero", "necesito", "puedo", "hago"). Ante la duda
 * NO entra: una palabra que también es término del dominio pierde precisión
 * si la borramos. Quedaron AFUERA a propósito "no" y "sin" (aparecen con
 * sentido en las `keywords:` del corpus — "no sale el cae", "probar sin
 * romper") y "sobre".
 *
 * La MISMA función se aplica al indexar y al buscar: va en el `processTerm`
 * del constructor de MiniSearch, que es también el que usa `search()` salvo
 * que se pise en `searchOptions` (no lo pisamos).
 */
export const STOPWORDS = new Set([
  // artículos y determinantes
  'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'al', 'del',
  // preposiciones y conjunciones
  'a', 'con', 'de', 'desde', 'en', 'entre', 'hasta', 'para', 'por', 'segun',
  'y', 'o', 'que',
  // pronombres y posesivos
  'me', 'mi', 'mis', 'te', 'tu', 'tus', 'se', 'su', 'sus', 'le', 'les', 'nos',
  // demostrativos
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso',
  // interrogativos y relativos
  'como', 'cuando', 'donde', 'cual', 'cuales', 'quien',
  // verbos de encuadre de la frase conversacional
  'quiero', 'queria', 'quisiera', 'necesito', 'puedo', 'podria', 'hago', 'hace',
  'hacer', 'tengo', 'hay', 'saber', 'es', 'son', 'ser',
]);

/**
 * El `processTerm` que comparten índice y query: normaliza y descarta relleno.
 * Devolver `null` le dice a MiniSearch que el término no existe — tanto al
 * indexar como al buscar.
 */
export function procesarTermino(termino) {
  const limpio = normalizarTermino(termino);
  if (!limpio.length) return null;
  if (STOPWORDS.has(limpio)) return null;
  return limpio;
}

/** Los términos con señal de una query. Para diagnóstico y para los hints. */
export function terminosDe(q) {
  return String(q || '')
    .split(/\s+/)
    .map(procesarTermino)
    .filter(Boolean);
}

// ──────────────────────────────────────────────────────── carga del índice

const CAMPOS_INDEXADOS = ['title', 'keywords', 'headingsText', 'description', 'body'];

// Boost por campo: título y keywords arriba (las keywords son el vocabulario
// del usuario, nutrido de las queries reales — spec §La búsqueda).
const BOOST = {
  title: 6,
  keywords: 5,
  headingsText: 3,
  description: 2,
  body: 1,
};

const CAMPOS_GUARDADOS_BASE = ['slug', 'title', 'description', 'url', 'headings', 'seccion'];

function rutasCandidatas() {
  const rutas = [];
  if (process.env.DOCS_INDICE_PATH) rutas.push(process.env.DOCS_INDICE_PATH);
  // El consumidor: el índice vive en `api/_generated/` del repo que buildea.
  rutas.push(join(process.cwd(), 'api', '_generated', 'index.json'));
  // Layout viejo (el módulo dentro del repo, en lib/mcp/). Se conserva para
  // que el paquete siga funcionando vendorizado.
  rutas.push(fileURLToPath(new URL('../../api/_generated/index.json', import.meta.url)));
  return rutas;
}

function leerIndiceCrudo() {
  const errores = [];
  for (const ruta of rutasCandidatas()) {
    try {
      return JSON.parse(readFileSync(ruta, 'utf8'));
    } catch (error) {
      errores.push(`${ruta}: ${error.code || error.message}`);
    }
  }
  throw new Error(
    `No se pudo leer el índice del agente. Rutas probadas — ${errores.join(' | ')}`,
  );
}

/**
 * La regla del lector (contrato-indice.md §4). Tirar y no degradar: los
 * lectores viejos tenían fallbacks blandos que convertían un índice
 * equivocado en un índice que responde mal.
 */
function verificarContrato(crudo) {
  if (!Number.isInteger(crudo?.schemaVersion)) {
    throw new Error(
      'índice sin `schemaVersion`: lo emitió un build pre-unificación. ' +
        'Corré el build del paquete actual.',
    );
  }
  if (crudo.schemaVersion > INDICE_SOPORTADO) {
    throw new Error(
      `el índice declara schemaVersion ${crudo.schemaVersion} y esta plataforma lee hasta ` +
        `${INDICE_SOPORTADO}: actualizá @ingadhoc/docs-platform en este repo.`,
    );
  }
  // Los dos artefactos del build difieren SÓLO en la presencia de `body` y son
  // indistinguibles por contenido. Si la función MCP termina leyendo la copia
  // estática, `leer()` devolvería `body: ''` con `encontrado: true`: artículos
  // vacíos con cara de artículo. Con el flag, falla fuerte y con nombre.
  if (crudo.build?.conCuerpo === false) {
    throw new Error(
      'este índice viene sin `body` (`build.conCuerpo: false`, es la copia estática de ' +
        '`site/static/agente/`): la función MCP necesita `api/_generated/index.json`.',
    );
  }
}

/**
 * Los valores del eje declarados por la config vía el build. Con el contrato
 * versionado la forma está fijada (`{id, label?}`), así que el lector NO
 * adivina: un valor sin `id` es un índice mal emitido y se dice.
 * Sólo los valores ACTIVOS viajan al índice: los apagados no son contenido,
 * son registro (contrato-indice.md §3.3).
 */
function ejeDeclarado(politica) {
  return politica.valoresDeclarados.map((valor, i) => {
    if (!valor || typeof valor !== 'object' || !valor.id) {
      throw new Error(`\`build.eje.valores[${i}]\` no tiene \`id\`: el índice está mal emitido.`);
    }
    return { id: String(valor.id), label: String(valor.label ?? valor.id) };
  });
}

function construir() {
  const crudo = leerIndiceCrudo();
  verificarContrato(crudo);

  const articulos = Array.isArray(crudo.articulos) ? crudo.articulos : [];
  const politica = politicaDeEje(crudo.build);

  const camposGuardados = [
    ...CAMPOS_GUARDADOS_BASE,
    ...(politica.campo ? [politica.campo] : []),
    ...politica.camposDominio,
  ];

  const mini = new MiniSearch({
    idField: 'id',
    fields: CAMPOS_INDEXADOS,
    storeFields: camposGuardados,
    // La misma función al indexar y al buscar (MiniSearch reusa este
    // processTerm en `search()` mientras no se pise en searchOptions).
    processTerm: procesarTermino,
    searchOptions: {
      boost: BOOST,
      prefix: true,
      fuzzy: FUZZY ? 0.2 : false,
    },
  });

  // El `id` lo EMITE el build (`${eje ?? '*'}::${slug}`, diseno-eje.md §2). El
  // lector no lo compone: que el identificador se invente en el lector es como
  // los tres repos emitían de hecho ids `"null::relacion/…"`.
  for (const articulo of articulos) {
    if (!articulo.id) {
      throw new Error(
        `el artículo "${articulo.slug}" viene sin \`id\`: lo emite el build ` +
          '(`${eje ?? "*"}::${slug}`) y el lector no lo compone. Corré el build del paquete actual.',
      );
    }
  }

  mini.addAll(
    articulos.map((articulo) => ({
      ...articulo,
      keywords: (articulo.keywords || []).join(' '),
      headingsText: (articulo.headings || []).map((h) => h.text).join(' '),
      body: articulo.body || '',
    })),
  );

  const porId = new Map(articulos.map((a) => [a.id, a]));
  const porSlug = new Map();
  for (const articulo of articulos) {
    if (!porSlug.has(articulo.slug)) porSlug.set(articulo.slug, []);
    porSlug.get(articulo.slug).push(articulo);
  }

  const declarados = ejeDeclarado(politica);
  const labels = new Map(declarados.map((p) => [p.id, p.label]));

  // Orden del eje: descendente para versiones ("la última primero"),
  // alfabético para projects — entre projects no hay "el más nuevo".
  const valores = politica.campo
    ? [...new Set(articulos.map((a) => a[politica.campo]))].filter(Boolean).sort()
    : [];
  if (politica.orden === 'desc') valores.reverse();

  return {
    build: crudo.build || {},
    schemaVersion: crudo.schemaVersion,
    eje: politica,
    buildId: crudo.build?.generatedAt || 'desconocido',
    // `audiencia` es la clave del contrato, en castellano y una sola (dos
    // claves para el mismo dato es la doble fuente que se pudre). El fallback
    // a la env var es para un índice viejo o a medio generar — no es un
    // segundo nombre del mismo campo.
    audiencia: crudo.build?.audiencia || process.env.DOCS_AUDIENCE || 'desconocida',
    mapa: crudo.mapa || [],
    articulos,
    valoresDeEje: valores,
    ejeDeclarado: declarados,
    labelDeEje: (id) => labels.get(id) || id,
    mini,
    porId,
    porSlug,
  };
}

let cache = null;
let errorDeCarga = null;

/** Singleton de scope de módulo: una carga y un índice por instancia. */
export function indice() {
  if (cache) return cache;
  if (errorDeCarga) throw errorDeCarga;
  try {
    cache = construir();
    return cache;
  } catch (error) {
    errorDeCarga = error;
    throw error;
  }
}

/** Solo para tests: fuerza recargar. */
export function _resetIndice() {
  cache = null;
  errorDeCarga = null;
}

/**
 * URL canónica absoluta. El índice trae rutas relativas al sitio (`/19/...`,
 * `/adhoc-way/...`); el origin sale de DOCS_URL — la MISMA variable que ya
 * consume Docusaurus para su `url` y el preprocesador para `siteUrl`,
 * distinta en cada proyecto. No inventamos una variable nueva a propósito:
 * dos vars con el mismo valor se desincronizan. Sin la variable, la URL queda
 * relativa — citable dentro del sitio pero no pegable en un ticket.
 */
function absoluta(url) {
  if (!url) return url;
  const origin = (process.env.DOCS_URL || '').replace(/\/+$/, '');
  return origin ? origin + url : url;
}

function comoLista(valor) {
  if (valor == null) return null;
  const lista = Array.isArray(valor) ? valor : [valor];
  const limpia = lista.filter((v) => v != null && String(v).length > 0).map(String);
  return limpia.length ? limpia : null;
}

// ──────────────────────────────────────────────────────────── filtros duros

/**
 * Los campos por los que se puede filtrar duro en este corpus, con el NOMBRE
 * que ve el consumidor (`version`/`project`, no `eje`).
 */
function camposDeFiltro(politica) {
  return [...(politica.param ? [politica.param] : []), 'seccion', ...politica.filtrosDominio];
}

/**
 * Filtros duros por metadata. NO son términos de la query: un artículo que
 * no cumple queda afuera, no rankeado más abajo. El del eje es el que
 * manda — preguntar por la 19 nunca devuelve la 18 sin decirlo, y preguntar
 * por `oba` nunca devuelve `odumbo`.
 */
function pasaFiltros(articulo, filtros, politica) {
  const { campo, param } = politica;
  if (campo && filtros[param]) {
    // Fix #12 de oba-docs, generalizado con `politica.comodin`: un artículo
    // FUERA DEL EJE llega con `eje: null` (no declara valor porque aplica a
    // todos). `String(null)` es "null", que no está en ninguna lista de
    // valores: sin este caso, filtrar por versión lo excluía siempre — y la
    // skill del agente consumidor le ordena filtrar SIEMPRE por versión, así
    // que TODO el contenido cross-version (`relacion/`) quedaba invisible en
    // la práctica. Con eje `project` el comodín está APAGADO: un doc sin
    // project no es "de todos los projects".
    const valor = articulo[campo];
    const comodin = politica.comodin && valor == null;
    if (!comodin && !filtros[param].includes(String(valor))) return false;
  }
  if (filtros.seccion && !filtros.seccion.includes(articulo.seccion)) return false;
  for (const dominio of politica.filtrosDominio) {
    if (!filtros[dominio]) continue;
    const propios = articulo[dominio];
    const lista = propios == null ? [] : Array.isArray(propios) ? propios : [propios];
    // El MISMO Fix #12, una faceta más abajo. Una faceta COMODÍN (`paises`)
    // significa "todos" cuando el artículo no declara nada: una página
    // universal tiene que devolverse bajo cualquier filtro de país, o filtrar
    // por UY borra todo el contenido que no es de ningún país en particular —
    // que es la mayoría del manual. El tag excluye; la ausencia nunca oculta.
    // `modules` conserva la semántica opuesta: sin módulos declarados, no
    // matchea ningún filtro de módulo.
    if (lista.length === 0 && politica.dominiosComodin?.has(dominio)) continue;
    if (!filtros[dominio].some((m) => lista.map(String).includes(String(m)))) return false;
  }
  return true;
}

function normalizarFiltros(args, politica) {
  const filtros = {};
  for (const campo of camposDeFiltro(politica)) filtros[campo] = comoLista(args[campo]);
  return filtros;
}

function hitDe(resultado, politica) {
  const hit = {
    slug: resultado.slug,
    title: resultado.title,
    description: resultado.description,
    url: absoluta(resultado.url),
    seccion: resultado.seccion,
    // Los headings viajan en el hit para que el agente pueda citar el
    // deep-link al topic sin tener que leer() el artículo entero.
    headings: resultado.headings || [],
    score: Math.round(resultado.score * 1000) / 1000,
  };
  // El valor del eje viaja con la palabra del dominio: `version: "19"`.
  if (politica.campo) hit[politica.param] = resultado[politica.campo];
  for (const campo of politica.camposDominio) {
    // `paises: null` en el hit NO es "no sé": es "aplica a todos los países".
    // Por eso no se normaliza a `[]` como `modules` — un array vacío se lee
    // como "ningún país" y es justo lo contrario.
    hit[campo] = resultado[campo] ?? (campo === 'modules' ? [] : null);
  }
  return hit;
}

// ─────────────────────────────────────────────────────────────────── hints

/**
 * Hints accionables para el caso de CERO resultados de verdad: ni el AND ni el
 * fallback OR devolvieron nada. Para un LLM esto vale más que cualquier
 * tolerancia de matching: le decimos qué filtro sacar y qué secciones del mapa
 * tocan sus términos.
 */
function hints(idx, q, filtros) {
  const politica = idx.eje;
  const sugerencias = [];

  // 0. ¿La query quedó vacía de términos con señal? (todo stopwords)
  if (terminosDe(q).length === 0) {
    sugerencias.push(
      'Tu query no tiene ningún término con contenido: son todas palabras vacías ' +
        '(artículos, preposiciones, "quiero", "cómo hago"…), que no se indexan. ' +
        'Dejá los sustantivos del tema (p. ej. "nota de crédito", "conciliación bancaria").',
    );
  }

  // 1. ¿Hay resultados si aflojamos cada filtro de a uno?
  for (const campo of camposDeFiltro(politica)) {
    if (!filtros[campo]) continue;
    const sinEse = { ...filtros, [campo]: null };
    const otros = idx.mini.search(q, {
      combineWith: 'AND',
      filter: (r) => pasaFiltros(r, sinEse, politica),
    });
    if (otros.length === 0) continue;

    if (campo === politica.param) {
      const deDonde = [...new Set(otros.map((r) => r[politica.campo]))].sort();
      sugerencias.push(VOCABULARIO[politica.tipo].hintAflojar(filtros[campo], otros.length, deDonde));
    } else {
      sugerencias.push(
        `Sacando el filtro \`${campo}\` (${filtros[campo].join(', ')}) hay ${otros.length} ` +
          'resultado(s). Probá de nuevo sin ese filtro.',
      );
    }
  }

  // 2. ¿Alguno de los términos sueltos pega en algún lado, ignorando los
  //    filtros duros? (Con los filtros puestos ya lo intentó el fallback OR de
  //    `buscar()`: si llegamos acá, ahí no había nada.)
  const porTermino = idx.mini.search(q, { combineWith: 'OR' });
  const grupos = new Map();
  for (const r of porTermino.slice(0, 40)) {
    const clave = politica.hintAgrupaPorEje
      ? `${r[politica.campo] || '—'}/${r.seccion || '—'}`
      : `${r.seccion || '—'}`;
    grupos.set(clave, (grupos.get(clave) || 0) + 1);
  }
  if (grupos.size) {
    const top = [...grupos.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([donde, n]) => `${donde} (${n})`);
    sugerencias.push(
      `Con alguno de los términos sueltos (no todos) aparecen artículos en: ${top.join(', ')}, ` +
        'pero ninguno pasa tus filtros. Aflojá los filtros o cambiá los términos.',
    );
  } else {
    sugerencias.push(
      'Ningún término de la query aparece en el corpus. Probá con el vocabulario de la ' +
        'documentación, o empezá por `mapa()` para ver qué hay documentado.',
    );
  }

  // 3. Ramas del mapa relacionadas por término.
  const terminos = terminosDe(q);
  const ramas = idx.mapa
    .filter((rama) => {
      const texto = normalizarTermino(
        [
          rama.seccion,
          rama.categoria,
          rama.label,
          Array.isArray(rama.ejeValores) ? rama.ejeValores.join(' ') : '',
          Array.isArray(rama.modules) ? rama.modules.join(' ') : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      return terminos.some((t) => t.length > 2 && texto.includes(t));
    })
    .slice(0, 5);
  if (ramas.length) sugerencias.push('Ramas del mapa que mencionan tus términos: ver `ramasRelacionadas`.');

  return { sugerencias, ramasRelacionadas: ramas };
}

// ─────────────────────────────────────────────────────────────────── buscar

export function buscar({ q, page = 1, ...resto } = {}) {
  const idx = indice();
  const politica = idx.eje;
  const filtros = normalizarFiltros(resto, politica);
  const pagina = Math.max(1, Math.floor(Number(page) || 1));

  // Los filtros duros (eje / seccion / dominio) son AND en los dos modos:
  // el fallback afloja la CONJUNCIÓN DE TÉRMINOS, nunca la metadata.
  const filtro = (r) => pasaFiltros(r, filtros, politica);

  let crudos = idx.mini.search(q, { combineWith: 'AND', filter: filtro });
  let modo = 'and';

  // Fix #12 de oba-docs — fallback automático a OR cuando el AND da 0. La
  // query la escribe un LLM que a veces pega la frase literal del cliente
  // ("quiero suscribirme al enterprise"): exigir que UN artículo contenga
  // TODOS los términos convierte eso en cero resultados, y devolver solo
  // hints obliga a un segundo roundtrip para llegar a la página que ya estaba
  // en el corpus. Preferimos devolver los artículos que matchean más
  // términos, rankeados, y decirle en la respuesta que verifique pertinencia.
  if (crudos.length === 0) {
    const porOr = idx.mini.search(q, { combineWith: 'OR', filter: filtro });
    if (porOr.length > 0) {
      crudos = porOr;
      modo = 'or-fallback';
    }
  }

  const total = crudos.length;
  const paginas = Math.max(1, Math.ceil(total / PAGINA_BUSCAR));
  const desde = (pagina - 1) * PAGINA_BUSCAR;
  const hits = crudos.slice(desde, desde + PAGINA_BUSCAR).map((r) => hitDe(r, politica));

  const base = {
    buildId: idx.buildId,
    audiencia: idx.audiencia,
    q,
    filtros,
    fuzzy: FUZZY,
    // `and` = cada resultado contiene TODOS los términos. `or-fallback` = el
    // AND dio 0 y estos matchean ALGUNOS (ver `nota`).
    modo,
    total,
    page: pagina,
    paginas,
    hayMas: desde + hits.length < total,
    resultados: hits,
  };

  if (total === 0) return { ...base, ...hints(idx, q, filtros) };

  // De adhoc-docs, generalizado a los dos ejes: búsqueda sin filtro del eje
  // que trae resultados de varios valores — el agente se tiene que enterar
  // ANTES de redactar, no después. Mezclar en una misma respuesta la docu de
  // `oba` y la de `odumbo` (o la de la 18 y la 19) sin atribuir es el error
  // caro de este eje.
  if (politica.avisoMezcla && !filtros[politica.param]) {
    const presentes = [...new Set(hits.map((h) => h[politica.param]))].filter(Boolean).sort();
    if (presentes.length > 1) base.aviso = VOCABULARIO[politica.tipo].mezcla(presentes);
  }

  if (modo === 'or-fallback') {
    return {
      ...base,
      nota:
        'Ningún artículo contiene TODOS los términos de la query, así que se combinaron ' +
        'con OR: estos son los que matchean más términos, rankeados. Verificá pertinencia ' +
        'antes de citar — el primero puede no responder la pregunta. Los filtros por ' +
        'metadata siguen siendo exactos y duros.',
    };
  }
  return base;
}

// ───────────────────────────────────────────────────────────────────── leer

/** Dice sobre bigramas: barato y suficiente para "¿quisiste decir?". */
function similitud(a, b) {
  const bigramas = (s) => {
    const n = normalizarTermino(s).replace(/[^a-z0-9]+/g, ' ');
    const out = new Set();
    for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
    return out;
  };
  const A = bigramas(a);
  const B = bigramas(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const g of A) if (B.has(g)) comunes++;
  return (2 * comunes) / (A.size + B.size);
}

/** Ficha corta de un candidato, para las sugerencias. */
function fichaDe(articulo, politica) {
  const ficha = { slug: articulo.slug, title: articulo.title, url: absoluta(articulo.url) };
  if (politica.campo) ficha[politica.param] = articulo[politica.campo];
  return ficha;
}

/**
 * `leer()` — la política de desambiguación es UNA (diseno-eje.md §3):
 *
 *   1. cero candidatos           -> soft-fail `slug-inexistente` + sugerencias
 *   2. valor del eje pedido      -> match exacto || match fuera del eje
 *                                   || soft-fail `slug-fuera-del-valor-pedido`
 *   3. sin valor pedido:
 *      3a. un candidato          -> ese
 *      3b. hay uno fuera del eje -> ese (aplica a todos los valores)
 *      3c. `eje.default`         -> el del default, y se ANUNCIA (`elegidoPor`)
 *      3d. resto                 -> `encontrado: false`, `ambiguo-en-eje`
 *
 * `leer()` sólo elige cuando el config declaró a quién elegir, y cuando elige
 * lo dice. El fallback `candidatos[0]` —"el orden de inserción del índice",
 * exactamente lo que el comentario de oba-docs decía que había que evitar—
 * desaparece.
 */
export function leer({ slug, page = 1, ...resto } = {}) {
  const idx = indice();
  const politica = idx.eje;
  const { campo, param } = politica;
  const voc = campo ? VOCABULARIO[politica.tipo] : null;
  const pedido = param ? resto[param] : null;
  const pagina = Math.max(1, Math.floor(Number(page) || 1));
  const candidatos = idx.porSlug.get(slug) || [];

  const cabecera = { buildId: idx.buildId, audiencia: idx.audiencia };

  // Soft-fail: nunca un error seco. Un deploy que renombra un slug a mitad
  // de conversación no puede producir un falso "el artículo fue borrado".
  if (candidatos.length === 0) {
    const parecidos = idx.articulos
      .map((a) => ({
        ...fichaDe(a, politica),
        parecido: Math.max(similitud(slug, a.slug), similitud(slug, a.title || '')),
      }))
      .sort((a, b) => b.parecido - a.parecido)
      .slice(0, 5)
      .map(({ parecido, ...resto2 }) => ({ ...resto2, parecido: Math.round(parecido * 100) / 100 }));

    return {
      ...cabecera,
      encontrado: false,
      motivo: 'slug-inexistente',
      slugPedido: slug,
      mensaje:
        `No hay ningún artículo con el slug "${slug}" en el índice ${idx.buildId}. ` +
        'Esto NO significa que el artículo fue borrado: lo más probable es que el slug ' +
        'haya cambiado o esté mal escrito. Re-ejecutá `buscar()` con los términos del ' +
        'tema, o probá uno de los slugs sugeridos.',
      sugerencias: parecidos,
      siguientePaso: 'buscar({ q: "<términos del tema>" })',
    };
  }

  let articulo = null;
  let elegidoPor = null;

  if (campo && pedido != null) {
    // Fix #12 de oba-docs (mismo criterio que `pasaFiltros`): un artículo
    // fuera del eje (`eje: null`) es la respuesta correcta para cualquier
    // valor pedido. Sin esto, el flujo buscar() → leer() se rompía justo
    // para las páginas que ahora sí aparecen en los resultados: el hit venía
    // con `version: null` y el agente, que arrastra la versión de la
    // conversación, recibía un "no existe para esa versión".
    articulo =
      candidatos.find((a) => String(a[campo]) === String(pedido)) ||
      (politica.comodin ? candidatos.find((a) => a[campo] == null) : null) ||
      null;
    if (!articulo) {
      return {
        ...cabecera,
        encontrado: false,
        motivo: 'slug-fuera-del-valor-pedido',
        slugPedido: slug,
        [voc.pedido]: String(pedido),
        mensaje: voc.noCoincide(slug, pedido),
        [voc.disponibles]: candidatos.map((a) => a[campo]),
        sugerencias: candidatos.map((a) => fichaDe(a, politica)),
        siguientePaso: `leer({ slug: "${slug}", ${param}: "${candidatos[0][campo]}" })`,
      };
    }
  } else if (campo) {
    // 3a / 3b: un solo candidato, o uno fuera del eje (que aplica a todos los
    // valores y por lo tanto no es ambiguo).
    const fueraDelEje = politica.comodin ? candidatos.find((a) => a[campo] == null) : null;
    if (candidatos.length === 1) {
      articulo = candidatos[0];
    } else if (fueraDelEje) {
      articulo = fueraDelEje;
      elegidoPor = 'fuera-del-eje';
    } else if (politica.sinValor === 'default') {
      // 3c: manda el `default` del config, no el orden de inserción del
      // índice — que un reordenamiento silencioso de docs.config.json
      // volvería "la más vieja" sin que nadie lo note. Y se ANUNCIA: si la
      // plataforma se permite elegir, tiene que decir que eligió.
      articulo = candidatos.find((a) => String(a[campo]) === String(politica.default)) || null;
      if (articulo) elegidoPor = 'default';
    }
    if (!articulo) {
      // 3d: ambigüedad estructurada. Nunca `candidatos[0]`.
      const valores = candidatos.map((a) => a[campo]);
      return {
        ...cabecera,
        encontrado: false,
        motivo: 'ambiguo-en-eje',
        slugPedido: slug,
        mensaje: voc.ambiguo(slug, candidatos.length, valores),
        [voc.disponibles]: valores,
        sugerencias: candidatos.map((a) => fichaDe(a, politica)),
        siguientePaso: `leer({ slug: "${slug}", ${param}: "${candidatos[0][campo]}" })`,
      };
    }
  } else {
    // Sin eje los slugs son únicos: hay un solo candidato por definición.
    articulo = candidatos[0];
  }

  const body = articulo.body || '';
  const paginas = Math.max(1, Math.ceil(body.length / PAGINA_LEER));
  const desde = (pagina - 1) * PAGINA_LEER;
  const trozo = body.slice(desde, desde + PAGINA_LEER);

  const salida = {
    ...cabecera,
    encontrado: true,
    slug: articulo.slug,
    title: articulo.title,
    description: articulo.description,
    seccion: articulo.seccion,
    keywords: articulo.keywords || [],
    url: absoluta(articulo.url),
    headings: articulo.headings || [],
    page: pagina,
    paginas,
    hayMas: desde + trozo.length < body.length,
    body: trozo,
  };

  if (campo) {
    salida[param] = articulo[campo];
    salida[`${param}Label`] = idx.labelDeEje(articulo[campo]);
    // El mismo slug en otros valores del eje. Con eje `project` NO son "otras
    // versiones de lo mismo": son documentos distintos que casualmente
    // comparten nombre de archivo. La semántica la da `eje.tipo`, que viaja en
    // la cabecera del índice, así que el NOMBRE del campo es uno solo.
    salida.otrosDelEje = candidatos
      .filter((a) => a !== articulo)
      .map((a) => ({ valor: a[campo], url: absoluta(a.url) }));
    if (elegidoPor) {
      salida.elegidoPor = elegidoPor;
      if (elegidoPor === 'default') salida.mensaje = voc.elegido(articulo[campo]);
    }
  }
  for (const dominio of politica.camposDominio) {
    salida[dominio] = articulo[dominio] ?? (dominio === 'modules' ? [] : null);
  }

  return salida;
}

// ───────────────────────────────────────────────────────────────────── mapa

export function mapa() {
  const idx = indice();
  return {
    schemaVersion: idx.schemaVersion,
    buildId: idx.buildId,
    audiencia: idx.audiencia,
    generadoEl: idx.build.generatedAt,
    articulos: idx.build.articulos ?? idx.articulos.length,
    metadata: idx.build.metadata ?? {},
    ...ejeEnMapa(idx),
    mapa: idx.mapa,
  };
}
