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
 * NUNCA PARA PARTIR POR VALOR DEL EJE. Eso suena a "scope por versión", pero el
 * scope por versión ya lo da Docusaurus: las versiones que no son la última se
 * emiten como `versioned_docs` y el plugin escribe un índice por versión, en el
 * subdirectorio de cada una. Un contexto por versión duplica ese scope y no
 * agrega nada.
 *
 * SÍ PARA PARTIR POR DOC SET, que es otra cosa. `contextos` recibe las rutas de
 * las documentaciones que NO son la default: el plugin les arma índice propio y
 * deja el resto en el índice raíz (`postBuildFactory.js`: un documento que
 * matchea un contexto no va al raíz salvo que se pida
 * `useAllContextsWithNoSearchContext`). Parado en el manual se busca en el
 * manual; parado en las novedades, en las novedades — el mismo criterio que la
 * versión, aplicado al otro eje del navbar.
 *
 * EL RIESGO QUE ESTO TUVO, Y POR QUÉ YA NO APLICA. Hasta v0.7.1 los contextos
 * estaban prohibidos acá, con evidencia: el índice del contexto `19` tenía 503
 * URLs del manual y CERO de `relacion`. La causa NO era el mecanismo — era que
 * `relacion` vivía FUERA del eje, así que sus URLs no empezaban con el
 * segmento de versión y el reparto las mandaba a otro lado. El ADR 0010 de
 * knowledge-management metió todo el contenido adentro del eje y esa causa
 * desapareció. Lo que queda es el modo de falla genérico —un documento que no
 * cae en ningún índice desaparece del buscador en silencio— y contra eso el
 * consumidor verifica COBERTURA: la suma de sus índices tiene que cubrir todo
 * el contenido publicado.
 *
 * `hideSearchBarWithNoSearchContext` se deja explícitamente en `false`: con
 * `true` el plugin NO crea el índice raíz, y el doc set default se quedaría sin
 * buscador en vez de con el suyo.
 */
function opcionesDelTema({ docsRouteBasePath = ['/'], contextos = [] } = {}) {
  if (!Array.isArray(docsRouteBasePath) || docsRouteBasePath.length === 0) {
    throw new Error(
      'opcionesDelTema: `docsRouteBasePath` tiene que ser una lista no vacía de rutas base ' +
        "de docs del sitio (el default es ['/']); vacía, el plugin no indexa nada.",
    );
  }
  if (!Array.isArray(contextos)) {
    throw new Error('opcionesDelTema: `contextos` tiene que ser una lista de rutas (el default es []).');
  }
  return {
    hashed: true,
    language: [...IDIOMAS],
    indexDocs: true,
    indexBlog: false,
    docsRouteBasePath: [...docsRouteBasePath],
    highlightSearchTermsOnTargetPage: true,
    ...(contextos.length
      ? {
          searchContextByPaths: [...contextos],
          // el índice raíz se sigue emitiendo: es el del doc set default
          hideSearchBarWithNoSearchContext: false,
          // un documento que cayó en un contexto NO vuelve al raíz: es lo que
          // hace que parado en el manual no aparezcan las novedades
          useAllContextsWithNoSearchContext: false,
        }
      : {}),
  };
}

module.exports = { IDIOMAS, opcionesDelTema };
