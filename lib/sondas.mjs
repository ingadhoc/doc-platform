/**
 * El cálculo de las sondas del guard de fuga: el PRODUCTOR de
 * `.guard/removido.json`. El consumidor es `guard-fuga.mjs`.
 *
 * Vivía copiado en el `tools/build.mjs` de cada repo de contenido, y las copias
 * ya habían divergido: `oba-docs` tenía los dos dominios de texto, el filtro de
 * sondas que no discriminan y el fail-closed de las líneas sin sonda;
 * `odumbo-docs` no tenía ninguno de los tres. Un arreglo del cálculo llegaba a
 * un sitio y no al otro.
 *
 * El reparto con el repo de contenido:
 *
 *   - el REPO junta el material, porque sale de su preprocesador: las líneas que
 *     su `applyBlocks()` borró por internas (`removido`) y el texto que emitió
 *     (`publicado`, ya pasado por `trigramas()`);
 *   - la PLATAFORMA decide qué es una sonda y escribe el manifiesto que lee el
 *     guard. Así el contrato productor ↔ consumidor vive en un solo paquete.
 *
 * Sondas = TRIGRAMAS de palabras contiguas, no palabras sueltas. Con palabras
 * sueltas el guard bloqueó un deploy real por `database`, `responder` y
 * `timeout` encontradas en `assets/js/main.js` — vocabulario del bundle de
 * React y Docusaurus, no contenido fugado. Tres palabras contiguas son
 * específicas del texto: no aparecen por casualidad en un bundle, y si el
 * contenido interno se filtra, se filtra la frase entera.
 *
 * DOS DOMINIOS DE TEXTO, NO UNO. El guard escanea artefactos de dos clases y
 * los trigramas tienen que calcularse en las dos, o el desajuste se paga en las
 * dos direcciones:
 *
 *   a) `site/build` (HTML y `search-index.json`) lleva el texto RENDERIZADO: el
 *      destino de un link es un `href` que el guard borra con los tags, y una
 *      imagen no deja texto. `[…las facturas A](…-facturas-a.md)` seguido de un
 *      bloque que arranca `Esta página cubre…` es, ahí, `…facturas a esta
 *      página…` — y el índice de búsqueda colapsa el corte entre bloques, así
 *      que el cruce es indistinguible de una frase. Calculado solo sobre el
 *      markdown, ese trigrama nunca entraba en `publicado` y quedaba de sonda:
 *      frenó un preview de `oba-docs` sin que hubiera fuga (oba-docs#166).
 *
 *   b) `api/_generated/index.json` —el índice que consume el MCP, que el guard
 *      escanea vía `--extra`— lleva el cuerpo en MARKDOWN CRUDO, con los
 *      destinos y los alt adentro. Ahí `mailto federico cabrera` o
 *      `extr 1766032 png` sí son alcanzables. Calcular solo sobre el texto
 *      renderizado le sacaba al guard 100 sondas medidas sobre ese artefacto.
 *
 * Por eso `trigramas` devuelve la UNIÓN de los dos dominios. Una sonda vale si
 * el trigrama está en el texto interno en ALGUNO de los dos, y sobrevive al
 * filtro si no está en el texto público en NINGUNO: es la única combinación que
 * no pierde detección ni deja pasar el falso positivo del cruce.
 */

import fs from 'node:fs';
import path from 'node:path';

/** El texto como queda PUBLICADO: sin destino de link y sin la imagen. */
export const comoSePublica = (txt) => txt
  .replace(/!\[[^\]]*\]\([^)\s]*\)/g, ' ')    // la imagen no deja texto: el alt es un atributo
  .replace(/\]\([^)\s]*\)/g, ']');            // del link sobrevive el texto, no el destino

export const normalizar = (txt) => txt
  .toLowerCase()
  .replace(/[`*_~#>\[\]()|{}"'\\]/g, ' ')     // markdown y escapes
  .replace(/[^a-záéíóúñü0-9]+/gi, ' ')         // el resto a separadores
  .trim();

const gramas = (txt) => {
  const w = normalizar(txt).split(' ').filter(Boolean);
  const out = [];
  if (w.length === 0) return out;
  if (w.length < 3) { out.push(w.join(' ')); return out; }
  for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3).join(' '));
  return out;
};

export const trigramas = (txt) => [...new Set([...gramas(txt), ...gramas(comoSePublica(txt))])];

/**
 * UNA SONDA TIENE QUE DISCRIMINAR. Medido en el deploy público de Finanzas: el
 * trigrama `la 19 0` —de un `:::interno` que dice "el código fuente de la 18.0
 * y la 19.0 no pudo leerse"— frenó el build, porque una página pública dice
 * "desde la 19.0". No es una fuga: es un número de versión. Lo mismo pasó con
 * `que verificar qué`, tres palabras funcionales que aparecen en cualquier
 * prosa. Un trigrama sin ninguna palabra de contenido no distingue contenido
 * interno de público, y el falso positivo se paga reescribiendo prosa correcta
 * — o peor, aprendiendo a ignorar el guard.
 *
 * Contenido = una palabra de 4+ letras que no esté en esta lista. La lista es
 * corta A PROPÓSITO: cada palabra que se agrega le quita sensibilidad al guard,
 * así que solo entran las que no aportan significado en ninguna oración.
 */
export const FUNCIONALES = new Set([
  'para', 'como', 'este', 'esta', 'esto', 'esos', 'esas', 'desde', 'hasta',
  'donde', 'cuando', 'porque', 'sobre', 'entre', 'pero', 'cada', 'todo',
  'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'antes',
  'luego', 'sino', 'aunque', 'mismo', 'misma', 'según', 'ante', 'tras',
  'bajo', 'solo', 'también', 'más', 'menos', 'muy', 'poco', 'algo',
]);

export const discrimina = (g) =>
  g.split(' ').some((w) => w.length >= 4 && /^[a-záéíóúñü]+$/.test(w) && !FUNCIONALES.has(w));

/**
 * Las sondas de un build, a partir de lo que el preprocesador borró y publicó.
 *
 * @param {object} material
 * @param {Iterable<string>} material.removido   líneas o bloques internos borrados.
 * @param {Set<string>}      material.publicado  trigramas del texto emitido.
 * @returns {{ sondas: string[], sinCobertura: string[], descartadas: number, bloques: number }}
 *   `sinCobertura` son las líneas que TENÍAN trigramas y el filtro se los comió
 *   todos: quedan sin verificar, y eso es falla, no aviso.
 */
export function calcularSondas({ removido, publicado }) {
  const internas = new Set();
  const sinCobertura = [];
  let descartadas = 0;
  let bloques = 0;
  for (const bloque of removido) {
    bloques++;
    const gs = trigramas(bloque).filter((g) => g.includes(' ') && !publicado.has(g));
    const utiles = gs.filter(discrimina);
    for (const g of utiles) internas.add(g);
    descartadas += gs.length - utiles.length;
    if (gs.length && !utiles.length) sinCobertura.push(bloque.trim().slice(0, 90));
  }
  return { sondas: [...internas].sort(), sinCobertura, descartadas, bloques };
}

/** El texto del error cuando hay líneas internas sin sonda. */
export function explicarSinCobertura(sinCobertura) {
  return [
    '✗ El guard de fuga se quedaría sin sonda para estas líneas internas:',
    '',
    ...sinCobertura.slice(0, 5).map((l) => `  • ${l}`),
    '',
    '  Todos sus trigramas son palabras funcionales o números, así que ninguno',
    '  distingue esa línea de prosa pública. Reescribila con un término propio',
    '  (un nombre de módulo, de campo, de menú) para que el guard pueda medirla.',
  ].join('\n');
}

/**
 * Calcula las sondas y escribe `<raiz>/.guard/removido.json`, el manifiesto que
 * lee `docs-guard-fuga`. Va FUERA de `site/` a propósito: tiene el contenido
 * interno en texto plano y no debe poder terminar en el output.
 *
 * Con líneas sin cobertura NO escribe nada y devuelve `ok: false`: el build
 * tiene que abortar (ver `explicarSinCobertura()`).
 *
 * @param {object} opciones
 * @param {string} opciones.raiz       raíz del repo de contenido.
 * @param {string} opciones.audience   audiencia del build.
 * @param {string} opciones.target     target del preprocesador.
 * @param {string} opciones.content    árbol fuente, relativo a la raíz (lo verifica el guard).
 * @param {Iterable<string>} opciones.removido
 * @param {Set<string>}      opciones.publicado
 */
export function escribirManifiesto({ raiz, audience, target, content, removido, publicado }) {
  const r = calcularSondas({ removido, publicado });
  if (r.sinCobertura.length) return { ok: false, ...r };
  const dir = path.join(raiz, '.guard');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, 'removido.json');
  fs.writeFileSync(archivo, JSON.stringify({
    audience,
    target,
    content,
    bloques: r.bloques,
    sondas: r.sondas,
  }, null, 1));
  return { ok: true, archivo, ...r };
}
