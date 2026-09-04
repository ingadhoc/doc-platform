# @ingadhoc/docs-platform

La plataforma de la documentación de Adhoc: **un** motor de búsqueda, **un**
núcleo de MCP, **un** gate de acceso y **un** guard de fuga, consumidos
pineados por los repos de contenido (`oba-docs`, `odumbo-docs`, `adhoc-docs`).

Antes de esto, las cuatro piezas vivían forkeadas en los tres repos: el mismo
archivo con tres dialectos, y cada fix propagado a mano — o no propagado. La
medición está en `docs/unificacion/`: `lib/mcp/indice.mjs` tenía **41
diferencias** entre las tres copias, y **17 eran fixes que un repo tenía y los
otros dos no**. El caso más caro: el guard de fuga era byte-idéntico en dos
repos y **no existía en el tercero**.

- **ADR 0006** de `knowledge-management` — un repo por cuerpo de contenido, y la
  plataforma como paquete aparte: el contenido y el motor tienen ciclos de vida
  distintos y dueños distintos.
- **ADR 0007** de `knowledge-management` — el gate y el guard de fuga son de la
  plataforma, no de cada sitio: una protección que cada repo reimplementa es una
  protección que algún repo no tiene.
- Etapa A de la spec `arquitectura-plataforma-docs`: este paquete, con los dos
  contratos versionados y el drift-check que hace visible el rezago del pin.

## Cómo se consume

```bash
npm i --ignore-scripts github:ingadhoc/doc-platform#v0.1.0
```

**Pin exacto, siempre por tag.** No `^`, no `main`, no ramas: el pin es lo que
evita que un fix de la plataforma rompa tres sitios a la vez, y es lo que
permite un rollback de una línea. Un rango hace fallar el `docs-drift-check`
a propósito — un pin que no pinea no es un pin.

**`--ignore-scripts` recomendado.** Este paquete no tiene ningún script de
install y no lo va a tener; el flag es para todo el árbol, porque esto corre en
el `buildCommand` de sitios **públicos**. La misma razón por la que el paquete
tiene **una sola dependencia** (`minisearch`, que la necesita el motor de
búsqueda) y **cero devDependencies**: superficie mínima en el build.

**Lo que el consumidor ya tiene y este paquete no declara:** `mcp-handler` y
`zod`, que importa `lib/mcp/mcp-handler.mjs`. Son dependencias del repo, a
propósito: el repo decide con qué versión del framework MCP se deploya, y el
paquete no le impone una. Los tres repos las tienen hoy.

Después del `npm i`, el repo consumidor queda con tres líneas de pegamento:

```js
// api/mcp.mjs
import { crearMcp } from '@ingadhoc/docs-platform/mcp-handler';
import { crearFeedback } from '@ingadhoc/docs-platform/feedback';
import * as indice from '@ingadhoc/docs-platform/indice';
import { config } from '../docs.mcp.config.mjs';
const { handler } = crearMcp({
  config,
  indice,
  crearIssue: crearFeedback(config.feedback),
});
export default handler; // sin default export Vercel no encuentra el handler
```

```js
// middleware.js — en la RAÍZ del repo (Vercel lo exige ahí)
import { next } from '@vercel/functions';
// Por RUTA RELATIVA, no por especificador de paquete: el bundler del edge
// rechaza `@ingadhoc/docs-platform/gate` cuando el repo consumidor no es
// `"type": "module"` (Docusaurus lo impide) — "unsupported modules".
// Y ojo con renombrar a middleware.mjs: el deploy queda VERDE y SIN
// middleware (la ausencia silenciosa del gate). Hallazgo del piloto
// odumbo-docs, deployment 3mXWLwPHPgcwasEji49pGEg7Lyuv.
import { decidir } from './node_modules/@ingadhoc/docs-platform/lib/mcp/gate.mjs';
const AUDIENCIAS = ['publico', 'interno']; // adhoc-docs: ['interno']
export default function middleware(request) {
  return decidir(request, process.env, { audiencias: AUDIENCIAS }) ?? next();
}
```

```jsonc
// package.json del consumidor — el guard, dentro del buildCommand
"build:publico": "node tools/build.mjs --audience=publico && npm --prefix site run build && npx docs-guard-fuga --salida=dist/publico"
```

El `&&` no es cosmético: es lo que aborta el deploy cuando el guard sale con 1.
No lo cambies por `;`.

## El centinela de producción

`docs-centinela-produccion` responde una sola pregunta: **¿el sitio publicado
está en el commit que dice la rama?** Existe porque un CI verde no significa
publicado — el 04/09/2026 `docs.adhoc.inc` estuvo cinco horas atrás de `main`
con todos los checks en verde y nadie se enteró hasta que alguien preguntó por
qué su PR no se veía publicado.

Va en dos lugares del workflow del consumidor:

```yaml
# 1. Después de deployar: que el dominio haya quedado en ESTE commit.
#    Sin tolerancia — el deploy ya terminó, no hay nada que esperar.
- run: npx docs-centinela-produccion --sha="${{ github.sha }}" --tolerancia=0

# 2. En cada push a main y desde un cron: que producción no se haya quedado
#    atrás. Sin --sha compara contra el HEAD del checkout, y usa la antigüedad
#    de ese commit para no confundir un atraso con un deploy en curso.
- run: npx docs-centinela-produccion
```

El job del punto 2 va **fuera** del `concurrency` del deploy, a propósito: su
trabajo es mirar la cola desde afuera, y colgarlo del mismo lock que se traba
lo dejaría esperando junto con todo lo demás.

Los ids salen de `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` y `VERCEL_TOKEN`, que el
job ya tiene para deployar: no hay una segunda copia que se pueda
desincronizar. Exit **1** = hay que actuar; **2** = no se pudo averiguar (un
500 de Vercel no es producción atrasada, y el workflow del consumidor abre
issue con el 1 y no con el 2).

**También mira algo que no es el atraso:** que el deployment no traiga metas
`githubCommit*`. Vercel las arma resolviendo el autor del commit contra
GitHub, y es ahí donde aplica el bloqueo por seats que originó el incidente —
un deployment `BLOCKED` nunca arranca y `vercel deploy` no vuelve nunca. Si
reaparecen, el próximo merge de alguien de afuera del team traba la cola: el
centinela lo avisa antes, con producción todavía publicada. Se cierran los dos
caminos por los que Vercel resuelve ese autor pasando metas propias
(`-m commitSha=…`, sin el prefijo reservado `github`) y borrando el `.git` del
directorio antes de subirlo.

## Qué exporta

| Import | Qué es |
|---|---|
| `@ingadhoc/docs-platform/indice` | motor de búsqueda: `buscar()`, `leer()`, `mapa()` sobre el índice que emite el build. Es el único que usa `minisearch` |
| `@ingadhoc/docs-platform/mcp-handler` | `crearMcp({config, indice, crearIssue})`: las tools, sus schemas por eje, el Bearer y el transporte |
| `@ingadhoc/docs-platform/gate` | `decidir(request, env, {audiencias})` / `crearGate(config)`: la decisión del middleware del edge |
| `@ingadhoc/docs-platform/auth` | comparación de tokens en tiempo constante (usa `node:crypto`: **solo** del lado de la función) |
| `@ingadhoc/docs-platform/tokens` | la gramática de `DOCS_MCP_TOKENS`, una sola vez, compartida entre el edge y la función |
| `@ingadhoc/docs-platform/feedback` | `crearFeedback(config)`: la tool que abre el issue de `docs-feedback` |
| `@ingadhoc/docs-platform/config` | `cargarConfig()` / `validarConfig()`: el validador del `docs.config.json` |
| `@ingadhoc/docs-platform/guard-fuga` | `correrGuard()`, si querés llamarlo desde tu build en vez del bin |
| `@ingadhoc/docs-platform/middleware` | el `middleware.js` de referencia (el que va en la raíz del consumidor) |
| `@ingadhoc/docs-platform/docusaurus-plugin` | el plugin de Docusaurus: registra los componentes MDX y el CSS del theme (ver *La capa de theme*) |
| `@ingadhoc/docs-platform/busqueda` | `opcionesDelTema()`: la configuración del buscador del sitio, una sola vez para los tres repos (ver *El buscador del sitio*) |
| `@ingadhoc/docs-platform/video-url` | `parsearUrlVideo()` / `idDeYoutube()`: el parseo que decide si una URL rinde embed o botón |
| `@ingadhoc/docs-platform/tuqui-embed` | `tuquiEmbedScripts(env)`: el campo `scripts` que embebe el widget de chat de Tuqui, activado por `TUQUI_EMBED_ID` (ver *Widget de Tuqui*) |
| bin `docs-guard-fuga` | el guard de fuga, para el `buildCommand` |
| bin `docs-drift-check` | el drift-check, para el CI del consumidor |

## El buscador del sitio

El motor de búsqueda es de la plataforma (ADR 0007), pero su configuración
vivía copiada en el `docusaurus.config.js` de cada repo — y una config copiada
diverge igual que el código copiado. Divergió, así que ahora vive en
`lib/busqueda.cjs` y el consumidor la pide entera:

```js
const { opcionesDelTema } = require('@ingadhoc/docs-platform/busqueda');
// themes: [ ['@easyops-cn/docusaurus-search-local', opcionesDelTema()] ]
```

`docsRouteBasePath` es un parámetro con default `['/']`, que es lo que tienen
los tres repos: una instancia de docs montada en la raíz. Sólo hay que pasarlo
si el sitio monta un segundo plugin de docs.

**Sin `searchContextByPaths`, a propósito y para los tres repos.** Partir el
índice por valor del eje suena a "scope por versión", pero ese scope ya lo da
Docusaurus: las versiones que no son la última se emiten como `versioned_docs`
y el plugin escribe un índice por versión, en el subdirectorio de cada una. Los
contextos duplican ese scope, y encima cualquier documento que no caiga en
ninguno queda afuera del índice desde el que se busca. Medido en producción
antes de sacarlo, con la sección que entonces vivía fuera del eje: el índice
del contexto `19` tenía 503 URLs del manual y CERO de `relacion`.

Dos cosas para el que lo lea de nuevo dentro de un año:

- Hasta v0.7.1 esa decisión tenía un control automático: el bin
  `docs-indice-fuera-del-eje` fallaba el build si encontraba el índice partido
  por contexto. Ese bin **se borró en v0.8.0** junto con el contenido fuera del
  eje que lo justificaba, así que hoy la decisión se sostiene sólo en que
  `opcionesDelTema()` es la única fuente de las opciones del tema. Si vuelve
  `searchContextByPaths`, tiene que volver acá.
- El plugin asocia el contenido SIN versionar a la versión última, y eso no se
  arregla con configuración. Un corpus que vuelva a poner contenido fuera del
  eje lo va a tener invisible en el buscador del sitio parado en una versión
  vieja — el MCP no tiene ese problema, porque el comodín del motor es del
  índice y no del artefacto de Docusaurus.

## La capa de theme

Hasta acá el paquete era todo backend: motor de búsqueda, MCP, gate, guard. La
capa de theme es lo que le permite además **poner componentes y estilos en el
sitio de los tres repos** — el mismo argumento del ADR 0007 aplicado al front:
un componente que cada repo reimplementa es un componente que en algún repo
está roto (y hay precedente: los `<video>` del contenido migrado, que
escribían `autoplay` en minúscula y React descartaba en silencio).

Se activa con **una línea** en el `docusaurus.config.js` del consumidor:

```js
// site/docusaurus.config.js
plugins: [
  require.resolve('@ingadhoc/docs-platform/docusaurus-plugin'),
  // … los plugins que el repo ya tenía
],
```

`require.resolve` y no el string pelado: el config vive en `site/` y el paquete
se instala en la raíz del repo. Y el plugin es `.cjs` a propósito — este paquete
es `"type": "module"` y el config de los tres repos es CommonJS.

Con eso el consumidor gana:

- **Los componentes MDX en el scope global**, sin `import` en el markdown. Un
  import arriba de un `.md` no es una opción para este contenido: el cuerpo
  entero de cada artículo viaja al índice para agentes (`emitAgente()`), y esa
  línea le llega al MCP como ruido.
- **El CSS del theme** (`getClientModules`), que entra después de infima y antes
  del `custom.css` de cada repo: la identidad de cada sitio sigue ganando.

### `<Video url title/>`

```markdown
<Video url="https://youtu.be/9YpzkZ8Q5Ns" title="Procesar transferencias en lote"/>
<Video url="https://drive.google.com/file/d/1AbC/view" title="Grabación de la demo"/>
```

| atributo | | |
|---|---|---|
| `url` | requerido | YouTube (`watch?v=`, `youtu.be/`, `/embed/`, `/live/`, `/shorts/`) o cualquier otra URL. Sin URL utilizable el componente no pinta nada |
| `title` | opcional, **recomendado** | es el nombre accesible: `aria-label` del botón y `title` del iframe. Sin él, "Ver video" |

- **YouTube**: en el load se pinta la miniatura real (`img.youtube.com/vi/<id>/hqdefault.jpg`)
  con un botón de play encima, en una caja 16:9, `loading="lazy"` y **cero
  iframes**. Un embed de YouTube trae ~1 MB de JS que se paga aunque nadie mire
  el video. Al click, el `<iframe>` reemplaza la miniatura con `autoplay=1` —
  legítimo porque hubo gesto del usuario, y el video arranca solo.
- **Cualquier otra URL** (Drive, Loom, un `.mp4`): un botón de infima
  (`button button--primary`) que abre la URL en otra pestaña. No se intenta un
  embed: Drive lo rompe cuando el archivo no es público y el modo de falla es
  una caja gris sin explicación.

El parseo de la URL es una función pura y exportada
(`@ingadhoc/docs-platform/video-url`), aparte del componente, para poder
testearlo con `node --test` sin meterle React ni un transpilador al paquete:
`tests/video-url.test.mjs`.

### La escala de títulos del artículo

El CSS del theme sube el h2 a `2.25rem` y el h3 a `1.7rem` (infima da 2 y 1.5),
scopeado a `.theme-doc-markdown.markdown`. **El h1 no se toca**: infima ya le da
3rem al título del artículo — `--ifm-h1-font-size: 2rem` es la del h1 genérico,
no la del título, y "subirlo a 2.5rem" lo habría achicado. El h4 pasa de 1rem a
1.15rem porque a 1rem es exactamente el tamaño del cuerpo. Navbar y sidebar
quedan afuera del scope.

### El badge de país

`paises:` en el frontmatter de un artículo es una **faceta**, no un eje: no
multiplica el build, no bifurca la URL y no oculta bloques (**no existe
`:::solo-pais`**). Lo único que agrega en el sitio son dos marcas:

- **Arriba del h1**, un badge "Solo Argentina" / "Solo Chile y Uruguay"
  (`lib/docusaurus-theme/DocItem/Content.js`, wrapper de
  `@theme-init/DocItem/Content`). Los nombres salen de un mapa AR/CL/UY: el
  manual lo lee un contador, no el build. **Una página sin `paises:` no lleva
  badge**: la ausencia significa "todos los países" y un cartel en el 95% de las
  páginas es ruido.
- **En el árbol**, el código ISO en chico al final de la fila, vía `::after`
  sobre las clases `pais-AR` / `pais-CL` / `pais-UY`. Las estampa el build del
  repo de contenido con `sidebar_class_name` cuando la página tiene **un solo**
  país; el paquete sólo pone el CSS. Con dos países no se estampa nada: la
  sigla no entra y el badge de arriba ya lo dice. Ojo con el selector:
  Docusaurus pone `sidebar_class_name` en el `<li>`, no en el `<a>`, así que el
  `::after` va sobre `.menu__list-item.pais-XX > .menu__link`.

Las páginas de `localizaciones/<país>/` **no llevan badge**: ahí el país lo
deriva el build del path y no está en el frontmatter del fuente, así que el
componente no lo ve — que es lo correcto, la página ya vive bajo
*Localizaciones › Chile*. El país derivado sí viaja al índice del agente, donde
nadie ve la ruta.

El filtro del MCP lo enciende `metadata.paises` del `docs.config.json` (el
vocabulario del corpus, ISO alpha-2 en mayúsculas). Su semántica es dura y
asimétrica a propósito: **el tag excluye, la ausencia nunca oculta**.

### Dos cosas que no se pueden cambiar sin romper los tres sitios

- **La carpeta se llama `lib/docusaurus-theme/`.** El webpack de Docusaurus no
  transpila nada de `node_modules` salvo lo que matchee
  `/docusaurus(?:(?!node_modules).)*\.jsx?$/` (`lib/webpack/base.js`,
  `excludeJS`). Sin la palabra `docusaurus` en la ruta, el JSX llega crudo al
  bundler y el build revienta.
- **Los wrappers del theme (`MDXComponents.js`, `DocItem/Content.js`) envuelven
  con `@theme-init`, no con `@theme-original`.**
  Los dos alias existen; `@theme-original` lo reescribe *cada* theme que se
  registra, así que desde un plugin apunta a sí mismo. El síntoma no dice
  "ciclo": dice `Cannot access '__WEBPACK_DEFAULT_EXPORT__' before initialization`
  y `Cannot read properties of undefined (reading 'jsx')` en cada página.

## Widget de Tuqui

Cualquier sitio de la plataforma puede embeber el **widget de chat de Tuqui** —el
agente que responde sobre la docu— declarando **una** variable de entorno en su
proyecto de Vercel:

```bash
TUQUI_EMBED_ID=<el embed id del agente>
```

**Si está, el widget se agrega; si no está, no existe.** No hay default y no lo
va a haber: prender el chat es una decisión del proyecto de Vercel donde se
setea la variable, no algo que arrastre un `npm run build` local, el build
interno o un fork del repo. Y **quién contesta lo decide el embed id**: el
agente, su corpus y sus permisos se configuran del lado de Tuqui, no acá.

**No hay `data-color`.** El estilo del widget se gobierna del lado de Tuqui, que
es el único lugar donde se cambia sin redeployar tres sitios. Un color por sitio
era el ADR 0007 otra vez —la copia forkeada— y además un data-attribute de un
`<script>` no puede leer la custom property de CSS que pretendía replicar.

**El id se valida contra la forma UUID, y si no matchea el build aborta.** Esto
corre en el `buildCommand` de sitios **públicos** y el valor termina interpolado
dentro de un tag `<script>` de todas las páginas: un id con un espacio, una
comilla o un `"><script` es inyección de markup con la variable de entorno como
vector. Un widget que no carga se ve; un `<script>` ajeno en el `<head>` no. Una
variable ausente, vacía o con solo espacios **no** es un error: es el caso "sin
widget".

### El consumo, en dos líneas

Los `docusaurus.config.js` de los tres sitios son **CJS** (`require` +
`module.exports`: Docusaurus impide que el repo del sitio sea `"type": "module"`).
El paquete es ESM, así que la línea que hay que escribir es un `require` del
subpath — que funciona porque Node resuelve ESM desde `require` (probado en
Node 22; el piso real es Node ≥20.19 / ≥22.12):

```js
// site/docusaurus.config.js
const { tuquiEmbedScripts } = require('@ingadhoc/docs-platform/tuqui-embed');

const config = {
  // ...
  scripts: tuquiEmbedScripts(),
};
```

Dos alternativas, si el sitio corre en un Node más viejo que ese piso:

```js
// por ruta relativa a node_modules — el mismo patrón que middleware.js, y
// funciona en cualquier Node porque no pasa por el resolver de exports
const { tuquiEmbedScripts } = require(
  './node_modules/@ingadhoc/docs-platform/lib/tuqui-embed.mjs',
);
```

…o `await import('@ingadhoc/docs-platform/tuqui-embed')`, que obliga a convertir
la config entera en una función `async` (Docusaurus lo soporta) y es la opción
más invasiva de las tres. Las tres se probaron; la recomendada es la primera.

### Verificar un build

```bash
TUQUI_EMBED_ID=3f2a9c14-8b7e-4d61-9a02-5e6c7d8f1234 npm run build:publico
grep -rlo 'tuqui.com/embed.js' site/build --include='*.html' | wc -l   # con la var: todas las páginas
npm run build:publico
grep -rlo 'tuqui.com/embed.js' site/build --include='*.html' | wc -l   # sin la var: 0
```

### Lo que queda afuera

**Un embed por `project` dentro de un sitio multi-doc** (el caso de
`adhoc-docs`) queda explícitamente fuera de esta versión. Hoy el widget es del
sitio: uno por deploy, el mismo en todas las páginas. Si un corpus necesita un
agente distinto por sección, es una v2 — y probablemente no sea el campo
`scripts` de Docusaurus lo que la resuelva.

## Los dos contratos

Los dos llevan `schemaVersion`, y los dos lectores **tiran** si el emisor
declara una versión más nueva de la que saben leer — o si no la declara. Nada
de degradar en silencio: un índice equivocado que responde mal es peor que uno
que no responde.

1. **config ↔ plataforma**: `docs.config.json`, con schema publicado en
   [`schema/docs.config.schema.json`](./schema/docs.config.schema.json) y
   validador en `lib/config.mjs` (propio, sin dependencias: `ajv` no entra al
   build de un sitio público). El diseño de cada campo, con la evidencia
   medida, está en [`docs/unificacion/diseno-eje.md`](./docs/unificacion/diseno-eje.md);
   los tres configs actuales traducidos, en
   [`mapeo-configs.md`](./docs/unificacion/mapeo-configs.md).
2. **índice ↔ motor**: lo emite `tools/build.mjs` de cada repo y lo lee
   `lib/mcp/indice.mjs`. Está especificado en
   [`docs/unificacion/contrato-indice.md`](./docs/unificacion/contrato-indice.md).

### El eje, en una tabla

El corpus declara **un** eje como objeto: `{ tipo, default?, valores[] }`.

| `eje.tipo` | corpus | param en las tools | `leer()` sin valor | comodín (artículos fuera del eje) |
|---|---|---|---|---|
| `version` | oba-docs | `version` | elige el `default` **y lo dice** (`elegidoPor`) | sí: un artículo con `eje: null` pasa cualquier filtro (hoy ningún corpus emite uno) |
| `project` | adhoc-docs | `project` | ambigüedad estructurada (no declara `default`) | no |
| `none` | odumbo-docs | *(no se expone)* | — | — |

La regla de `leer()` es **una** y no tiene un `if` por tipo de eje: elige sólo
cuando el config declaró a quién elegir. Lo que cambia el comportamiento es la
presencia de `eje.default`, no el tipo — y hay un test que lo prueba poniéndole
un `default` a un corpus con eje `project`.

## Correr los tests

```bash
npm install && npm test        # 391 casos
```

`bloques` necesita un repo de contenido (corre su `tools/build.mjs` de verdad
sobre los fixtures de incidentes) y se **skipea con motivo** si no hay:

```bash
DOCS_REPO=~/repositorios/oba-docs node --test tests/bloques.test.mjs
```

La franja del handler HTTP de `mcp.test.mjs` (18 casos) también se skipea con
motivo si el checkout no tiene `mcp-handler`/`zod`, que son dependencias del
consumidor y no de este paquete. Con las dos instaladas, `mcp` da 59; sin
ellas, `npm test` da 373.
Un caso sin su capability se skipea explícitamente; no se corre degradado.

---

## Para jjs — decisiones abiertas

Lo que este ensamble **no** resuelve solo. Los tres primeros son de
`diseno-eje.md §7` y comprometen el contrato; los demás salieron de los cuatro
análisis y siguen vivos después de unificar.

### 1. Un solo eje por corpus: ¿se acepta el techo?

`schemaVersion: 1` admite **un** eje por config, y hoy alcanza para los tres
repos. El día que un corpus necesite `project × version` a la vez, el schema no
lo expresa y la salida es un `schemaVersion: 2` con `ejes: [...]` (plural).
*Recomendación del diseño:* aceptar el techo explícitamente y que la necesidad
real lo reabra con evidencia (mismo criterio que la alarma de bumps de la
Etapa B). Es tu llamada porque compromete el major.

### 2. `metadata.types`: ¿vocabulario por corpus o único de Adhoc?

Hoy sólo `adhoc-docs` tiene `types`, y sus 6 valores se parecen mucho a un
estándar de `knowledge-management` (`concepto`, `referencia`, `procedimiento`,
`troubleshooting`, `guia`, `indice`). Si el vocabulario es de Adhoc, no va en el
config de cada repo: va en el paquete, y el config sólo dice si lo exige. Es una
decisión de gobernanza de contenido, no de schema; mientras no se lauda, el
schema lo deja como lista por corpus (compatible con las dos salidas).

### 3. El opt-out del guard de fuga en `adhoc-docs`: ¿lo firmás?

El schema **obliga** a declarar `deploy.guardDeFuga`, así que la omisión
silenciosa ya no es posible. Quedan las dos salidas, las dos defendibles:
`{"activo": false, "motivo": "…"}` (ese repo no tiene build público: su gate es
incondicional, y el guard protege contra la fuga *al build público*), o entra el
guard igual, como cinturón. El `motivo` que hoy está en `mapeo-configs.md` dice
literal **"PENDIENTE DE FIRMA (jjs)"**.

Y hay una parte técnica que no se arregla copiando el archivo (DUDA 1 de
`analisis-04-seguridad.md`): `adhoc-docs` no tiene bloques `:::interno`, no
emite `site/generated.json` con audiencia y no tiene mapa `deploy.proyectos`.
Con el guard activo tal cual, su build falla de arranque por "no existe
site/generated.json". La estricta es que emita esas dos cosas.

### 4. La lista de audiencias sigue duplicada, y el drift-check todavía no la compara

`docs.config.json → audiences` y `middleware.js → AUDIENCIAS` tienen que
coincidir, y no hay forma de evitar la duplicación: el edge no lee del
filesystem. Es exactamente el tipo de drift silencioso donde empezó el fork.
Falta un caso del CI que las compare (el `docs-drift-check` de hoy mide el pin,
no esa coherencia).

### 5. Tres cosas que hay que mirar en los repos antes de taggear

- **`DOCS_AUDIENCE` en los tres environments de cada proyecto de Vercel**
  (Production, Preview y Development) **antes** del merge que adopta el
  paquete. Con el fail-closed, un proyecto sin la variable devuelve 503. Es la
  dirección segura, pero no es gratis.
- **`--esperada` en los `buildCommand` actuales**: ahora el guard lo *rechaza*
  corriendo en Vercel. Si algún buildCommand lo pasa hoy, ese deploy empieza a
  fallar. No se pudo verificar desde los snapshots.
- **El GET del MCP devuelve 503** si el deployment no declara audiencia
  servible. Es un cambio observable para el consumidor: el preflight de Claude
  Code recibe 503 en vez del cartel cuando el deployment está mal configurado.

### 6. Deuda medida que este paquete no puede cerrar

- **El fail-closed del preprocesador emite y después falla.** Con una directiva
  mal escrita (`::: interno`), `build.mjs` escribe `site/docs/**` con la línea
  interna adentro y *después* sale con 1. Hoy no fuga porque el `buildCommand`
  encadena con `&&`: la protección está en el operador, no en el programa. Está
  como `todo` declarado en `tests/bloques.test.mjs`, y lo arregla la
  unificación de `build.mjs` — que **no** entró en esta etapa.
- **`tests/bloques.test.mjs` escribe en `<repo>/site/`** porque en oba y odumbo
  la salida del build está hardcodeada. Después de correr la suite hay que
  regenerar con `npm run gen`.
- **Límites del enfoque léxico del guard**: números y strings de menos de 5
  caracteres nunca tienen sonda (una clave `4821`, una sigla), las imágenes no
  se escanean, y una fuga dentro de `applyBlocks` no genera sonda. Está en el
  header del guard; lo repito acá porque es la parte que se puede confundir con
  cobertura.
- **`serverInfo.version` sigue hardcodeada en `'1.0.0'`** en el handler.
  Debería salir del `package.json` del paquete pineado, así un cliente MCP
  puede reportar contra qué versión de la plataforma habló. No se cambió: sería
  inventar comportamiento.
- **El comodín es propiedad del `tipo` de eje, no del corpus.** Un corpus con
  eje `project` no puede tener un documento transversal (`eje: null` queda
  invisible a cualquier filtro). Si algún día hace falta, la salida estricta es
  que el contrato del índice lo **prohíba** mientras el comodín esté apagado,
  para que la contradicción falle en el build y no en runtime.
- **La spec dice "vitest"** como convención de tests de la Etapa A, y ninguno de
  los tres repos usa vitest: la convención real —y la de este paquete— es
  `node:test` nativo. Vale corregir esa línea antes de que alguien instale
  vitest para cumplirla.
