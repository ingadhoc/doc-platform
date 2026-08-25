/**
 * El widget de chat de Tuqui, como campo `scripts` de un `docusaurus.config.js`.
 *
 * Cualquier sitio de la plataforma puede embeber el widget declarando
 * `TUQUI_EMBED_ID` en su proyecto de Vercel. **Si la variable está, el script se
 * agrega; si no está, no existe.** No hay default y no lo va a haber: prender el
 * chat es una decisión del proyecto de Vercel donde se setea la variable, no algo
 * que arrastre un `npm run build` local, el build interno o un fork del repo.
 *
 * NO HAY `data-color`. El estilo del widget se gobierna del lado de Tuqui, que
 * es el único lugar donde se puede cambiar sin redeployar tres sitios. Un
 * data-attribute por sitio era la copia forkeada del ADR 0007 otra vez, y
 * además no podía leer la custom property de CSS que pretendía replicar.
 *
 * POR QUÉ SE VALIDA EL ID. Esto corre en el `buildCommand` de sitios
 * **públicos**, y el valor termina interpolado dentro de un tag `<script>` del
 * HTML emitido. Un id con un espacio, una comilla o un `"><script` es
 * inyección de markup en todas las páginas del sitio — con la variable de
 * entorno como vector. Así que el id se valida contra la forma UUID y, si no
 * matchea, el build **aborta**: un widget que no carga se ve; un `<script>`
 * ajeno en el `<head>` no.
 *
 * Un embed por project dentro de un sitio multi-doc queda afuera a propósito
 * (v2 futura): hoy el widget es del sitio, uno por deploy.
 */

/** La forma canónica de un UUID: 8-4-4-4-12 hex, con guiones. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const SRC_EMBED = 'https://tuqui.com/embed.js';

/**
 * El array para el campo `scripts` de `docusaurus.config.js`.
 *
 * @param {Record<string, string | undefined>} [env] el entorno a leer (por
 *   defecto `process.env`); se inyecta para poder testear sin ensuciar el
 *   proceso.
 * @returns {Array<{src: string, defer: true, 'data-embed-id': string}>} vacío
 *   si no hay `TUQUI_EMBED_ID`; un solo script si hay.
 * @throws {Error} si `TUQUI_EMBED_ID` está declarada con un valor que no es un
 *   UUID. Deliberadamente ruidoso: rompe el build en vez de emitir el tag.
 */
export function tuquiEmbedScripts(env = process.env) {
  const crudo = env?.TUQUI_EMBED_ID;

  // Ausente, vacía o solo espacios: la variable no está declarada en la
  // práctica (un `TUQUI_EMBED_ID=` en un .env no debería romper un build).
  if (crudo === undefined || crudo === null) return [];
  if (typeof crudo !== 'string') {
    throw new Error(
      `TUQUI_EMBED_ID tiene que ser un string con forma UUID; llegó ${typeof crudo}.`,
    );
  }
  const id = crudo.trim();
  if (id === '') return [];

  if (!UUID.test(id)) {
    throw new Error(
      'TUQUI_EMBED_ID malformada: se espera un UUID ' +
        '(8-4-4-4-12 hexadecimal, con guiones) y llegó ' +
        `${JSON.stringify(crudo)}. El valor se interpola dentro de un tag ` +
        '<script> del HTML público, así que el build aborta en vez de emitirlo. ' +
        'Revisá la variable en el proyecto de Vercel: lo más común es un espacio ' +
        'o una comilla que quedaron del copiar y pegar.',
    );
  }

  return [{ src: SRC_EMBED, defer: true, 'data-embed-id': id }];
}
