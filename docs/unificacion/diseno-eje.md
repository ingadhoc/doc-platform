# El eje unificado — diseño

Etapa A de la spec `arquitectura-plataforma-docs`, mitigación
"`schemaVersion` en los DOS contratos" (spec:76-78). Este documento decide el
**vocabulario de ejes** del `docs.config.json` unificado. El schema está en
[`docs.config.schema.json`](./docs.config.schema.json), la traducción de los
tres configs actuales en [`mapeo-configs.md`](./mapeo-configs.md), y el segundo
contrato en [`contrato-indice.md`](./contrato-indice.md).

Todas las rutas son relativas a los snapshots read-only:
`snap/{oba-docs,odumbo-docs,adhoc-docs}`. Todo lo que sigue está medido contra
esos archivos, no contra memoria.

---

## 0. Qué hay hoy, medido

| | oba-docs | odumbo-docs | adhoc-docs |
|---|---|---|---|
| eje | versión | versión **apagada** (`versionado: false`) | project |
| lista de valores | `versions: ["19","18"]` | `versions: []` | `projects: [{...}]` (objetos ricos) |
| default del eje | `latest: "19"` | `latest: null` | **no existe** |
| forma de la URL | `versionLabel`/`versionPath` (templates `{v}`) | idem, **ausentes en su config** | `path = p.id` (build.mjs:561) |
| secciones fuera del eje | `crossVersionSections: ["relacion"]` | `[]` | no aplica |
| `versionedSections` | declarado, **nunca leído** | declarado, **nunca leído** | no existe |
| tipos de doc | — | — | `types: [6 valores]`, valida `fm.type` (build.mjs:336) |
| `modules` | `fm.modules` → índice y filtro MCP | filtro MCP expuesto **sin contenido que lo use** (api/mcp.mjs:144) | descartado a propósito (build.mjs:618 "`modules` NO viaja") |
| mapa Vercel | `proyectos: {prj→audiencia}` | idem (1 entrada) | **no tiene** (no tiene guard) |
| clave de audiencia en el índice | `build.audience` (build.mjs:985) | `build.audience` (build.mjs:664) | `build.audiencia` (build.mjs:679) |
| id de documento | `` `${version}::${slug}` `` (indice.mjs:170) | idem (indice.mjs:106) | `` `${project}::${slug}` `` (indice.mjs:119) |
| `leer()` sin valor de eje y >1 candidato | elige `latest`, si no `candidatos[0]` (indice.mjs:550-553) | idem (indice.mjs:429-433) | **ambigüedad estructurada**, no elige (indice.mjs:487-511) |
| validador de la config | ninguno | ninguno | `leerRegistro()` de fetch.mjs:110-168 (solo `projects`) |

Dos observaciones que ordenan el diseño:

1. **`versionado: false` no es un tercer eje, es el eje apagado.** El build lo
   lee una vez (odumbo build.mjs:56) y ramifica en dos emisores completos
   (`emitPlano` desde build.mjs:383 vs `emit` desde build.mjs:~450). El MCP lo
   lee del índice para *no ofrecer* el filtro `version`
   (odumbo api/mcp.mjs:71-76). Eso es exactamente `eje: "none"`.
2. **La diferencia real entre oba y adhoc no es "version vs project": es que uno
   tiene orden entre los valores del eje y el otro no.** Todo lo demás (lista
   de valores, label, segmento de URL, filtro duro en `buscar()`, valor en el id
   del documento, `otrasVersiones` / `mismoSlugEnOtrosProjects`) es el mismo
   mecanismo con dos nombres. El orden es lo único que hace legítimo elegir por
   default en `leer()`.

---

## 1. El modelo

```json
{
  "schemaVersion": 1,
  "eje": {
    "tipo": "version",
    "default": "19",
    "valores": [
      { "id": "19", "label": "19.0", "path": "19" },
      { "id": "18", "label": "18.0", "path": "18" }
    ]
  },
  "audiences": ["publico", "interno"],
  "secciones": { "fueraDelEje": ["relacion"] },
  "metadata": { "modules": true },
  "deploy": {
    "proyectos": { "prj_…": "publico" },
    "guardDeFuga": { "activo": true }
  }
}
```

### 1.1 `eje.tipo`: `"version" | "project" | "none"`

**Decisión.** Un solo enumerado en el config. El código de plataforma nunca
pregunta `if (config.projects)`: pregunta `config.eje.tipo`.

**Por qué es un enumerado y no dos booleanos.** Porque las tres ramas son
mutuamente excluyentes en el código que ya existe: el árbol emitido tiene
segmento de eje o no lo tiene (oba build.mjs:775-777 vs odumbo build.mjs:383),
el MCP expone el filtro o no lo expone (odumbo api/mcp.mjs:74), y el id del
documento lleva prefijo o no. Con dos flags hay cuatro combinaciones y dos son
inválidas.

**Por qué `version` y `project` no colapsan en un genérico `"eje: on"`.** Porque
el tipo decide **tres** cosas que no se derivan de nada más:

- el **orden**: `version` tiene orden (indice.mjs:209 ordena y `.reverse()`
  porque "la más nueva primero"); `project` no lo tiene y adhoc lo dice explícito
  (indice.mjs:176-178: "Orden alfabético, no `.reverse()` como las versiones de
  Odoo: entre projects no hay 'el más nuevo'");
- la **palabra que ve el LLM** en el schema de las tools (§4);
- la **semántica de "el mismo slug en otro valor"**: en `version` son la misma
  página en otra versión (`otrasVersiones`, oba indice.mjs:573); en `project` son
  documentos distintos que comparten nombre de archivo (adhoc indice.mjs:533-537
  lo aclara en el nombre del campo y en el comentario).

Un genérico obligaría a re-decidir eso en cada consumidor: el colador que la
spec nombra (spec:62-63).

### 1.2 `eje.valores`: objetos, no strings; adiós a `versionLabel`/`versionPath`

**Decisión.** `valores` es una lista de objetos `{ id, label?, path?, activo?,
motivo?, fuente? }`. `label` default `id`; `path` default `id`.

**Por qué.** La forma `{id, label, path}` ya existe: es exactamente lo que el
build **deriva** para el sitio, en los dos dialectos.

- oba build.mjs:846 → `versions: CFG.versions.map(v => ({ id: v, label: label(v), path: vpath(v) }))`
- adhoc build.mjs:561 → `projects: PROJECTS.map(p => ({ id: p.id, label: p.label ?? p.id, path: p.id, sidebarId: p.id }))`

Los templates `versionLabel`/`versionPath` existen sólo para compensar que
`versions` era una lista de strings pelados. Con objetos son redundantes — y
además su ausencia es un crash latente: odumbo declara `versionado: false` y
**no tiene** `versionLabel` en su config, mientras `odumbo/tools/build.mjs:91`
hace `CFG.versionLabel.replace('{v}', v)` en el scope del módulo. No explota
sólo porque nadie llama a `label()` en la rama plana. Un config que no puede
expresar "este campo no aplica" produce ese tipo de bomba; el schema con
condicionales sí puede.

`sidebarId` no viaja al config: es un detalle del emisor Docusaurus y hoy ya es
igual al `id` (adhoc build.mjs:561).

**`activo` / `motivo`.** Se generalizan de `projects` (adhoc fetch.mjs:152-158:
`activo` obligatorio, y `motivo` obligatorio cuando `activo: false` — "un project
apagado sin explicación es indistinguible de un olvido"). Valen igual para una
versión que se declara y todavía no se publica. `activo` default `true`: en la
plataforma unificada el campo obligatorio de adhoc pasa a opcional con default,
porque tres repos con dos ejes no pueden compartir un obligatorio que sólo uno
necesita — la regla que sí se conserva es la dura: `activo: false` **exige**
`motivo` (schema `if/then`).

**`fuente`.** El bloque de transporte (`repo`, `path`, `ref`, `include`,
`exclude`) se agrupa bajo `fuente` en vez de quedar plano como hoy
(adhoc docs.config.json:6-11). Motivo: es ortogonal al eje — describe de dónde
se trae el contenido, no cómo se discrimina — y plano al mismo nivel que
`id`/`label`/`path` es lo que hace que un lector no sepa qué campos son del eje y
cuáles del fetch. Costo explícito: `tools/fetch.mjs` cambia los paths de acceso
(`p.repo` → `p.fuente.repo`) en fetch.mjs:127-131, 201-215, 266-305; el repo
tiene tests (`tests/fetch.test.mjs`) que cubren esos modos de falla.

### 1.3 `eje.default`: opcional, y **es** la política de desambiguación (§3)

**Decisión.** `default` (el `latest` de hoy) es un id de `valores`.
**Obligatorio** cuando `tipo === "version"`, **opcional** cuando
`tipo === "project"`, **prohibido** cuando `tipo === "none"`.

**Por qué obligatorio en `version`.** No es sólo para `leer()`: el build lo usa
estructuralmente para decidir qué versión va a `site/docs` y cuáles a
`site/versioned_docs/version-*` (oba build.mjs:761-762, 775-777) y para
`site/versions.json` (build.mjs:840). Sin `default` el emisor versionado no
puede correr.

**Por qué opcional en `project`.** Es el único override que necesita la política
de `leer()` (§3), y hoy adhoc lo ejerce por ausencia.

**Por qué se llama `default` y no `latest`.** Porque en `project` no hay nada
"latest". `latest` queda como el nombre del concepto en el dominio versión y
aparece en el label de las tools, no en la clave del config.

### 1.4 `secciones.fueraDelEje` — sobrevive `crossVersionSections`, muere `versionedSections`

**Decisión.** Queda `secciones.fueraDelEje: ["relacion"]`. `versionedSections`
**se borra**.

**Por qué se borra.** Es código muerto: `grep -rn versionedSections` sobre los
tres repos da **cero** hits en `.mjs`/`.js` — sólo aparece en los dos
`docs.config.json` y en prosa de `AGENTS.md`. La lista de secciones dentro del
eje se deriva del árbol (todo lo que no está en `fueraDelEje`), que es el ADR
0004 §6 ("la nav no se versiona: se deriva"). Y de paso: el sidebar de oba
**hardcodea** `manual`/`guias` (build.mjs:830-834) teniendo la lista declarada al
lado sin leer — el fix es derivar del árbol como hace adhoc (build.mjs:552-556),
no revivir el campo.

**Por qué sobrevive el otro.** Se lee en tres puntos del emisor y decide la
validación del frontmatter: oba build.mjs:525 (marca el archivo como
cross-version → `versions:` deja de ser obligatorio, build.mjs:556-563), :798 y
:824 (a qué instancia de Docusaurus va cada `_category_.json`), y odumbo:164,
474, 500.

**Alcance en v1.** Permitido con `tipo` `version` o `project`; prohibido con
`none` (sin eje nada está "afuera" — odumbo ya declara `[]`, config:10).
Implementación existente sólo para `version`; para `project` el schema lo admite
pero ningún repo lo usa todavía.

> **Nota posterior — v0.8.0 (2026-09-02).** Esta sección es el registro de la
> decisión de la Etapa A y se deja como está. Lo que cambió después: el único
> corpus que ejercía el campo era oba-docs con `relacion`, y por la #73556 esa
> sección pasó a vivir dentro de cada versión. El campo **sigue en el schema y
> sigue siendo válido**, pero hoy no lo declara ningún corpus, y el post-proceso
> del buscador que le daba soporte en el sitio (`docs-indice-fuera-del-eje`) se
> borró. Lo que queda vivo es el comodín del MOTOR —un artículo con `eje: null`
> pasa cualquier filtro—, que es del índice y no de este campo. Ver el CHANGELOG
> de v0.8.0.

### 1.5 `metadata`: `modules` y `types` — metadata de dominio, no ejes

**Decisión.** Bloque `metadata` con dos claves opcionales:

```json
"metadata": { "modules": true, "types": ["concepto", "referencia", "…"] }
```

- `metadata.types` es el `types` de adhoc (config:3), leído en build.mjs:336-337
  para validar `fm.type`. Ausente o vacío ⇒ no se valida y `type` no viaja al
  índice. oba y odumbo hoy no lo tienen.
- `metadata.modules: boolean` declara si este corpus usa `fm.modules`. **Es el
  único campo genuinamente nuevo del eje**, y es la misma corrección que odumbo
  ya hizo con `versionado`: un supuesto cableado que se vuelve declaración. La
  evidencia de que hace falta: odumbo **expone el filtro `modules`** en su MCP
  (api/mcp.mjs:144) sobre un corpus que no tiene módulos de Odoo, que es
  literalmente el bug que su propio comentario condena para `version`
  ("ofrecerle a un agente un filtro que… devolvería siempre cero resultados:
  una tool que miente es peor que una tool que no está", api/mcp.mjs:67-70). Y
  adhoc lo resolvió cableando el `false` en el emisor (build.mjs:618).

**Por qué `modules` NO es un eje.** Porque no discrimina versiones del mismo
documento ni particiona el árbol: es multivaluado por artículo, se **agrega** en
los nodos del mapa (oba build.mjs:978) y actúa como filtro blando adicional
(oba indice.mjs:284-287). Un artículo pertenece a un solo valor del eje y a N
módulos. Eso es una faceta, no un eje.

### 1.6 `audiences`, `deploy.proyectos`, `deploy.guardDeFuga`

- **`audiences`** queda como está (lista de strings; los tres repos la tienen y
  la leen: oba build.mjs:550, odumbo build.mjs:85, adhoc build.mjs:88). La
  audiencia **no es el eje**: es un build entero distinto (ADR 0005), no un valor
  que discrimine documentos dentro de un índice.
  - Deuda que este campo no cierra: `lib/mcp/gate.mjs` duplica la lista inline
    porque el edge no lee del filesystem (odumbo gate.mjs:23-27, y su
    `AGENTS.md:203` la nombra como deuda; adhoc gate.mjs:133 cablea una sola).
    Se cierra **generando** un módulo desde el config en el build, no agregando
    un campo.
- **`deploy.proyectos`** es el `proyectos` de oba/odumbo (mapa
  `VERCEL_PROJECT_ID → audiencia`), leído por `scripts/guard-fuga.mjs:67-73`. Se
  mueve bajo `deploy` porque no describe el contenido: describe el despliegue.
  El schema exige que cada valor esté en `audiences` (hoy no lo valida nadie; el
  guard lo chequea recién en runtime, guard-fuga.mjs:80-82).
- **`deploy.guardDeFuga`** es nuevo y lo manda la spec, no yo: Fase 0 punto 4
  (spec:116-118) — "el guard de fuga entra a adhoc-docs — **o su ausencia se
  declara en `docs.config.json` con `motivo`**… La omisión silenciosa deja de ser
  posible". Forma: `{ "activo": true }` o
  `{ "activo": false, "motivo": "…" }` (mismo patrón que `activo`/`motivo` del
  eje). Obligatorio en el schema: es la única forma de que "no tiene guard" sea
  un dato y no un silencio.

---

## 2. Formato de id de documento

**Decisión.** El **build emite** el `id`; el lector no lo compone.

```
id = `${valorDelEje ?? '*'}::${slug}`
```

Ejemplos: `19::manual/ventas/notas-de-credito`, `*::relacion/index`,
`adhoc-way::adhoc-way/index`, y con `eje: "none"`: `*::sla/index`.

**Por qué el emisor y no el lector.** Hoy lo compone el lector
(`idDe()`: oba indice.mjs:170, odumbo:106, adhoc:119) y es el `idField` de
MiniSearch (indice.mjs:194-195). Que el identificador de un documento se
invente en tres lugares distintos es la definición de contrato no gobernado; y
cuando el paquete sea uno, el id tiene que ser el mismo que el que emitió el
build que produjo el índice.

**Por qué `*` y no `null`.** Porque hoy oba interpola `null` y emite ids
literales `"null::relacion/index"` para todo el contenido cross-version
(indice.mjs:170 con `articulo.version == null`, que es el caso de
build.mjs:819). Funciona por accidente: `"null"` no es un valor de eje válido,
pero es indistinguible de una versión llamada así y se filtra al MCP en cualquier
diagnóstico. `*` se lee como "aplica a todos", es estable, y no colisiona con un
id de eje (el schema los restringe a `^[a-z0-9][a-z0-9.-]*$`).

**Invariante linteable (extiende ADR 0004 §5).** Para cada par
`(slug, valorDelEje)` existe exactamente un archivo — ya se lintea
(oba build.mjs:571-585). Se **agrega** una segunda invariante que hoy falta: un
slug no puede estar a la vez dentro y fuera del eje. El lint actual usa claves
distintas (`slug@cross` vs `slug@19`, build.mjs:574 y 581), así que
`relacion/x.md` cross-version y `manual/x.md`… no colisionan porque el slug
incluye la sección — pero mover una página de sección sin renombrarla produce
dos artículos con el mismo slug y ids distintos (`*::x` y `19::x`), y `leer({slug:
"x"})` cae en la rama de desambiguación con candidatos de naturaleza distinta.
Con la política de §3 eso se resuelve, pero es un error de contenido y tiene que
fallar el build.

---

## 3. Política de desambiguación de `leer()` — una sola regla

**El problema.** `leer({ slug })` sin valor de eje y con N>1 candidatos. Hoy hay
dos respuestas opuestas y ambas están bien argumentadas en su propio repo:

- oba/odumbo eligen `latest` y si no está, `candidatos[0]`
  (indice.mjs:550-553): *"Sin versión pedida: manda `latest` de la config, no el
  orden de inserción del índice"*.
- adhoc no elige y devuelve `encontrado: false, motivo: "ambiguo-entre-projects"`
  (indice.mjs:487-511): *"entre projects no hay uno 'por default', y devolverte el
  equivocado te haría citar la documentación de otro producto"*.

**La regla única.**

> **`leer()` sólo elige cuando el config declaró a quién elegir.** Si el eje
> tiene `default`, se devuelve ese candidato y la respuesta **declara** que hubo
> elección. Si no tiene `default`, se devuelve ambigüedad estructurada. Nunca se
> elige por orden de inserción.

Pseudocódigo del contrato:

```js
// candidatos = idx.porSlug.get(slug)
// 1. cero candidatos            -> soft-fail 'slug-inexistente' + sugerencias por similitud
// 2. valor de eje pedido        -> match exacto || match fuera-del-eje (eje == null)
//                                  || soft-fail 'slug-fuera-del-valor-pedido'
// 3. sin valor pedido:
//    3a. un candidato           -> ese
//    3b. hay un candidato fuera del eje  -> ese   (aplica a todos los valores)
//    3c. eje.default declarado  -> el del default; elegidoPor: 'default'
//    3d. resto                  -> encontrado:false, motivo:'ambiguo-en-eje'
```

**Por qué esta regla y no otra.** Porque **reproduce exactamente el
comportamiento de los tres repos hoy** sin ningún `if` por tipo de eje: oba y
odumbo declaran `latest` ⇒ siguen eligiendo (3c); adhoc no declara `default` ⇒
sigue devolviendo ambigüedad (3d). No hay migración de comportamiento, y el
override que la spec pedía ("proponé una política única con override por config")
es la **presencia o ausencia de `eje.default`** — no un switch nuevo. Un switch
adicional (`desambiguacion: "elegir" | "ambiguo"`) sería un segundo dato que
puede contradecir al primero: `default` declarado + `"ambiguo"` es un estado sin
significado.

Tres precisiones que el contrato hace explícitas y hoy no lo son:

1. **Elegir se anuncia.** Cuando `leer()` elige por `default`, la respuesta trae
   `elegidoPor: "default"` y un mensaje de una línea. Hoy oba elige en silencio:
   el único rastro es `otrasVersiones` (indice.mjs:573), que el LLM puede
   ignorar. Si la plataforma se permite elegir, tiene que decir que eligió.
2. **`candidatos[0]` desaparece.** Es el fallback de oba indice.mjs:552-553 y es
   "el orden de inserción del índice", exactamente lo que su propio comentario
   dice que hay que evitar. Con `default` obligatorio en `tipo: "version"` el
   caso no existe; en `project` sin `default` cae en 3d.
3. **El contenido fuera del eje gana sin ambigüedad (3b) y pasa cualquier valor
   pedido (2).** Es el fix #11/#12 de oba (indice.mjs:522-527 y 269-289 con el
   comentario largo: "TODO el contenido cross-version (`relacion/`) quedaba
   invisible en la práctica"). Hoy **falta en odumbo** (indice.mjs:369-433 no
   tiene ese fallback) — es el drift que la Fase 0 cherry-pickea, y en el modelo
   unificado es una sola implementación.

**Nombre de campos de la respuesta, unificado.** `otrasVersiones` (oba:573) y
`mismoSlugEnOtrosProjects` (adhoc:535) pasan a **`otrosDelEje: [{ valor, url }]`**.
La semántica ("otra versión de lo mismo" vs "otro documento que comparte nombre")
la da `eje.tipo`, que ya viaja en la cabecera del índice — no hace falta un nombre
de campo distinto, y el prompt/description de la tool sí puede diferir por tipo
(§4). El aviso de adhoc para resultados de `buscar()` mezclados
(indice.mjs:380-393) se conserva tal cual y se generaliza: con `tipo: "version"`
el texto habla de versiones; con `project`, de projects.

---

## 4. La palabra del eje en la superficie MCP

El config y el índice hablan **genérico** (`eje`); las tools que ve el LLM hablan
**dominio** (`version` / `project`). El nombre y la descripción del parámetro se
derivan de `eje.tipo` al construir el server.

**Por qué.** Porque el nombre del parámetro es prompt: `version: "Versión de
Odoo…"` (oba api/mcp.mjs:135-141) y el aviso de atribución entre projects
(adhoc indice.mjs:380-393) no son intercambiables para un agente. Y porque el
precedente ya existe: odumbo **construye** el filtro condicionalmente
(`FILTRO_VERSION`, api/mcp.mjs:73-76) y lo omite entero cuando el corpus no
versiona (:168-175). Generalizar eso a "el nombre sale del tipo" es una tabla de
tres filas, no un colador:

| `eje.tipo` | param de `buscar()`/`leer()` | filtro `modules` | ordena valores |
|---|---|---|---|
| `version` | `version` | según `metadata.modules` | desc (nueva primero) |
| `project` | `project` | según `metadata.modules` | alfabético |
| `none` | *(no se expone)* | según `metadata.modules` | — |

---

## 5. `schemaVersion` y la regla del lector

`schemaVersion` es un **entero**, arranca en `1`, y es obligatorio en los dos
contratos (config e índice).

```js
const SOPORTADO = 1;
if (!Number.isInteger(cfg.schemaVersion)) throw new Error('config sin schemaVersion');
if (cfg.schemaVersion > SOPORTADO) throw new Error(
  `docs.config.json declara schemaVersion ${cfg.schemaVersion} y esta plataforma lee hasta ${SOPORTADO}: actualizá el paquete.`);
```

**Tira si el emisor es más nuevo** (el lector no puede adivinar campos que no
conoce). Un emisor **más viejo** dentro del mismo major se acepta y se aplican
los defaults del schema. Un config **sin** `schemaVersion` es "pre-unificación":
`fail` con un mensaje que nombra el archivo y el campo faltante — no se
interpreta como v1, porque las tres formas actuales son incompatibles entre sí y
adivinar cuál es sería exactamente el bug que este campo previene.

> Nota de redacción para la spec: spec:78 dice "El lector TIRA si el emisor es
> **más viejo** de lo que sabe leer". Es al revés (lo dice bien el brief de esta
> tarea): tirar con un emisor más viejo rompe la compatibilidad hacia atrás que
> el versionado existe para dar. Vale corregir esa línea al ratificar.

`additionalProperties: false` en todos los objetos del schema. Una clave
desconocida es un error, no un campo ignorado: "`docs.config.json` tiene tres
esquemas distintos y ningún validador — el contrato de la plataforma, sin
gobernar. **Ahí empezó el fork**" (spec:25-27).

---

## 6. Tabla de destino, campo por campo

| Campo actual | Repo | Destino en v1 | Por qué |
|---|---|---|---|
| `versions: [str]` | oba, odumbo | `eje.valores[].id` (+`label`,`path`) | §1.2 |
| `latest` | oba, odumbo | `eje.default` | §1.3 |
| `versionado: false` | odumbo | `eje.tipo: "none"` | §1.1 |
| `versionLabel`, `versionPath` | oba | **se borran** → `valores[].label` / `.path` | §1.2 (crash latente en odumbo:91) |
| `versionedSections` | oba, odumbo | **se borra** | código muerto; nav derivada (ADR 0004 §6) |
| `crossVersionSections` | oba, odumbo | `secciones.fueraDelEje` | §1.4 |
| `audiences` | los tres | `audiences` (igual) | §1.6 |
| `proyectos` | oba, odumbo | `deploy.proyectos` | §1.6 |
| `types` | adhoc | `metadata.types` | §1.5 |
| `projects[]` | adhoc | `eje.valores[]` con `eje.tipo: "project"` | §1.1/1.2 |
| `projects[].repo/path/ref/include/exclude` | adhoc | `eje.valores[].fuente.*` | §1.2 |
| `projects[].activo/motivo` | adhoc | `eje.valores[].activo/motivo` | §1.2 |
| — | — | `schemaVersion` **(nuevo)** | spec:76-78 |
| — | — | `deploy.guardDeFuga` **(nuevo)** | spec:116-118 (Fase 0.4) |
| — | — | `metadata.modules` **(nuevo)** | §1.5 (generaliza un cableado real) |

Campos nuevos: **tres**, dos mandados por la spec y uno que declara un supuesto
que hoy está cableado en el emisor. Nada más.

---

## 7. Para jjs

Tres cosas que no resuelvo sin vos.

1. **Un solo eje por corpus: ¿se acepta el techo?** El modelo (y el enumerado de
   la spec) admite un eje por config. Hoy alcanza para los tres repos. Pero
   `adhoc-docs` agrega el `docs/` de projects que *ellos mismos* podrían
   versionar (`oba-project`, `odumbo-project`), y el `docu-interna` previsto
   (spec:120-130) entra como "un cuerpo más registrado como fuente". El día que
   un corpus necesite `project × version` al mismo tiempo, este schema no lo
   expresa y la salida es un `schemaVersion: 2` con `ejes: [...]` (plural).
   ¿Aceptamos el techo explícitamente para v1, o el schema nace con `ejes` como
   lista de uno? Mi recomendación: aceptar el techo — un eje, y que la
   necesidad real lo reabra con evidencia (mismo criterio que la alarma de bumps
   de la Etapa B). Pero es tu llamada porque compromete el major.

2. **`metadata.types`: ¿vocabulario por corpus o único de Adhoc?** Hoy sólo
   adhoc-docs tiene `types` y son 6 valores que se parecen mucho a un estándar de
   knowledge-management (`concepto`, `referencia`, `procedimiento`,
   `troubleshooting`, `guia`, `indice`). Si el vocabulario es de Adhoc, no va en
   el config de cada repo: va en el paquete y el config sólo dice si lo exige.
   Si es por corpus, queda como está. La diferencia es si un `type` significa lo
   mismo en oba-docs y en adhoc-docs — decisión de gobernanza de contenido, no de
   schema. Mientras no se lauda, el schema lo deja como lista por corpus
   (compatible con las dos salidas).

3. **El opt-out del guard de fuga en adhoc-docs: ¿lo firmás?** El schema obliga a
   declarar `deploy.guardDeFuga`. Para adhoc-docs hay dos salidas y las dos son
   defendibles: `{"activo": false, "motivo": "…"}` (el repo no tiene build
   público — su gate es incondicional, gate.mjs:136-145 — y el guard protege
   contra fuga *al build público*), o entra el guard igual como cinturón. La spec
   deja las dos abiertas (spec:116-118). Si va el opt-out, el `motivo` es texto
   que queda en el repo con tu firma: lo redacto cuando digas cuál de las dos.

Dos cosas que **decidí** y conviene que sepas porque tienen costo de migración
(no las mando a este apartado porque tienen un desempate claro, pero mirálas):

- **`audiencia`, no `audience`**, como clave única en el índice y en
  `site/generated.json`. Gana el argumento que adhoc ya escribió
  (build.mjs:671-678: dos claves para el mismo dato es la doble fuente que se
  pudre) y el resto del contrato ya está en castellano (`mapa`, `articulos`,
  `seccion`, `versionado`). Costo, todo medido: `oba/scripts/guard-fuga.mjs:89`
  (lee `generated.json.audience`) y `:111-112` (lee `removido.json.audience`, que
  emite oba build.mjs:1323), `oba/site/docusaurus.config.js:9` y `:70`
  (`customFields.audience`), y los fallbacks de `indice.mjs:214` /
  odumbo `:154`. Es un PR coordinado, no un bloqueo.
- **`fuente` como sub-objeto** en `eje.valores` (§1.2): toca `tools/fetch.mjs`
  de adhoc-docs en ~6 lugares, cubiertos por `tests/fetch.test.mjs`.
