/**
 * La configuración del buscador del sitio, en un solo lugar.
 *
 * POR QUÉ EXISTE: el motor de búsqueda es de la plataforma (ADR 0007), pero su
 * configuración vivía copiada en el `docusaurus.config.js` de cada repo — y una
 * config copiada diverge igual que el código copiado. Divergió: oba-docs partía
 * el índice por versión con `searchContextByPaths` y eso dejaba la sección
 * fuera del eje (`relacion`) invisible desde el manual; adhoc-docs no lo hacía
 * y documentaba en un comentario por qué. Dos dialectos del mismo motor.
 *
 * Y hay una razón dura además de la higiene: `bin/indice-fuera-del-eje.mjs`
 * RECONSTRUYE índices lunr después del build, y tiene que hacerlo con
 * exactamente el mismo idioma y pipeline que usó el build. Si el sitio y el
 * post-proceso configuran el motor por separado, el día que uno cambie el
 * índice reconstruido queda con otro stemmer y la búsqueda devuelve resultados
 * distintos según qué versión mires. Una fuente, no dos.
 *
 * Es `.cjs` por lo mismo que `docusaurus-plugin.cjs`: este paquete es
 * `"type": "module"` y el `docusaurus.config.js` de los tres repos es CommonJS.
 */

/**
 * Los idiomas del corpus. `es` es el contenido; `en` entra porque el manual
 * cita nombres de módulos, campos y mensajes de Odoo en inglés, y sin el
 * stemmer inglés esas palabras no matchean sus variantes.
 */
const IDIOMAS = ['es', 'en'];

/**
 * Lo que `buildIndex()` del plugin necesita para armar un índice lunr. Es el
 * subconjunto de las opciones del tema que afecta al índice — el resto (el
 * highlight, el atajo de teclado) es del cliente y no toca el artefacto.
 *
 * Los dos `remove*` van explícitos aunque coincidan con el default del plugin:
 * son justamente los que, cambiados en el tema y no acá, harían que el índice
 * reconstruido tokenice distinto del que emitió el build.
 */
const OPCIONES_DE_INDICE = {
  language: IDIOMAS,
  removeDefaultStopWordFilter: [],
  removeDefaultStemmer: false,
};

/**
 * Las opciones del tema `@easyops-cn/docusaurus-search-local`, para el
 * `themes:` del consumidor.
 *
 * @param {object} opciones
 * @param {string[]} opciones.docsRouteBasePath - Las rutas base de docs del
 *   sitio. Es lo único que difiere entre repos: oba-docs monta un segundo
 *   plugin de docs para la sección fuera del eje (`['/', 'relacion']`), los
 *   demás tienen uno solo (`['/']`).
 *
 * SIN `searchContextByPaths`, a propósito y para los tres repos. Partir el
 * índice por valor del eje suena a "scope por versión", pero el scope por
 * versión ya lo da Docusaurus: las versiones que no son la última se emiten
 * como `versioned_docs` y el plugin escribe un índice por versión, en el
 * subdirectorio de cada una. Los contextos duplicaban ese scope, y como el
 * contenido fuera del eje no cae en ningún contexto, lo dejaban afuera del
 * índice desde el que se busca. Medido en producción antes de sacarlo: el
 * índice del contexto `19` tenía 503 URLs del manual y CERO de `relacion`.
 */
function opcionesDelTema({ docsRouteBasePath }) {
  if (!Array.isArray(docsRouteBasePath) || docsRouteBasePath.length === 0) {
    throw new Error(
      'opcionesDelTema: falta `docsRouteBasePath`. Es la lista de rutas base de docs ' +
        "del sitio (p. ej. ['/', 'relacion']); sin ella el plugin no indexa nada.",
    );
  }
  return {
    hashed: true,
    language: [...IDIOMAS],
    indexDocs: true,
    indexBlog: false,
    docsRouteBasePath: [...docsRouteBasePath],
    highlightSearchTermsOnTargetPage: true,
  };
}

module.exports = { IDIOMAS, OPCIONES_DE_INDICE, opcionesDelTema };
