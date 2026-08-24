/**
 * Tokens estáticos por consumidor para el MCP con auth.
 *
 * Formato de `DOCS_MCP_TOKENS`: "tuqui:tok1,claude-code:tok2,codex:tok3".
 * Un token por consumidor, revocable por separado, mapeado a `clientId` —
 * que es lo único que tenemos de trazabilidad hasta que Odoo sea
 * authorization server OIDC (task 72391). Identidad por usuario no hay en
 * ningún consumidor: el connector de Tuqui usa `static_api_key` a nivel
 * workspace.
 *
 * OJO: este módulo usa `node:crypto` y por lo tanto SOLO sirve del lado de
 * la función (runtime Node). El `middleware.js` corre en el edge, donde
 * `timingSafeEqual` no existe, y compara con el `equal()` propio del gate —
 * pero el PARSER es compartido (`tokens.mjs`, sin crypto): la gramática de la
 * variable vive una sola vez.
 *
 * Cero eje y cero corpus: idéntico en los tres repos de origen.
 */

import { timingSafeEqual } from 'node:crypto';

import { paresDeTokens } from './tokens.mjs';

/** "nombre:token,nombre:token" → array [{nombre, token}]. Tolera espacios y vacíos. */
export function parsearTokens(crudo) {
  return paresDeTokens(crudo);
}

/**
 * Comparación en tiempo constante. `timingSafeEqual` TIRA si los buffers
 * tienen distinta longitud, así que ante largos distintos recorremos algo del
 * mismo tamaño y devolvemos false, en vez de cortar antes por timing.
 * (El comentario de oba-docs decía "hasheamos primero / dos digests de 32
 * bytes": describía un código que no es este. La corrección viene de
 * adhoc-docs.)
 */
export function igual(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) {
    const relleno = Buffer.alloc(Math.max(A.length, B.length));
    timingSafeEqual(relleno, relleno);
    return false;
  }
  return timingSafeEqual(A, B);
}

/**
 * Devuelve el nombre del consumidor dueño del token, o null.
 * Recorre TODAS las entradas (sin cortar en el primer match) para no filtrar
 * por timing en qué posición de la lista está el token válido.
 */
export function consumidorDe(tokens, candidato) {
  if (!candidato) return null;
  let encontrado = null;
  for (const { nombre, token } of tokens) {
    if (igual(token, candidato)) encontrado = nombre;
  }
  return encontrado;
}
