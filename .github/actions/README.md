# prebuilt-build, prebuilt-deploy y centinela

Construyen el sitio en el runner de GitHub Actions con `vercel build` y lo
suben con `vercel deploy --prebuilt`. Vercel no vuelve a construir: no hay cola
de build del team y el build no se paga dos veces.

Van en **dos jobs**. El que corre código del repo no tiene el token de Vercel,
y el que tiene el token no corre código del repo:

```yaml
# Un solo literal para el proyecto: el build (y el guard adentro) y el deploy
# usan el mismo, así el guard queda atado al proyecto real del deploy.
env:
  PROYECTO_VERCEL: prj_…

jobs:
  build:
    permissions: { contents: read }
    outputs:
      artifact-id: ${{ steps.build.outputs.artifact-id }}
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci --ignore-scripts
      # … lint y tests del repo …
      - uses: ingadhoc/doc-platform/.github/actions/prebuilt-build@vX.Y.Z
        id: build
        with:
          project-id: ${{ env.PROYECTO_VERCEL }}
          target: preview            # o production
          node-version: 24.x         # la del proyecto en Vercel
          env: |
            DOCS_AUDIENCE=publico
          verificar: node scripts/verificar.mjs --salida=.vercel/output/static

  deploy:
    needs: build
    permissions: { contents: read, pull-requests: write, actions: write }
    # Obligatorio: el deploy saltea un commit que ya no es el HEAD, y eso solo
    # es correcto si los deploys de producción van de a uno.
    concurrency:
      group: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.number) || 'produccion' }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
    steps:
      - uses: ingadhoc/doc-platform/.github/actions/prebuilt-deploy@<sha> # vX.Y.Z
        with:
          artifact-id: ${{ needs.build.outputs.artifact-id }}
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          project-id: ${{ env.PROYECTO_VERCEL }}
          target: preview            # el mismo del build
          commit-sha: ${{ github.event.pull_request.head.sha || github.sha }}
          commit-ref: ${{ github.head_ref || github.ref_name }}
          pr-id: ${{ github.event.pull_request.number }}
```

Con más de un proyecto (por ejemplo público e interno), una matriz
`{proyecto, audiencia}` única, que usan el job `build` y el job `deploy`: el
proyecto y la audiencia salen de la misma fila en los dos.

En los jobs con token, la action va fijada por SHA (`@<sha> # vX.Y.Z`), no por
tag: ese código corre con el token del team y un tag se puede mover.

Para relanzar una corrida, **re-run all jobs**. «Re-run failed jobs» relanza
solo `deploy`, y falla porque el artifact del build ya se borró.

## Modelo de amenaza

- **Protege** el token de Vercel del código del repo y de sus dependencias: en
  un mismo job, el build puede envenenar los pasos siguientes (`GITHUB_ENV`,
  `GITHUB_PATH`, el cache de npx, un proceso vivo). El límite es la VM nueva
  de cada job.
- **Protege** el proyecto destino: sale de un literal del workflow en el job
  `deploy`, nunca de un output del build.
- **Protege** la salida en tránsito: el artifact se baja por id y con el digest
  verificado, sin symlinks ni rutas fuera de `output/`.
- **No protege** el contenido que se publica: lo produce el build, que corre
  código del repo. Lo cuidan el guard de fuga y los chequeos, como antes.
- **No protege** la función en runtime: corre en Vercel con las variables del
  proyecto, igual que antes.

## prebuilt-build

| Input | Por defecto | |
|---|---|---|
| `project-id` | — | proyecto de Vercel |
| `org-id` | `team_rjcdQb3W3oISVDmQtFDjY6zH` | team de Vercel |
| `target` | — | `preview` o `production` |
| `node-version` | — | `nodeVersion` del proyecto (fija el runtime de las funciones) |
| `env` | vacío | variables NO sensibles del build, `CLAVE=valor` por línea |
| `verificar` | vacío | chequeo sobre `.vercel/output/static`, antes de empaquetar |
| `artifact-name` | `salida-vercel` | |

Output: `artifact-id`.

1. Escribe `.vercel/project.json` y `.vercel/.env.<target>.local` desde los
   inputs, sin `vercel pull` ni token. Agrega `VERCEL=1`, `VERCEL_ENV` y
   `VERCEL_TARGET_ENV`.
2. `vercel build --standalone` (`--prod` en production), con
   `VERCEL_PROJECT_ID` del input. El guard de fuga corre en el
   `buildCommand` y cruza `DOCS_AUDIENCE` contra la audiencia que
   `docs.config.json` asigna a ese proyecto. `--standalone` copia a la salida
   los archivos de las funciones, `includeFiles` incluido.
3. Corre `verificar`.
4. Falla si hay symlinks en `.vercel/output`, la empaqueta en un tar y la sube
   como artifact de un día.

Si se agrega una variable de build en el proyecto de Vercel, va también a
`env`. Una sensible no va nunca al build: la función la recibe en runtime.

## prebuilt-deploy

| Input | Por defecto | |
|---|---|---|
| `artifact-id` | — | el output de `prebuilt-build` |
| `vercel-token` | — | token de Vercel |
| `project-id` | — | literal del workflow |
| `org-id` | `team_rjcdQb3W3oISVDmQtFDjY6zH` | team de Vercel |
| `target` | — | el mismo del build |
| `commit-sha`, `commit-ref` | — | van como metas `commitSha` y `commitRef` |
| `pr-id` | vacío | meta `prId` y comentario en el PR |
| `comentario` | `**Preview:** {url}` | texto del comentario |
| `github-token` | `github.token` | HEAD de main, comentario, borrar el artifact |

Output: `url`.

1. Valida los inputs. En production, si el commit ya no es el HEAD de `main`,
   avisa y sale en verde: publica el run más nuevo.
2. Baja el artifact por id (`actions/download-artifact`, digest verificado),
   rechaza symlinks y rutas fuera de `output/`, y escribe
   `.vercel/project.json` desde los inputs.
3. Instala el CLI de Vercel de `cli/package-lock.json`, en `$RUNNER_TEMP`, con
   `--ignore-scripts` y cache propio.
4. `vercel deploy --prebuilt --archive=tgz` con las metas, el token por
   entorno y sin `.git`.
5. Comenta la URL en el PR, o en production corre el centinela con tolerancia
   0. Siempre borra el artifact.

`tests/actions.test.mjs` falla si esta action o `centinela` vuelven a usar
`npx`, `npm ci`, `cache:`, `actions/checkout` o una action sin SHA.

## centinela

¿Producción está en el HEAD de la rama? Corre `bin/centinela-produccion.mjs`
desde la action, sin checkout ni npm. Inputs: `vercel-token`, `project-id`,
`org-id`, `rama` (`main`), `tolerancia` y `fallar` (`'false'` solo emite
`codigo` y `reporte`, para un workflow que abre issues).

## Lo que no se puede cambiar

- **Las metas sin prefijo `github` y el deploy sin `.git`.** Vercel bloquea el
  deployment cuando el autor del commit no tiene seat en el team, y resuelve
  ese autor por el `.git` del directorio y por las metas `githubCommit*`. El
  centinela falla si esas metas reaparecen.
- **El job de build necesita memoria.** Docusaurus pide
  `NODE_OPTIONS=--max-old-space-size=6144` en el entorno del job.
- **El token puede pasar a un environment.** El job `deploy` es el único que lo
  usa: con un `environment:` y el secret ahí, el resto del workflow no lo ve.
