# `lib/mcp/indice.mjs` — best-of-three, diferencia por diferencia

Insumo de la **Etapa A** de la spec `arquitectura-plataforma-docs.md`. Tres
versiones del mismo módulo: `oba-docs` (592 líneas, **O**), `odumbo-docs`
(475, **U**) y `adhoc-docs` (559, **A**). Las referencias son
`archivo:línea` sobre los snapshots del 20/08.

Resultado: **41 diferencias clasificadas** — 17 FIX (a), 9 DIALECTO del eje
(b), 5 DOMINIO (c), 10 RUIDO (d) — y **7 DUDAs** al final.

La versión unificada (`indice.mjs`) conserva **los 17 fixes**, sin excepción.
Todo el diseño abierto del eje quedó en **una** función chica —
`politicaDeEje(build)`, marcada `// EJE:`— más su tabla de nombres y textos
(`VOCABULARIO`) y el mapeo de `mapa()` (`ejeEnMapa`). El resto del archivo no
sabe si el eje se llama `version` o `project`.

---

## (a) FIXES — se conservan todos

### Rescatados de `oba-docs` (los fixes #11/#12 que nunca se propagaron)

| # | Qué | Evidencia | Veredicto |
|---|-----|-----------|-----------|
| F1 | **STOPWORDS del español** + `procesarTermino` + `terminosDe`, usados como `processTerm` de MiniSearch (mismo al indexar y al buscar) | O:60-121, O:184 · **U:118-121 y A:146-149 solo normalizan**: no descartan relleno | FIX #11. Va al paquete tal cual, para los tres ejes. Es lo que hace que "quiero saber cómo hago para dar por pagada una factura" recupere la página en vez de devolver cero. |
| F2 | **Fallback automático a OR** cuando el AND da 0, con `modo: and\|or-fallback` y `nota` para el LLM | O:401-417, O:434-435, O:445-454 · U:317-320 y A:357-360 buscan solo con AND; ni `modo` ni `nota` existen | FIX #12. Va al paquete. Los filtros duros siguen aplicándose en el fallback (`filter` es el mismo). |
| F3 | **Comodín del eje en `pasaFiltros`**: un artículo con el eje en `null` (cross-version) pasa cualquier filtro del eje | O:274-291 · U:216 y A:246 comparan `String(articulo.version/project)` a secas | FIX #12 (parte filtros). Parametrizado como `politica.comodin`; con eje `project` queda **apagado** a propósito (ver DUDA-4). Sin esto, todo `relacion/` era invisible: la skill del consumidor filtra SIEMPRE por versión. |
| F4 | **Comodín del eje en `leer()`**: pedir `version: 19` sobre un artículo cross-version lo devuelve | O:514-525 · U:406 devuelve "no existe para esa versión" | FIX #12 (parte `leer`). Es la otra mitad de F3: sin ella el flujo `buscar()` → `leer()` se rompe justo en las páginas que F3 hizo aparecer. |
| F5 | **Hint 0: la query quedó vacía de términos con señal** (todo stopwords) | O:326-333 · ausente en U y A | FIX. Conservado; se verifica con los tres ejes. |
| F6 | **Texto del hint 2 consciente del fallback**: "…pero ninguno pasa tus filtros. Aflojá los filtros" | O:366-369 · U:287 y A:327 dicen "Probá una query más corta", que era correcto **antes** de que existiera el fallback OR | FIX. Se adopta el texto de O: con F2 puesto, si llegaste a los hints la query corta ya se intentó. |
| F7 | **`latest` de la config manda en `leer()` sin eje pedido**, no el orden de inserción del índice | O:546-553, U:427-434 · A no lo tiene, y es correcto: es dialecto (D4) | FIX conservado como política `sinValor: 'latest'`. |

### Rescatados de `odumbo-docs`

| # | Qué | Evidencia | Veredicto |
|---|-----|-----------|-----------|
| F8 | **El eje es configurable**: `build.versionado` viaja en el índice y `mapa()` omite `versiones`/`latest` cuando no hay eje ("un `versiones: []` con un `latest: null` al lado invita al agente a preguntarse cuál falta") | U:150-153, U:469-472 · O no lo tiene (asume versión), A tampoco (asume project) | FIX estructural, y la semilla del vocabulario unificado. Generalizado a `politicaDeEje()`: `versionado: false` → `eje: 'none'`. La compat se mantiene: `mapa()` sigue emitiendo `versionado`. |

### Rescatados de `adhoc-docs`

| # | Qué | Evidencia | Veredicto |
|---|-----|-----------|-----------|
| F9 | **`motivo` machine-readable en los soft-fail de `leer()`** (`slug-inexistente`, `slug-en-otro-project`, `ambiguo-entre-projects`) | A:448, A:467, A:494 · O:499-511/526-544 y U:389-401/408-425 devuelven solo prosa | FIX. El agente puede ramificar sin parsear castellano. Generalizado: `slug-inexistente`, `slug-en-otra-version` / `slug-en-otro-project`, `ambiguo-entre-projects`. |
| F10 | **URLs absolutas también en las sugerencias** de los soft-fail | A:438, A:479, A:506 usan `absoluta(a.url)` · O:491, O:541 y U:383, U:422 devuelven la relativa | FIX de consistencia: la mitad de las URLs de una misma respuesta eran pegables en un ticket y la otra mitad no. |
| F11 | **Tolerancia de forma en la lista declarada del eje**: acepta ids pelados u objetos `{id,label}` | A:123-136 | FIX defensivo ("cuesta diez líneas; que el MCP explote porque el preprocesador eligió la otra forma cuesta un deploy"). Generalizado a `ejeDeclarado()`: sirve igual para `versions`. |
| F12 | **Aviso de mezcla**: `buscar()` sin filtro del eje que trae resultados de varios valores lo dice ANTES de que el agente redacte | A:386-397 · no existe en O ni U | FIX. Activo hoy solo con eje `project` (ver **DUDA-3**). |
| F13 | **El hint del eje NOMBRA de dónde salen los otros resultados** y dice explícitamente que no sirven como respuesta | A:289-305 · O:344-348 y U:266-270 solo dicen cuántos hay | FIX. Conservado por eje: con `project` el texto de A (atribución), con `version` el de O ("ojo, eso devuelve otras versiones de Odoo"). |
| F14 | **Los hints agrupan por `eje/seccion`** cuando el eje es la unidad de atribución | A:318 · O:358 y U:278 agrupan solo por sección | FIX/política. Encendido con `project`, apagado con `version` (no inventamos un cambio de salida para oba). |
| F15 | **`labelDeProject`**: el label declarado en la config viaja a la respuesta de `leer()` | A:191, A:525 | FIX. Generalizado a `labelDeEje` / `${campo}Label`. |
| F16 | **`leer()` devuelve la ambigüedad en vez de elegir** cuando el slug existe en varios valores del eje y no hay orden natural | A:484-513 | FIX conceptual del eje sin orden. Conservado como política `sinValor: 'ambiguo'`. |
| F17 | **`mapa()` expone los valores declarados además de los presentes** ("si un project declarado no aparece, o no tiene docu o el fetch falló — y eso se ve acá") | A:552-557 | FIX de observabilidad. Se emite cuando el build declara la lista (hoy solo adhoc: el `build` de O no emite `versions`, U:663-674 tampoco). |

---

## (b) DIALECTO del eje — parametrizado, no elegido

Todas estas diferencias salen ahora de `politicaDeEje()` + `VOCABULARIO` +
`ejeEnMapa()`.

| # | Qué | Evidencia | Cómo queda |
|---|-----|-----------|-----------|
| D1 | Campo que materializa el eje: `version` / `project` / ninguno | O:171, A:120, U:107 (con `versionado:false`, U seguía formando el id con `version`) | `politica.campo` |
| D2 | `idDe()`: `${version}::${slug}` vs `${project}::${slug}` | O:170-172, A:119-121 | Parametrizado; con eje `none` el id es el slug pelado (ver **DUDA-2**) |
| D3 | Orden de los valores del eje: `.sort().reverse()` vs `.sort()` alfabético ("entre projects no hay el más nuevo") | O:209, U:146 vs A:176-178 | `politica.orden` |
| D4 | `leer()` sin valor del eje: gana `latest` vs se devuelve la ambigüedad | O:546-553, U:427-434 vs A:484-513 | `politica.sinValor` |
| D5 | Nombres de los campos de respuesta: `versionPedida`/`projectPedido`, `versionesDisponibles`/`projectsDisponibles`, `otrasVersiones`/`mismoSlugEnOtrosProjects`, `versiones`/`projects` | O:533-536, O:573 vs A:468-474, A:535-537 | Tabla `VOCABULARIO` |
| D6 | Los textos de los mensajes del eje (`noCoincide`, hint de aflojar, aviso de mezcla) | O:534-535, A:471-473 | Tabla `VOCABULARIO`, verbatim por eje |
| D7 | Clave de la audiencia en el contrato del índice: `build.audience` (O:214, U:155; emitido en `tools/build.mjs` O:985, U:664) vs `build.audiencia` (A:186; emitido en A `tools/build.mjs`:679), y default `'desconocida'` vs `'interno'` | — | El lector acepta **las dos** claves; default `'desconocida'`. Ver **DUDA-1** |
| D8 | Comodín del eje encendido/apagado | O:282 vs A:246 | `politica.comodin` |
| D9 | Filtros que `buscar()` expone en su eco: `{version, modules, seccion}` vs `{project, seccion}` | O:428-432 vs A:371-374 | Derivado de la política (`camposDeFiltro`) |

---

## (c) DOMINIO de un corpus — config o texto genérico, no lógica del paquete

| # | Qué | Evidencia | Cómo queda |
|---|-----|-----------|-----------|
| C1 | `modules` como filtro duro y campo guardado (metadata de OBA/Odumbo) | O:143, O:286-289, O:309 · U:78, U:218-221 | `politica.filtrosDominio` / `camposDominio`. Default por eje = lo que hacía cada repo; declarable por el build (ver **DUDA-6**) |
| C2 | `type` como campo guardado y devuelto (taxonomía de adhoc-docs, `docs.config.json:"types"`) | A:92, A:264, A:528 | `politica.camposDominio` |
| C3 | Ejemplos de dominio dentro de los textos de hints: "rectificativa en vez de nota de crédito" (O:373) vs "vocabulario de la documentación interna" (A:333) | — | Texto genérico: "el vocabulario de la documentación, o empezá por `mapa()`". Los dos tests originales siguen pasando |
| C4 | Qué campos de una rama del mapa se buscan por término: `modules` (O:382, U:302) vs `project`/`label` (A:342) | — | Unión tolerante de los campos conocidos; los ausentes no aportan |
| C5 | Ejemplo de ruta relativa en el comentario de `absoluta()`: `/19/...` vs `/sla/...` vs `/adhoc-way/...` | O:249, U:190, A:222 | Comentario genérico |

---

## (d) RUIDO — comentarios, orden, refactor sin efecto

R1 header: "hay que verificar el toggle en los dos proyectos" (O:6-7, U:6-7)
ausente en A:5. · R2 el comentario de `normalizarTermino` menciona las
STOPWORDS en O:44-51 y dice "no trae stemming ni stopwords" en U:44-50 /
A:57-63 (mismo código). · R3 `BOOST` con y sin "spec §La búsqueda" (O:126 vs
A:75). · R4 el docstring de `hints` ("CERO resultados de verdad" O:318 vs "0
resultados" U:250, A:275). · R5 el `cabecera = {buildId, audiencia}` de A:428
evita repetir el par cinco veces (adoptado). · R6 `FUZZY`: "(spec, review
19/08)" vs "(spec)". · R7 el comentario del fixture/PoC en el header de A:23-37
(reemplazado por el bloque "EL EJE ES PARÁMETRO"). · R8 `porId` se construye
en los tres y **ningún** `buscar/leer/mapa` lo usa — se conserva porque los
tests de A lo inspeccionan. · R9 orden de `rutasCandidatas()`: se puso
`process.cwd()` **antes** de la ruta relativa al módulo, porque empaquetado el
módulo vive en `node_modules` y la relativa deja de apuntar al repo; con el
layout viejo las dos resuelven al mismo archivo. · R10 blancos y orden de
declaración de `PAGINA_LEER` (declarado al final en los tres, subido arriba con
las otras constantes).

---

## Lo que NO se tocó (y por qué)

- **`schemaVersion`** (mitigación nombrada en la spec): es del **contrato**
  índice↔motor, no de este archivo. Agregarlo acá sin el emisor sería inventar
  comportamiento. Corresponde al ensamblador de la Etapa A, junto con el
  validador de `docs.config.json`.
- **`api/mcp.mjs`** (los input schemas de las tools por eje) y **`gate.mjs`**:
  fuera de alcance de esta tarea. La firma que este módulo expone lo permite:
  `buscar({q, page, ...filtros})` y `leer({slug, page, ...eje})` toman el eje
  por nombre, así que el handler declara `version` o `project` según la config
  sin que el motor cambie.

---

## Tests

`buscar.test.mjs` — **61 checks, todos en verde** (`node --test buscar.test.mjs`,
node 22). Es el port de los dos scripts que existían **solo en oba-docs**:

- **`scripts/test-buscar.mjs`** (189 líneas, script a mano con `console.log` y
  contador de fallos) → suite `node:test`. Sus 5 grupos de casos entraron
  completos: frases conversacionales, regresión de ranking de queries precisas,
  fallback OR, hints, cross-version bajo filtro de versión, y el `leer()`
  cross-version del final.
- **`scripts/busqueda-calidad.mjs`** (103 líneas, Playwright contra los dos
  sitios servidos) → **port parcial y declarado**: sus cuatro tipos de query
  (mensaje de error literal, nombre de campo, pregunta en lenguaje natural,
  término solo interno) y el chequeo de scope entraron como casos del índice.
  Lo que **no** se puede portar es lo que medía: el buscador de Docusaurus
  sobre el sitio HTTP, que no es el motor del MCP y no se parametriza por
  fixture. Ese chequeo queda como script del repo consumidor (usa `playwright`,
  que hoy es devDependency de oba-docs y de nadie más).

Dos cambios de fondo, los dos a propósito:

1. **Parametrizada por fixture, no por corpus real.** El original exigía
   `npm run gen:publico` y afirmaba slugs de contenido real
   (`manual/finanzas/...`): se rompía cuando el contenido se renombraba, y no
   podía correr en CI de un paquete que no tiene contenido. Las fixtures
   (`fixtures/eje-version.json`, `eje-version-interno.json`, `eje-none.json`)
   son corpus mínimos escritos para hacer verificable cada comportamiento;
   `fixtures/eje-project.json` es **la fixture de adhoc-docs copiada tal cual**
   (`tests/fixtures/index.json`), para no perder los casos que ese eje ya tenía
   cubiertos.
2. **Los tres ejes en la misma suite.** Los fixes #11/#12 no son del eje
   versión: son del motor. Están verificados con `version`, `project` y `none`
   — que es, en concreto, el mecanismo que evita que el próximo fix se pierda
   en un repo.

Las 25 aserciones de `tests/mcp.test.mjs` de adhoc-docs que corresponden al
índice (`describe('índice')`, `buscar`, `leer`) están todas representadas y
pasan contra el módulo unificado, incluidas `'latest' in m === false`, el
`aviso` de mezcla, `ambiguo-entre-projects` y "no existe rastro de `modules`".
Los bloques de `tokens`, `gate` y `handler HTTP` de ese archivo son de otros
módulos: no se tocaron.

---

## DUDAs (con recomendación)

**DUDA-1 — `build.audience` vs `build.audiencia`, y el default.** No es ruido:
son dos claves distintas del contrato, emitidas por dos preprocesadores
(O:985/U:664 escriben `audience`; A:679 escribe `audiencia`), y el default
también difiere (`'desconocida'` en O/U, `'interno'` en A:186). El unificado
**acepta las dos** y usa `'desconocida'` como default.
*Recomendación:* que el contrato con `schemaVersion` fije **`audience`** como
canónica, el lector acepte `audiencia` un release más, y el default sea
`'desconocida'` — decir "no sé" es más seguro que afirmar `'interno'`.
*Riesgo verificado:* el gate NO lee este campo (usa `env.DOCS_AUDIENCE`:
O:119, U:133-138, A:140), así que el default es informativo, no una decisión de
seguridad. Igual conviene que lo confirme el dueño del gate.

**DUDA-2 — el id de un artículo con eje `none`.** U:107 formaba el id con
`${articulo.version}::${slug}` incluso con `versionado: false`, o sea
`"undefined::manual/sla/..."`. El unificado usa el slug pelado.
*Recomendación:* aceptar el cambio — los ids no viajan en ninguna respuesta
(`porId` es interno y nadie lo consume salvo tests). Si algún consumidor
pinchara ids, esto es breaking y hay que verlo antes del bump.

**DUDA-3 — el aviso de mezcla con eje `version`.** Hoy queda encendido solo
con `project` (`politica.avisoMezcla`), porque en oba-docs nunca existió y
esta unificación no inventa comportamiento. Pero el error es el mismo:
mezclar la 18 y la 19 en una respuesta sin atribuir es tan caro como mezclar
`oba` y `odumbo`.
*Recomendación:* encenderlo para `version` en un bump propio, con su test,
después de la unificación. Es un campo nuevo (`aviso`) y additivo: no rompe
consumidores.

**DUDA-4 — ¿el comodín del eje es una propiedad del eje o del corpus?** Lo
resolví como propiedad del eje (`version` sí, `project` no), que es lo que
hacían los tres repos. Pero nada impide que un corpus con eje `project` tenga
un doc transversal.
*Recomendación:* que el schema del índice **prohíba explícitamente**
`project: null` mientras el comodín esté apagado, para que la contradicción
falle en el build y no en runtime.

**DUDA-5 — `latest` con eje `project`.** El unificado ignora `build.latest`
cuando `sinValor !== 'latest'` (no hay "último project"). Un
`docs.config.json` con `eje: project` **y** `latest` es hoy una contradicción
silenciosa.
*Recomendación:* que el validador de config la rechace.

**DUDA-6 — el default de `filtrosDominio`/`camposDominio` por eje.** Puse
`modules` para `version` y `type` para `project` porque es lo que hacía cada
repo, pero la correlación es histórica, no conceptual: un corpus con eje
`project` podría tener `modules`.
*Recomendación:* que el build **declare** `camposDominio`/`filtrosDominio` en
el bloque `build` (el lector ya los respeta si vienen), y borrar el default por
eje cuando los tres builds los emitan.

**DUDA-7 — la spec dice "vitest" y adhoc-docs no usa vitest.** La Etapa A fija
como convención de tests del paquete "la de adhoc-docs (vitest, suites
corribles)"; adhoc-docs corre `node --test tests/*.test.mjs`
(`package.json:"test"`) y no tiene vitest ni en dependencies ni en
devDependencies. La convención real —y la que me pidieron— es **`node:test`
nativo**, que es la que usa el entregable.
*Recomendación:* corregir esa línea de la spec antes de que alguien instale
vitest para cumplirla.
