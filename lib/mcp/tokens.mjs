/**
 * Parser de `DOCS_MCP_TOKENS` ("tuqui:tok1,claude-code:tok2,codex:tok3").
 *
 * Módulo SIN dependencias de Node a propósito: lo importan la función
 * (`auth.mjs`, que compara con `node:crypto`) y el `middleware.js` del edge
 * (que compara con el `equal()` propio del gate). La GRAMÁTICA vive acá, una
 * sola vez: dos parsers del mismo formato divergen, y cuando divergen el gate
 * del edge y el `withMcpAuth` de la función dejan de estar de acuerdo sobre
 * qué token vale.
 *
 * Devuelve TODOS los pares, duplicados incluidos, en orden: la semántica
 * de "quién es el dueño del token" (recorrer todo, el último match gana,
 * sin cortar antes por timing) es del comparador, no del parser.
 *
 * Cero eje y cero corpus: este archivo es idéntico en los tres repos de
 * origen (oba-docs, odumbo-docs, adhoc-docs) salvo comentarios.
 */
export function paresDeTokens(crudo) {
  const pares = [];
  if (!crudo) return pares;
  for (const par of String(crudo).split(',')) {
    const limpio = par.trim();
    if (!limpio) continue;
    const corte = limpio.indexOf(':');
    if (corte <= 0) continue;
    const nombre = limpio.slice(0, corte).trim();
    const token = limpio.slice(corte + 1).trim();
    if (!nombre || !token) continue;
    pares.push({ nombre, token });
  }
  return pares;
}
