/**
 * La configuración del buscador del sitio, en un solo lugar.
 *
 * POR QUÉ EXISTE: el motor de búsqueda es de la plataforma (ADR 0007), pero su
 * configuración vivía copiada en el `docusaurus.config.js` de cada repo — y una
 * config copiada diverge igual que el código copiado. Divergió: oba-docs partía
 * el índice por versión con `searchContextByPaths` y adhoc-docs no lo hacía, y
 * documentaba en un comentario por qué. Dos dialectos del mismo motor, y el
 * dialecto de oba se comía contenido del índice desde el que se busca.
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
 * Las opciones del tema `@easyops-cn/docusaurus-search-local`, para el
 * `themes:` del consumidor.
 *
 * @param {object} [opciones]
 * @param {string[]} [opciones.docsRouteBasePath] - Las rutas base de docs del
 *   sitio. Default `['/']`, que es lo que tienen los tres repos: una sola
 *   instancia de docs montada en la raíz. El parámetro sigue existiendo porque
 *   un corpus que monte un segundo plugin de docs necesita nombrar su ruta —
 *   oba-docs lo hizo mientras tuvo la sección `relacion` fuera del eje
 *   (`['/', 'relacion']`), y ese contenido pasó a vivir dentro de cada versión.
 *
 * SIN `searchContextByPaths`, a propósito y para los tres repos. Partir el
 * índice por valor del eje suena a "scope por versión", pero el scope por
 * versión ya lo da Docusaurus: las versiones que no son la última se emiten
 * como `versioned_docs` y el plugin escribe un índice por versión, en el
 * subdirectorio de cada una. Los contextos duplican ese scope, y encima
 * cualquier documento que no caiga en ninguno queda afuera del índice desde el
 * que se busca. Medido en producción antes de sacarlo, con la sección que
 * entonces vivía fuera del eje: el índice del contexto `19` tenía 503 URLs del
 * manual y CERO de `relacion`.
 *
 * Nota honesta: hasta v0.7.1 había además un control automático —el bin
 * `docs-indice-fuera-del-eje` fallaba el build si encontraba el índice partido
 * por contexto—. Ese bin se borró en v0.8.0 con el contenido fuera del eje que
 * lo justificaba, así que la decisión ahora se sostiene sólo en que esta
 * función es la única fuente de las opciones del tema: si vuelve
 * `searchContextByPaths`, tiene que volver acá.
 */
function opcionesDelTema({ docsRouteBasePath = ['/'] } = {}) {
  if (!Array.isArray(docsRouteBasePath) || docsRouteBasePath.length === 0) {
    throw new Error(
      'opcionesDelTema: `docsRouteBasePath` tiene que ser una lista no vacía de rutas base ' +
        "de docs del sitio (el default es ['/']); vacía, el plugin no indexa nada.",
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

module.exports = { IDIOMAS, opcionesDelTema };
