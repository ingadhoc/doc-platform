/**
 * The indexes the site's search box downloads, built from the same
 * `index.json` the MCP reads. Runs at build time (plugin `postBuild`).
 */

export const CARPETA_DEL_BUSCADOR = 'buscador';

/**
 * One index per version when the axis is a version (the same article exists
 * in every version, and the site shows one at a time); a single one for the
 * whole site otherwise. Articles with no axis value go in every file.
 *
 * Returns `[{ archivo, eje, crudo }]`; `eje: null` is the file used outside
 * any axis value (the home page, `/search`): the default version, or the
 * whole site.
 */
export function indicesDelBuscador(crudo) {
  const eje = crudo?.build?.eje;
  const porVersion = eje?.tipo === 'version' && Array.isArray(eje.valores) && eje.valores.length > 0;
  if (!porVersion) return [{ archivo: 'indice.json', eje: null, crudo }];

  const valores = eje.valores.map((v) => String(v.id ?? v));
  const subconjunto = (valor) => {
    const articulos = crudo.articulos.filter((a) => a.eje == null || String(a.eje) === valor);
    return { ...crudo, build: { ...crudo.build, articulos: articulos.length }, articulos };
  };
  const porDefecto = String(eje.default ?? valores[0]);
  return [
    ...valores.map((valor) => ({ archivo: `${valor}.json`, eje: valor, crudo: subconjunto(valor) })),
    { archivo: 'indice.json', eje: null, crudo: subconjunto(porDefecto) },
  ];
}
