#!/usr/bin/env node
/**
 * CLI del centinela de producción (`docs-centinela-produccion`). Va en el CI
 * de los repos CONSUMIDORES, en dos lugares:
 *
 *   # 1. Después de deployar: que el dominio haya quedado en ESTE commit.
 *   - run: npx docs-centinela-produccion --sha="${{ github.sha }}" --tolerancia=0
 *
 *   # 2. En un cron y en cada push a main: que producción no se haya quedado
 *   #    atrás. Sin --sha, el commit esperado es el HEAD del checkout.
 *   - run: npx docs-centinela-produccion
 *
 * Wrapper a propósito: la decisión vive en `lib/centinela-produccion.mjs`
 * (testeable, con la red inyectable) y acá está lo único que un bin tiene que
 * hacer — resolver los parámetros y traducir el resultado a exit code.
 *
 * Los ids de Vercel salen del entorno que el job ya tiene para deployar
 * (`VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_TOKEN`), así que no hay una
 * segunda copia de esos ids que se pueda desincronizar del deploy.
 *
 * Exit 1 = hay que actuar (producción atrasada, o el bloqueo por seats
 * rearmado). Exit 2 = no se pudo averiguar; el workflow lo deja rojo pero no
 * abre issue, porque un 500 de Vercel no es un problema de producción.
 */

import { execFileSync } from 'node:child_process';

import { correrCentinela, NO_SE_PUDO, TOLERANCIA_MIN } from '../lib/centinela-produccion.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    `docs-centinela-produccion — ¿el sitio publicado está en el commit que dice la rama?

  --sha=<commit>      commit esperado (default: el HEAD del repo)
  --tolerancia=<min>  cuánto puede tardar un deploy antes de que sea atraso
                      (default: ${TOLERANCIA_MIN}; usar 0 después de deployar)
  --proyecto=<id>     projectId de Vercel   (default: $VERCEL_PROJECT_ID)
  --team=<id>         teamId de Vercel      (default: $VERCEL_ORG_ID)
  --etiqueta=<texto>  cómo nombrar el sitio en la salida
  --repo=<dir>        raíz del repo consumidor (default: el cwd)

El token sale de $VERCEL_TOKEN. Exit 1 = hay que actuar; 2 = no se pudo averiguar.
`,
  );
  process.exit(0);
}

const repo = arg('repo', process.cwd());
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

let esperado = arg('sha', null);
let edadMin = 0;

// Sin `--sha` el commit esperado es el HEAD del checkout, y su antigüedad es la
// que decide si esto es un atraso o un deploy todavía en curso. Un `git` que no
// contesta (el job que deploya borra `.git` antes de subir) es "no se pudo
// averiguar", no "al día".
if (!esperado) {
  try {
    esperado = git('rev-parse', 'HEAD');
    edadMin = (Date.now() - Number(git('log', '-1', '--format=%ct')) * 1000) / 60_000;
  } catch (e) {
    console.error(`? No hay --sha y tampoco se pudo leer el HEAD de ${repo} (${e.message}).`);
    process.exit(NO_SE_PUDO);
  }
}

process.exit(
  await correrCentinela({
    proyecto: arg('proyecto', process.env.VERCEL_PROJECT_ID),
    team: arg('team', process.env.VERCEL_ORG_ID),
    token: process.env.VERCEL_TOKEN,
    esperado,
    edadMin,
    toleranciaMin: Number(arg('tolerancia', TOLERANCIA_MIN)),
    etiqueta: arg('etiqueta', 'producción'),
  }),
);
