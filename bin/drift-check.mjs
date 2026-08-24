#!/usr/bin/env node
/**
 * CLI del drift-check (`docs-drift-check`). Va en el CI de los repos
 * CONSUMIDORES, no en el del paquete:
 *
 *   - run: npx docs-drift-check
 *   - run: npx docs-drift-check --json >> drift.log   # para agregar el lag
 *
 * Wrapper a propósito: la decisión vive en `lib/drift.mjs` (testeable, con la
 * red inyectable) y acá está lo único que un bin tiene que hacer — parsear
 * argumentos y traducir el resultado a exit code. Exit 1 = hay seguridad del
 * guard o del gate sin adoptar; el resto del rezago se reporta y no bloquea.
 */

import { correrDriftCheck } from '../lib/drift.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    `docs-drift-check — mide el rezago del pin de este repo contra el último tag publicado
de @ingadhoc/docs-platform, y falla si hay [seguridad] del guard o del gate sin adoptar.

  --repo=<dir>   raíz del repo consumidor (default: el cwd)
  --json         una línea JSON con el reporte (pineado, vigente, lagDias,
                 lagDiasHabiles, bumpsDeSeguridad, bloqueantes)

Sin red: exit 0 con warning. GitHub caído no puede volverse un build caído.
`,
  );
  process.exit(0);
}

process.exit(
  await correrDriftCheck({
    repo: arg('repo', process.cwd()),
    json: argv.includes('--json'),
  }),
);
