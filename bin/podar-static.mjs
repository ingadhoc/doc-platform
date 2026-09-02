#!/usr/bin/env node
/**
 * CLI de la poda de `static/` (`docs-podar-static`). Corre DENTRO del
 * buildCommand del repo consumidor, después del build y ANTES del guard:
 *
 *   … && npx docs-podar-static --salida=site/build && npx docs-guard-fuga …
 *
 * Wrapper a propósito, igual que `docs-guard-fuga`: la lógica vive en
 * `lib/podar-static.mjs` (testeable, sin `process.exit`) y acá está lo único
 * que un bin tiene que hacer.
 *
 * EXIT CODE: 0 salvo que la salida no exista. Podar de más o de menos NO es un
 * error del build —el objetivo es que el sitio deje de publicar archivos que
 * nadie muestra, no bloquear un deploy—, así que el resultado se REPORTA y se
 * sigue. Lo que bloquea sigue siendo el guard, que corre después.
 */

import { podarStatic } from '../lib/podar-static.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    `docs-podar-static — saca del build los archivos de static/ que ninguna página referencia.

  --salida=<dir>     artefacto del sitio a podar          (site/build)
  --subdirs=<dirs>   subdirectorios a podar, coma          (img)
  --extra=<dirs>     dirs FUERA de la salida que también
                     referencian, coma                    (api/_generated)
  --dry-run          lista lo que borraría, sin borrarlo

Por qué existe: Docusaurus copia static/ entero a la salida ADEMÁS de emitir
las imágenes procesadas en assets/images/. Esa copia cruda se publica exista o
no una página que la muestre, así que una captura que solo se referencia desde
un bloque :::interno termina en el artefacto público igual.

Ojo con --extra: si el índice del MCP vive fuera de la salida (api/_generated),
pasalo acá o sus imágenes se podan. --salida no sirve para eso: es la raíz de
lo que se poda, no solo de lo que se escanea.
`,
  );
  process.exit(0);
}

const valor = (n, def) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : def;
};

const lista = (n, def) => valor(n, def).split(',').map((s) => s.trim()).filter(Boolean);

const salida = valor('salida', 'site/build');
const subdirs = lista('subdirs', 'img');
const extra = lista('extra', '');
const dryRun = args.includes('--dry-run');

const r = podarStatic({ salida, subdirs, extra, dryRun });

if (r.error) {
  console.error(`✗ poda de static: ${r.error}`);
  process.exit(1);
}

const mb = (r.bytes / 1048576).toFixed(1);
const verbo = dryRun ? 'borraría' : 'borrados';
console.log(
  `  ✓ poda de static (${subdirs.join(', ')}): ${r.candidatos} archivo(s), ` +
    `${r.referenciados} referenciado(s), ${r.podados.length} ${verbo} (${mb} MB)`,
);
if (dryRun) for (const p of r.podados) console.log(`      ${p}`);
// Los ambiguos se conservan, pero se nombran: son el único caso donde el bin no
// puede decidir, y taparlos sería dejar una fuga sin dueño.
if (r.ambiguos.length) {
  console.log(`  ! ${r.ambiguos.length} archivo(s) con nombre repetido y referencia sin ruta: se conservan`);
  for (const p of r.ambiguos.slice(0, 10)) console.log(`      ${p}`);
}

process.exit(0);
