#!/usr/bin/env node
/**
 * CLI del post-proceso del índice (`docs-indice-fuera-del-eje`). Corre DENTRO
 * del buildCommand del repo consumidor, después del build del sitio y antes
 * del guard de fuga:
 *
 *   npm --prefix site run build \
 *     && npx docs-indice-fuera-del-eje --salida=site/build \
 *     && npx docs-guard-fuga --salida=site/build
 *
 * Wrapper a propósito, como `docs-guard-fuga`: la lógica vive en
 * `lib/indice-fuera-del-eje.mjs` (testeable, sin `process.exit`) y acá está lo
 * único que un bin tiene que hacer — pasar `argv`/`cwd` e imprimir.
 *
 * Exit 1 = el deploy se bloquea, y se bloquea sólo si el artefacto no es el que
 * este paso sabe leer (índice partido por contexto, formato del plugin
 * cambiado, sección fuera del eje que dejó de emitirse). El `&&` del
 * buildCommand es lo que lo aborta: NO lo cambies por `;`.
 */

import { correrIndiceFueraDelEje } from '../lib/indice-fuera-del-eje.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    `docs-indice-fuera-del-eje — mete el contenido fuera del eje en el índice de
búsqueda de TODOS los valores del eje.

Docusaurus emite un índice por versión y asocia el contenido sin versionar a la
versión última: parado en una versión vieja, la sección fuera del eje
(\`relacion\`) no existe para el buscador. Esto lo corrige sobre el artefacto ya
construido. Es no-op sin eje \`version\`, con un solo valor, o sin
\`secciones.fueraDelEje\`.

  --salida=<dir>      artefacto del sitio a corregir    (site/build)
  --config=<archivo>  contrato de la plataforma         (docs.config.json)
  --site=<dir>        subdir del sitio, para encontrar
                      el plugin del buscador            (site)
`,
  );
  process.exit(0);
}

const { code, lineas } = correrIndiceFueraDelEje({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
});

console.log('índice fuera del eje');
for (const linea of lineas) console.log(`  ${linea}`);

process.exit(code);
