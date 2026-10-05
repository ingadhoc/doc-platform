/**
 * Dónde están los términos de la consulta dentro de un texto, para resaltarlos.
 *
 * POR QUÉ EXISTE ESTO. La interfaz del buscador consume POSICIONES de caracteres
 * —`[[inicio, largo], …]` sobre el texto original— porque así se las daba lunr
 * en `matchData.metadata`. MiniSearch devuelve `terms` y `match`, o sea QUÉ
 * términos entraron, pero **no dónde**. Esta capa es la que cierra ese hueco, y
 * hay que escribirla igual por cualquiera de los caminos de interfaz: no es una
 * consecuencia de vendorear, es una consecuencia de cambiar de motor.
 *
 * LAS TRES DECISIONES, y por qué cada una:
 *
 * 1. **Insensible a tildes en las dos direcciones.** El motor indexa términos
 *    normalizados, así que `mercaderia` encuentra el artículo que dice
 *    «mercadería». Si el resaltado comparara el texto crudo, el término que
 *    hizo match no aparecería marcado y la sugerencia se vería sin resaltar
 *    justo en la palabra que la trajo.
 *
 * 2. **Sólo al principio de palabra, nunca en el medio.** El motor busca por
 *    prefijo (`prefix: true`): `factur` encuentra `facturación`. Lo que NO hace
 *    es matchear en el medio, así que resaltar `cuenta` dentro de «descuenta»
 *    marcaría algo que no participó del match. Es exactamente el error que se
 *    arregló en el resaltado del sitio (v0.12.1, `accuracy: 'partially'` de
 *    mark.js marcaba subcadenas), y no se vuelve a cometer acá.
 *
 * 3. **Se marca la palabra entera, no sólo el prefijo tipeado.** Es lo que
 *    hacía lunr —sus posiciones son las del token indexado completo— y lo que se
 *    lee mejor: con `factur` queda «**facturación**» y no «**factur**ación».
 *
 * EL DETALLE QUE HACE FALTA CUIDAR: quitar tildes con NFD **cambia el largo**
 * del texto (`é` se descompone en dos). Por eso no alcanza con normalizar y
 * buscar: hay que llevar un mapa de vuelta de cada carácter normalizado a su
 * posición en el original. Sin eso los offsets salen corridos justo en los
 * textos con tildes, que en castellano son casi todos.
 */

/** Minúsculas y sin tildes, un código de carácter a la vez. */
const plano = (caracter) =>
  caracter
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const ES_PALABRA = /[\p{L}\p{N}]/u;

/**
 * Versión normalizada del texto + el mapa de vuelta al original.
 *
 * Se recorre por PUNTO DE CÓDIGO (`for…of`) y no por índice: un emoji ocupa dos
 * unidades y recorrerlo por índice lo parte al medio, con lo que el mapa queda
 * apuntando a la mitad de un carácter.
 */
function normalizarConMapa(texto) {
  let normalizado = '';
  const mapa = [];
  let posicion = 0;
  for (const punto of texto) {
    const trozo = plano(punto);
    // Una entrada del mapa por UNIDAD de código del trozo, no por punto: el
    // `indexOf` de más abajo trabaja en unidades, así que un emoji (que ocupa
    // dos) tiene que ocupar dos lugares del mapa o los offsets se corren.
    for (let i = 0; i < trozo.length; i++) mapa.push({ desde: posicion, largo: punto.length });
    normalizado += trozo;
    posicion += punto.length;
  }
  return { normalizado, mapa };
}

/** Une los rangos que se pisan o se tocan, para no emitir `<mark>` anidados. */
function unir(rangos) {
  const ordenados = rangos.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const salida = [];
  for (const [inicio, largo] of ordenados) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && inicio <= ultimo[0] + ultimo[1]) {
      ultimo[1] = Math.max(ultimo[1], inicio + largo - ultimo[0]);
    } else {
      salida.push([inicio, largo]);
    }
  }
  return salida;
}

/**
 * @param texto    el texto original, tal como se va a mostrar.
 * @param terminos los términos de la consulta (crudos: se normalizan acá).
 * @returns `[[inicio, largo], …]` sobre el texto ORIGINAL, ordenado y sin
 *          solaparse. Vacío si no hay nada que marcar.
 */
export function posicionesDeTerminos(texto, terminos) {
  if (!texto || !terminos?.length) return [];

  const { normalizado, mapa } = normalizarConMapa(texto);
  const rangos = [];

  for (const crudo of terminos) {
    const termino = plano(String(crudo ?? '')).replace(/[^\p{L}\p{N}]+/gu, '');
    if (!termino) continue;

    let desde = 0;
    for (;;) {
      const encontrado = normalizado.indexOf(termino, desde);
      if (encontrado === -1) break;
      desde = encontrado + 1;

      // Principio de palabra, o no cuenta (decisión 2 del docstring).
      const anterior = normalizado[encontrado - 1];
      if (anterior && ES_PALABRA.test(anterior)) continue;

      // La palabra entera, no sólo el prefijo (decisión 3).
      let fin = encontrado + termino.length;
      while (fin < normalizado.length && ES_PALABRA.test(normalizado[fin])) fin++;

      const primero = mapa[encontrado];
      const ultimo = mapa[fin - 1];
      if (!primero || !ultimo) continue;
      rangos.push([primero.desde, ultimo.desde + ultimo.largo - primero.desde]);
    }
  }

  return unir(rangos);
}
