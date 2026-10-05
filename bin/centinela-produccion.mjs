#!/usr/bin/env node
/**
 * CLI del centinela de producción (`docs-centinela-produccion`). Los repos
 * consumidores no lo corren con `npx`: lo corren las actions `prebuilt-deploy`
 * (después de deployar, `--sha=<commit> --tolerancia=0`) y `centinela` (en un
 * cron y en cada push a main, `--sha=<HEAD> --desde=<fecha>`), con `node` y
 * sin checkout, para que el token no corra junto al código del repo.
 *
 * Wrapper a propósito: la decisión vive en `lib/centinela-produccion.mjs`
 * (testeable, con la red inyectable) y acá está lo único que un bin tiene que
 * hacer — resolver los parámetros y traducir el resultado a exit code.
 *
 * El proyecto y el team llegan por `--proyecto` y `--team` (o por
 * `VERCEL_PROJECT_ID` y `VERCEL_ORG_ID`); el token, por `VERCEL_TOKEN`.
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
  --desde=<fecha>     fecha ISO del commit esperado, para medir su antigüedad
                      sin repo (con --sha; sin esto, la antigüedad es 0)
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

const desde = arg('desde', null);
if (desde) {
  const ms = Date.parse(desde);
  if (!esperado || Number.isNaN(ms)) {
    console.error(`? --desde necesita --sha y una fecha válida (llegó "${desde}").`);
    process.exit(NO_SE_PUDO);
  }
  edadMin = (Date.now() - ms) / 60_000;
}

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
