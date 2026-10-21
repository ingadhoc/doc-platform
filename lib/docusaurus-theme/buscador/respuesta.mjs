/** What the worker answers the box: the reader's search, with the ranges to mark already located. */

import { PERFIL, ubicarTerminos } from '../../mcp/motor.mjs';

export function respuestaDelBuscador(motor, { q, docSet, page }) {
  const respuesta = motor.buscar({ q, docSet, page, perfil: PERFIL.persona });
  return {
    q,
    total: respuesta.total,
    page: respuesta.page,
    paginas: respuesta.paginas,
    hayMas: respuesta.hayMas,
    resultados: respuesta.resultados.map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      url: hit.url,
      urlAncla: hit.urlAncla ?? null,
      ancla: hit.ancla?.text ?? null,
      fragmento: hit.fragmento ?? '',
      resaltar: hit.resaltar,
      rangosTitulo: ubicarTerminos(hit.title, hit.resaltar),
      rangosAncla: hit.ancla?.text ? ubicarTerminos(hit.ancla.text, hit.resaltar) : [],
      rangosFragmento: ubicarTerminos(hit.fragmento ?? '', hit.resaltar),
    })),
  };
}
