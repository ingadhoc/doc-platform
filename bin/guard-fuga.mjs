#!/usr/bin/env node
/**
 * CLI del guard de fuga (`docs-guard-fuga`). Corre DENTRO del buildCommand del
 * repo consumidor, después del build:
 *
 *   npm run build:publico && npx docs-guard-fuga --salida=dist/publico
 *
 * Es un wrapper a propósito: la lógica vive en `lib/guard-fuga.mjs` (testeable,
 * sin `process.exit`) y acá está lo único que un bin tiene que hacer — pasar
 * `argv`/`cwd`/`env` y traducir el resultado a exit code. Que el guard sea un
 * bin del paquete es lo que hace que entre a un repo sin copiar un script:
 * `npm i` y una línea en el buildCommand.
 *
 * Exit 1 = el deploy se bloquea. El `&&` del buildCommand es lo que lo aborta,
 * así que NO lo cambies por `;`.
 */

import { correrGuard } from '../lib/guard-fuga.mjs';

const ayuda = process.argv.includes('--help') || process.argv.includes('-h');
if (ayuda) {
  console.log(
    `docs-guard-fuga — falla el build si el artefacto público contiene contenido interno.

  --esperada=<audiencia>  audiencia esperada. Sólo FUERA de Vercel: dentro sale
                          del mapa deploy.proyectos de docs.config.json.
  --salida=<dir>          artefacto del sitio a escanear   (site/build)
  --generated=<archivo>   audiencia declarada por el build (site/generated.json)
  --manifiesto=<archivo>  manifiesto de sondas             (.guard/removido.json)
  --extra=<dirs>          dirs extra a escanear, coma      (api/_generated)
  --indice=<archivo>      índice del MCP                   (api/_generated/index.json)
  --config=<archivo>      contrato de la plataforma        (docs.config.json)
  --contenido=<nombre>    árbol fuente que el manifiesto
                          tiene que declarar              (content)
`,
  );
  process.exit(0);
}

process.exit(
  correrGuard({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
  }),
);
