# Fixtures de seguridad

Cada archivo es una forma de escribir contenido interno que EN SU MOMENTO SE
PUBLICÓ por un bug del preprocesador. Son la memoria de los incidentes; no se
borran ni se "limpian".

| fixture | qué protege |
|---|---|
| `manual/variantes.md` | `::::interno` (cuatro puntos, anidado válido en Docusaurus — con el patrón viejo `:::` exacto no matcheaba y el bloque se publicaba entero) y `:::interno` con un code fence adentro (un `:::` dentro del fence cerraba el bloque antes de tiempo y publicaba el resto). Son **las dos formas de escribir la directiva**, más el contenido que venía después del fence. |
| `manual/archivo-entero.md` | `audience: interno` en el frontmatter: el archivo entero se excluye, y sus líneas van igual al manifiesto de sondas. |
| `manual/crlf.md.tpl` | finales de línea CRLF. El test lo materializa como `crlf.md` **convirtiendo a `\r\n` en runtime** y verifica los bytes antes de buildear: así el fixture no depende de que git no le normalice los finales de línea (en `odumbo-docs` esto necesitaba una línea de `.gitattributes` porque un script lo reescribió en modo texto y lo rompió). |
| `manual/substring.md` | el **falso positivo del guard**: el trigrama interno `dias corridos si` es substring del público `dias corridos sin rechazo`. Sin límites de palabra, el guard bloqueaba un deploy limpio. |

Los centinelas (`zanahoria*`) viven SOLO dentro de contenido interno: si uno
aparece en el build público, hay fuga.

El frontmatter NO declara `versions:`: el test lo inyecta según el
`docs.config.json` del repo consumidor (eje versión en oba-docs, eje plano en
odumbo-docs).
