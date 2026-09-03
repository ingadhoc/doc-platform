/**
 * Las TRES configs de los repos de origen, escritas contra el núcleo
 * unificado. Son fixture de test, pero son también la prueba de que el
 * paquete reproduce los tres dialectos sin `if (config.projects)` adentro: si
 * alguna de las tres no se puede expresar acá, la unificación es falsa.
 *
 * En el repo real cada una vive en su `docs.mcp.config.mjs`, y su `eje` /
 * `audiencias` / `secciones` son los MISMOS objetos de su `docs.config.json`
 * (que la función sí puede importar: el que no lee del filesystem es el edge).
 * Las prosas del eje YA NO se declaran acá: se derivan del `tipo` en
 * `describirEje()`. Lo único que queda por corpus es dominio de verdad —
 * `instructions`, `nombre`, carteles, títulos y los filtros de faceta.
 */

/** El eje de oba-docs: version, con default (obligatorio en ese tipo). */
const EJE_VERSION = {
  tipo: 'version',
  default: '19',
  valores: [
    { id: '19', label: '19.0' },
    { id: '18', label: '18.0' },
  ],
};

/** El de adhoc-docs: project, SIN default — y eso es la decisión, no un olvido. */
const EJE_PROJECT = {
  tipo: 'project',
  valores: [
    { id: 'adhoc-way', label: 'Adhoc Way' },
    { id: 'oba', label: 'Odoo by Adhoc' },
    { id: 'odumbo', label: 'Odumbo' },
  ],
};

export const CONFIG_OBA = {
  nombre: 'oba-docs',
  audiencias: ['publico', 'interno'],
  audienciasConGate: ['interno'],
  cartelMcp: {
    publico:
      'MCP público de la documentación de Odoo by Adhoc.\n\n' +
      'Este endpoint habla MCP (Streamable HTTP) por POST y NO requiere autenticación.\n' +
      'Conectalo, por ejemplo:\n\n' +
      '  claude mcp add -t http oba-docs <esta URL>\n\n' +
      'Tools: mapa() para orientarte, buscar() con filtro por versión, leer() para citar.\n',
  },
  eje: EJE_VERSION,
  secciones: { fueraDelEje: ['relacion'] },
  filtros: { modules: true },
  instructions:
    'Documentación de producto de Odoo by Adhoc. Flujo: `mapa()` para orientarte, ' +
    '`buscar()` para encontrar (filtrá SIEMPRE por la versión de Odoo que te pidieron), ' +
    '`leer()` para citar. Citá con la URL canónica más el ancla del heading. ' +
    'La versión pedida manda: nunca cites un artículo de otra versión sin decirlo.',
  feedback: { eje: EJE_VERSION },
};

/**
 * El mismo corpus de oba, con el MISMO eje `version`, y SIN
 * `secciones.fueraDelEje`. Es la config desde la task #73556: `relacion` pasó a
 * vivir dentro de cada versión, así que ningún artículo emite `eje: null` y no
 * queda contenido que aplique a todas.
 *
 * Existe para fijar que la prosa CROSS-VERSION de `buscar()` la enciende el
 * contenido DECLARADO y no el tipo de eje. El comodín del motor sigue prendido
 * con eje `version` —es una capacidad, no un contenido—, pero anunciárselo al
 * agente sin secciones detrás es ofrecerle un filtro que devuelve cero: el
 * mismo criterio que este repo aplica al eje de odumbo y al `modules` que nadie
 * declara.
 */
const { secciones: _seccionesDeOba, ...OBA_SIN_SECCIONES } = CONFIG_OBA;
export const CONFIG_OBA_SIN_SECCIONES = OBA_SIN_SECCIONES;

export const CONFIG_ODUMBO = {
  nombre: 'odumbo-docs',
  audiencias: ['publico', 'interno'],
  audienciasConGate: ['interno'],
  cartelMcp: {
    publico:
      'MCP público de la documentación de Odumbo.\n\n' +
      'Este endpoint habla MCP (Streamable HTTP) por POST y NO requiere autenticación.\n' +
      'Conectalo, por ejemplo:\n\n' +
      '  claude mcp add -t http odumbo-docs <esta URL>\n\n' +
      'Tools: mapa() para orientarte, buscar() para encontrar, leer() para citar.\n',
  },
  // El `versionado: false` de su docs.config.json, en el vocabulario unificado.
  // El día que Odumbo versione no hay que tocar código: cambia el `tipo`.
  eje: { tipo: 'none' },
  // Cero archivos de su `content/` declaran `modules:`, así que el filtro no
  // se ofrece: una tool que ofrece un filtro sin contenido detrás miente (es
  // el mismo criterio que su propio código aplicaba al eje).
  filtros: { modules: false },
  instructions:
    'Documentación de producto de Odumbo (integraciones de e-commerce y marketplaces ' +
    'con Odoo). Flujo: `mapa()` para orientarte, `buscar()` para encontrar, `leer()` ' +
    'para citar. Citá con la URL canónica más el ancla del heading. Este corpus NO ' +
    'tiene eje de versión: no inventes una ni supongas que te falta un filtro.',
  feedback: { eje: { tipo: 'none' } },
};

export const CONFIG_ADHOC = {
  nombre: 'adhoc-docs',
  audiencias: ['interno'],
  audienciasConGate: ['interno'],
  cartelMcp: {},
  titulos: {
    mapa: 'Mapa de la documentación interna',
    buscar: 'Buscar en la documentación interna',
  },
  eje: EJE_PROJECT,
  filtros: { modules: false, seccion: 'Sección dentro del project (el subpath de su árbol de docs).' },
  feedbackRutea: true,
  instructions:
    'Documentación interna de Adhoc: cómo trabajamos. El contenido viene de varios ' +
    'projects del patrón adhoc-way (adhoc-way, oba, odumbo…), y el project es el eje que ' +
    'discrimina — no hay versiones. Flujo: `mapa()` para orientarte, `buscar()` para ' +
    'encontrar (filtrá por `project` cuando sepas sobre cuál te preguntaron), `leer()` para ' +
    'citar. Citá con la URL canónica más el ancla del heading, y decí SIEMPRE de qué project ' +
    'es lo que citás: dos projects documentan temas parecidos con criterios propios, y ' +
    'atribuir mal una definición es peor que no encontrarla.',
  feedback: {
    eje: EJE_PROJECT,
    notas: ['_El contenido se trae por pull: el arreglo va en el repo del project, no acá._'],
  },
};
