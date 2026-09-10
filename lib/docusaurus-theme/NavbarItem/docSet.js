import {useLocation} from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * El doc set: varias documentaciones conviviendo en un mismo sitio.
 *
 * ES OPCIONAL Y ADITIVO. Un corpus que no declara `docSets` en su
 * `customFields` no se entera de que esto existe: el hook devuelve `null`, el
 * wrapper de `NavbarItem` no filtra nada y el selector no se declara. Odumbo y
 * adhoc-docs siguen exactamente igual.
 *
 * UN DOC SET AGRUPA SECCIONES, NO CARPETAS NUEVAS. La sección ya existe —es el
 * primer segmento del path después del valor del eje— y el build ya la calcula
 * para el sidebar y para el índice del agente. Derivar el doc set de la sección
 * significa que activarlo NO mueve un solo archivo de contenido ni cambia una
 * sola URL: es la diferencia entre una feature y una migración.
 *
 * Forma esperada en `customFields.docSets`:
 *
 *   [{ id: 'manual', label: 'Manual de usuario',
 *      secciones: ['manual', 'guias', 'relacion'], default: true },
 *    { id: 'novedades', label: 'Novedades de versión',
 *      secciones: ['novedades'] }]
 */

/**
 * LOS VALORES DEL EJE, SIN ACOPLARSE A UN CONSUMIDOR. `versionPaths` es un
 * customField que hoy emite solo oba-docs; adhoc-docs llama `projects` a lo
 * suyo y odumbo-docs no tiene eje. Este módulo es de la PLATAFORMA, así que
 * declara su propio nombre —`ejeValores`— y acepta el de oba como alias
 * mientras dure. Sin ninguno de los dos, el eje no existe para este código y
 * el primer segmento se lee como sección: que es exactamente lo correcto en un
 * corpus sin eje.
 */
export function ejeValoresDe(siteConfig) {
  const cf = siteConfig?.customFields ?? {};
  if (Array.isArray(cf.ejeValores)) return cf.ejeValores;
  if (Array.isArray(cf.versionPaths)) return cf.versionPaths;
  return [];
}

/** La sección de un pathname, saltando el segmento del eje si lo hay. */
export function seccionDe(pathname, valoresDelEje = []) {
  const segmentos = pathname.split('/').filter(Boolean);
  if (segmentos.length === 0) return null;
  // con eje: /19/manual/x  ·  sin eje: /manual/x
  return valoresDelEje.includes(segmentos[0]) ? (segmentos[1] ?? null) : segmentos[0];
}

/** El valor del eje en el que está parado el usuario, o `null` si no hay eje. */
export function valorDelEjeDe(pathname, valoresDelEje = []) {
  const primero = pathname.split('/').filter(Boolean)[0];
  return valoresDelEje.includes(primero) ? primero : null;
}

/**
 * El doc set activo, o `null` si el corpus no declara doc sets.
 *
 * Cuando la ruta no cae en ninguna sección conocida —la home, `/search`, un
 * 404— gana el que esté marcado `default`, y si ninguno lo está, el primero.
 * Nunca devuelve `null` habiendo doc sets declarados: un navbar que a veces no
 * sabe dónde está parado esconde items sin motivo aparente.
 */
export function useDocSet() {
  const {siteConfig} = useDocusaurusContext();
  const {pathname} = useLocation();
  const {docSets = []} = siteConfig.customFields ?? {};
  if (!Array.isArray(docSets) || docSets.length === 0) return null;

  const seccion = seccionDe(pathname, ejeValoresDe(siteConfig));
  const porSeccion = docSets.find((d) => (d.secciones ?? []).includes(seccion));
  if (porSeccion) return porSeccion;
  return docSets.find((d) => d.default) ?? docSets[0];
}
