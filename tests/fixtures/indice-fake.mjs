/**
 * Índice FALSO para los tests del núcleo del MCP.
 *
 * El núcleo unificado (`mcp-handler.mjs`) no busca ni lee nada: registra las
 * tools, arma sus schemas según el eje, y delega en el módulo del índice del
 * repo. Este fake existe para poder probar ESA franja — el cableado — sin
 * arrastrar `indice.mjs` (que tiene sus propios tests y sus propios fixtures,
 * `tests/fixtures/index.json` en adhoc-docs).
 *
 * NO es un motor de búsqueda: `buscar()` hace substring sobre título y cuerpo,
 * y `leer()` busca por slug (+ eje). Alcanza y sobra para verificar que el
 * argumento del eje llega con el nombre correcto, que el payload vuelve
 * serializado, y que `errorIndice` corta las tools.
 *
 * Guarda las llamadas en `llamadas` para poder afirmar sobre los argumentos
 * exactos que el núcleo pasó.
 */

const CORPUS = [
  { slug: 'index', eje: 'a', title: 'Portada A', body: 'Entorno de desarrollo y devcontainer.' },
  { slug: 'index', eje: 'b', title: 'Portada B', body: 'Entorno de produccion.' },
  { slug: 'flujo/pr-flow', eje: 'a', title: 'PR flow', body: 'Modo y destino de la publicacion.' },
  { slug: 'sin-eje', eje: null, title: 'Cross', body: 'Aplica a todos los valores del eje.' },
];

export function crearIndiceFake({ tipo = 'version', tirar = null } = {}) {
  // El nombre del parámetro es la palabra del dominio (`version`/`project`),
  // igual que en el motor de verdad; el campo del artículo es `eje`.
  const ejeParam = tipo === 'none' ? null : tipo;
  const llamadas = [];

  function indice() {
    if (tirar) throw tirar;
    return { articulos: CORPUS.length };
  }

  function mapa() {
    llamadas.push(['mapa', {}]);
    return {
      schemaVersion: 1,
      buildId: '2026-08-20T00:00:00.000Z',
      articulos: CORPUS.length,
      secciones: ['flujo'],
      // El índice es quien declara si el corpus tiene eje AHORA: el mismo
      // objeto del contrato (`{ tipo, ... }`). Con `tipo: 'none'` el núcleo no
      // expone el parámetro, aunque la config declare uno (ver
      // `ejeHabilitado()`).
      eje: ejeParam ? { tipo, param: ejeParam, valores: ['a', 'b'] } : { tipo: 'none' },
    };
  }

  function buscar(args) {
    llamadas.push(['buscar', args]);
    const q = String(args.q || '').toLowerCase();
    const pedido = ejeParam ? [].concat(args[ejeParam] ?? []) : [];
    const hits = CORPUS.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(q)).filter(
      (a) => pedido.length === 0 || a.eje === null || pedido.includes(a.eje),
    );
    return {
      total: hits.length,
      page: args.page ?? 1,
      filtros: ejeParam ? { [ejeParam]: pedido } : {},
      resultados: hits.map((a) => ({
        slug: a.slug,
        title: a.title,
        ...(ejeParam ? { [ejeParam]: a.eje } : {}),
      })),
    };
  }

  function leer(args) {
    llamadas.push(['leer', args]);
    const candidatos = CORPUS.filter((a) => a.slug === args.slug);
    if (candidatos.length === 0) return { encontrado: false, motivo: 'slug-inexistente' };
    const pedido = ejeParam ? args[ejeParam] : null;
    const elegido = pedido ? candidatos.find((a) => a.eje === pedido) : candidatos[0];
    if (!elegido) return { encontrado: false, motivo: 'slug-fuera-del-valor-pedido' };
    return {
      encontrado: true,
      slug: elegido.slug,
      ...(ejeParam ? { [ejeParam]: elegido.eje } : {}),
      body: elegido.body,
    };
  }

  return { indice, mapa, buscar, leer, PAGINA_BUSCAR: 8, llamadas };
}
