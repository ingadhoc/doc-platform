/**
 * The search box logic that does not need React or the DOM, so it can be
 * tested with `node --test`.
 */

/** A hit's URL inside the site, with the anchor of what matched. */
export function rutaDelHit(hit, baseUrl = '/') {
  const ruta = hit.urlAncla || hit.url;
  if (!ruta.startsWith('/') || baseUrl === '/') return ruta;
  return baseUrl.replace(/\/$/, '') + ruta;
}

/** `texto` cut into the pieces to mark and the ones not to, from `{ pos, largo }` ranges. */
export function tramos(texto, rangos = []) {
  const out = [];
  let desde = 0;
  for (const { pos, largo } of rangos) {
    if (pos < desde) continue;
    if (pos > desde) out.push({ texto: texto.slice(desde, pos), marca: false });
    out.push({ texto: texto.slice(pos, pos + largo), marca: true });
    desde = pos + largo;
  }
  if (desde < texto.length) out.push({ texto: texto.slice(desde), marca: false });
  return out;
}

/**
 * The list state of the combobox: whether it is open and which option is
 * active (-1 = none). The first option is active as soon as results arrive,
 * so Enter goes to the first hit, as in the previous search box.
 */
export const COMBOBOX_INICIAL = Object.freeze({ abierto: false, activo: -1, total: 0 });

export function combobox(estado, accion) {
  switch (accion.tipo) {
    case 'resultados':
      return { abierto: accion.abrir ?? estado.abierto, activo: accion.total > 0 ? 0 : -1, total: accion.total };
    case 'abrir':
      return { ...estado, abierto: true };
    case 'cerrar':
      return { ...estado, abierto: false };
    case 'abajo':
      if (!estado.total) return estado;
      if (!estado.abierto) return { ...estado, abierto: true };
      return { ...estado, activo: (estado.activo + 1) % estado.total };
    case 'arriba':
      if (!estado.total) return estado;
      if (!estado.abierto) return { ...estado, abierto: true };
      return { ...estado, activo: (estado.activo - 1 + estado.total) % estado.total };
    case 'apuntar':
      return accion.indice >= 0 && accion.indice < estado.total ? { ...estado, activo: accion.indice } : estado;
    default:
      return estado;
  }
}

/** What a key does in the search box; `null` lets the browser handle it. */
export function accionDeTecla(evento, estado) {
  if (evento.isComposing) return null;
  switch (evento.key) {
    case 'ArrowDown':
      return { tipo: 'abajo' };
    case 'ArrowUp':
      return { tipo: 'arriba' };
    case 'Enter':
      return estado.abierto && estado.activo >= 0 ? { tipo: 'elegir', indice: estado.activo } : null;
    case 'Escape':
      return estado.abierto ? { tipo: 'cerrar' } : { tipo: 'limpiar' };
    default:
      return null;
  }
}
