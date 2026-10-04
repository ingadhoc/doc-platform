# deploy-prebuilt

Construye el sitio en el runner de GitHub Actions con `vercel build` y lo sube
con `vercel deploy --prebuilt`. Vercel no vuelve a construir: no hay cola de
build del team y el build no se paga dos veces.

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: '22', cache: npm }
- uses: ingadhoc/doc-platform/.github/actions/deploy-prebuilt@vX.Y.Z
  id: deploy
  with:
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    project-id: prj_…
    target: preview            # o production
    commit-sha: ${{ github.event.pull_request.head.sha || github.sha }}
    commit-ref: ${{ github.head_ref || github.ref_name }}
    pr-id: ${{ github.event.pull_request.number }}
- run: echo "${{ steps.deploy.outputs.url }}"
```

| Input | Por defecto | |
|---|---|---|
| `vercel-token` | — | token del team |
| `project-id` | — | proyecto de Vercel |
| `org-id` | `team_rjcdQb3W3oISVDmQtFDjY6zH` | team de Vercel |
| `target` | — | `preview` o `production` |
| `skip-domain` | `false` | con `production`, deploya sin mover el dominio |
| `commit-sha`, `commit-ref` | — | van como metas `commitSha` y `commitRef` |
| `pr-id` | vacío | va como meta `prId` si viene |

Output: `url`, la URL del deployment.

## Qué hace, en orden

1. Exporta `VERCEL_PROJECT_ID` y `VERCEL_ORG_ID` al entorno del job, una sola
   vez: el guard de fuga los necesita en el build. El token **no** se exporta:
   lo reciben por `--token` solo `vercel pull` y `vercel deploy`.
2. `vercel pull --environment=<target>`: baja la configuración y las variables
   del proyecto. Las sensibles bajan como `[SENSITIVE]`: el build no las usa y
   el deployment las recibe en runtime.
3. `vercel build` (`--prod` si el target es `production`), sin token y con
   `VERCEL_TOKEN` fuera del entorno: el `installCommand` y el `buildCommand`
   corren código de terceros (scripts de npm, Docusaurus). Corre el
   `buildCommand` del `vercel.json`, y con él el guard de fuga, que resuelve la
   audiencia por `VERCEL_PROJECT_ID`. Si el guard falla, no hay deploy.
4. `rm -rf .git` y `vercel deploy --prebuilt` con las metas.

## Lo que no se puede cambiar

- **El proyecto del deploy es el del build.** `deploy --prebuilt` no valida
  para qué proyecto se construyó la salida, y el guard corrió contra el
  proyecto del build. Por eso el proyecto se fija una vez y cada paso verifica
  que siga siendo el mismo, también en `.vercel/project.json`. Si el job
  define otro `VERCEL_PROJECT_ID`, la action falla.
- **El `rm -rf .git` y las metas sin prefijo `github`.** Vercel bloquea el
  deployment cuando el autor del commit no tiene seat en el team, y resuelve
  ese autor por el `.git` del directorio y por las metas `githubCommit*`. El
  centinela de producción falla si esas metas reaparecen. Después de la action
  el checkout ya no tiene `.git`: los pasos que siguen y usan `gh` necesitan
  `--repo`.
- **El token no llega al build ni a los pasos que siguen.** Un paso posterior
  del job que necesite el token (por ejemplo, el centinela) lo declara en su
  propio `env:`.
- **El job necesita memoria.** El build de Docusaurus pide
  `NODE_OPTIONS=--max-old-space-size=6144` en el entorno del job.

## Producción en dos pasos

Con `target: production` y `skip-domain: true`, el deployment queda armado sin
dominio. El job que corre después de los checks lo publica con
`npx --yes vercel@59 promote <url> --yes --token=…`, y el centinela lee el
deployment que sirve el dominio (`targets.production` del proyecto), no el
último deployment de producción.
