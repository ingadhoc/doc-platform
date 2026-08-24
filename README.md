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
| bin `docs-guard-fuga` | el guard de fuga, para el `buildCommand` |
| bin `docs-drift-check` | el drift-check, para el CI del consumidor |

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
| `version` | oba-docs | `version` | elige el `default` **y lo dice** (`elegidoPor`) | sí (`relacion/` aplica a todas) |
| `project` | adhoc-docs | `project` | ambigüedad estructurada (no declara `default`) | no |
| `none` | odumbo-docs | *(no se expone)* | — | — |

La regla de `leer()` es **una** y no tiene un `if` por tipo de eje: elige sólo
cuando el config declaró a quién elegir. Lo que cambia el comportamiento es la
presencia de `eje.default`, no el tipo — y hay un test que lo prueba poniéndole
un `default` a un corpus con eje `project`.

## Correr los tests

```bash
npm install && npm test        # 227 casos
```

`bloques` necesita un repo de contenido (corre su `tools/build.mjs` de verdad
sobre los fixtures de incidentes) y se **skipea con motivo** si no hay:

```bash
DOCS_REPO=~/repositorios/oba-docs node --test tests/bloques.test.mjs
```

La franja del handler HTTP de `mcp.test.mjs` (16 casos) también se skipea con
motivo si el checkout no tiene `mcp-handler`/`zod`, que son dependencias del
consumidor y no de este paquete. Con las dos instaladas, `mcp` da 57.
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
