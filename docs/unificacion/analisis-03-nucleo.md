# Best-of-three del núcleo del MCP — clasificación, veredictos y DUDAs

Etapa A de la unificación de la plataforma de docu. Alcance de este análisis:
`lib/mcp/gate.mjs`, `lib/mcp/auth.mjs`, `lib/mcp/tokens.mjs`,
`lib/mcp/feedback.mjs` y `api/mcp.mjs` de `oba-docs`, `odumbo-docs` y
`adhoc-docs`. **Fuera de alcance**: `lib/mcp/indice.mjs` (el motor) y
`tools/build.mjs`.

Método: diff archivo por archivo, cada diferencia clasificada en

- **(a) FIX** — se conserva, sí o sí.
- **(b) DIALECTO** del eje `version`/`project` — se parametriza. Lo que
  todavía está abierto quedó encapsulado en funciones marcadas `// EJE:`
  (`describirEje()` y `ejeHabilitado()` en `mcp-handler.mjs`, `camposDeEje()`
  en `feedback.mjs`). El agente que cierre el vocabulario toca esas tres.
- **(c) DOMINIO** de un corpus — sale del código y entra a la config.
- **(d) RUIDO** — comentarios, nombres de repo, typos.

Medición de partida (`md5sum`): `auth.mjs` y `tokens.mjs` y `feedback.mjs` son
byte-idénticos entre `oba` y `odumbo`; `adhoc-docs` difiere en los tres.
`gate.mjs` 178/197/204 líneas, `api/mcp.mjs` 303/307/275.

---

## 0. Corrección de premisa (importante)

El brief decía: *"fail-closed sin `DOCS_AUDIENCE` es un fix conocido de oba —
verificá quién lo tiene"*. **Verificado: oba-docs es el que NO lo tiene.**

`oba-docs/lib/mcp/gate.mjs:119`

```js
// El sitio público no lleva gate.
if (env.DOCS_AUDIENCE !== 'interno') return null;
```

Sin la variable, el sitio queda **público por descarte**. El fix está en
`odumbo-docs` (línea 125+, con la lista `AUDIENCIAS` y un comentario que dice
literal *"En oba-docs esta línea era …: con la variable sin setear, el sitio
quedaba público POR DESCARTE"*) y en `adhoc-docs` en su variante de una sola
audiencia (`DOCS_AUDIENCE !== 'interno'` → 503). Confirmación independiente en
los tests: `odumbo-docs/scripts/test-middleware.mjs:28-31` agrega tres casos
con el comentario *"En el molde estos tres casos devolvían 'pasa'"*; el
`test-middleware.mjs` de oba no los tiene.

Coincide con la Fase 0 de la spec (`arquitectura-plataforma-docs.md`, punto 2:
*"Portar a oba-docs … fail-closed de gate sin `DOCS_AUDIENCE`"*). El núcleo
unificado lo trae de fábrica.

**Consecuencia operativa que hay que decir en voz alta:** cuando oba-docs
adopte el núcleo, `DOCS_AUDIENCE` tiene que estar seteada en **Production,
Preview y Development de los dos proyectos de Vercel** antes del merge. Si no,
los previews devuelven 503. Es la dirección segura, pero no es gratis.

---

## 1. `tokens.mjs` — sin dialecto, sin dominio

| Diferencia | Clase | Veredicto |
|---|---|---|
| `adhoc-docs` suma 3 líneas de comentario ("copiado de oba-docs sin cambios", "primer candidato a extraerse a un paquete") | (d) | Se descarta: la nota describe el estado previo a este trabajo |

Código byte-idéntico en los tres. Es el archivo que la spec nombra como *"la
gramática vive una sola vez"*, y es literalmente cierto: **cero cambios de
comportamiento** en el unificado.

## 2. `auth.mjs` — un fix de comentario, nada más

| Diferencia | Clase | Veredicto |
|---|---|---|
| oba/odumbo: *"así que hasheamos primero: la comparación queda sobre dos digests de 32 bytes"* | **(a) FIX** (de doc) | **Se toma la de adhoc-docs.** El comentario de oba describe un código que no existe: `igual()` no hashea nada, compara buffers y rellena ante largos distintos. Un comentario que miente sobre una comparación en tiempo constante es una trampa para el próximo que la toque |
| `72391` referida como "hasta la 72391" vs "hasta que Odoo sea authorization server OIDC (72391)" | (d) | La de adhoc (se entiende sin abrir Odoo) |
| "MCP interno" vs "MCP de la documentación interna" | (d) | Neutralizado: "MCP con auth" |

Comportamiento: **idéntico a los tres**.

## 3. `gate.mjs` — acá está el fix que importa

| # | Diferencia | Clase | Veredicto |
|---|---|---|---|
| G1 | Fail-closed sobre `DOCS_AUDIENCE` (odumbo: lista `AUDIENCIAS`; adhoc: única audiencia; oba: **no lo tiene**) | **(a) FIX** | Conservado y generalizado: `config.audiencias`. Un repo con `['interno']` queda con gate incondicional — que es exactamente lo que adhoc-docs necesita porque **no tiene guard de fuga** |
| G2 | Mensaje del 503: oba/adhoc `"Sitio interno mal configurado"` vs odumbo `"Sitio mal configurado"` | (d) | La de odumbo: un repo con audiencia pública no es "el sitio interno" |
| G3 | Detalle del 503: odumbo `DOCS_AUDIENCE ausente o desconocida ("")` vs adhoc, que distingue `falta DOCS_AUDIENCE` de `no es una audiencia servible (esperaba interno)` | **(a) FIX** | La de adhoc, que es superset informativo. Los dos son 503, así que ningún test cambia de color |
| G4 | `AUDIENCIAS` inline en odumbo *"porque el edge no lee del filesystem"* | (b)/(c) | Correcto y se mantiene: la lista entra por config (que es un módulo JS, no un JSON leído en runtime). El comentario sobrevive en el encabezado |
| G5 | `CARTEL_MCP` duplicado entre `gate.mjs` y `api/mcp.mjs` en los TRES repos | (d) con riesgo | **Unificado a una fuente** (`config.cartelMcp`, que consumen gate y handler). Era drift latente: dos textos que responden al mismo GET y nadie garantizaba que dijeran lo mismo |
| G6 | oba: *"un browser autenticado manda `Basic` **solo** en cada request"* | (d) | Typo; se toma la redacción de adhoc |
| G7 | `REALM`, `RUTA_MCP`, usuario default `'adhoc'` | (c) | A config, con los defaults actuales. `RUTA_MCP` sigue siendo constante estática, no env var (la razón que da oba: una env var acá es una superficie para dejar el MCP fuera del gate) |

Todo lo demás del gate es **idéntico en los tres** y se conserva palabra por
palabra, incluidos los cuatro comportamientos que están comentados como
decisiones: challenge `Bearer` pelado y nunca `Basic` (clientes del TS SDK),
cartel 200 ante cualquier GET sin Bearer válido (bug #82534 de Claude Code),
fail-closed por capa (sin `DOCS_AUTH_PASSWORD` mueren los humanos pero el
Bearer de las máquinas sigue), y recorrer todos los tokens sin cortar en el
primer match.

## 4. `feedback.mjs` — dialecto puro, más una nota de dominio

| # | Diferencia | Clase | Veredicto |
|---|---|---|---|
| F1 | `version` → `project` en la firma y en el cuerpo del issue (`**Versión**:` / `**Project**:`) | **(b) DIALECTO** | Parametrizado en `camposDeEje()`: `eje: { param, label }`. `eje: null` para un corpus sin eje (odumbo) → el issue no menciona ningún eje |
| F2 | adhoc prefija el título con el project: `[docs-feedback] oba: index` | **(b)+(c)** | Config `enTitulo`. NO se generaliza a la versión: en adhoc-docs el eje decide **a qué repo se rutea el arreglo** (el contenido se trae por pull), con eje de versión el arreglo va al mismo repo igual. Comportamiento de los tres, preservado exacto |
| F3 | adhoc suma al pie *"El contenido se trae por pull: el arreglo va en el repo del project, no acá"* | **(c) DOMINIO** | Config `notas: []` |
| F4 | adhoc borra la salvedad *"solo el MCP interno"* porque no tiene build público | (d) | Reformulada: el alcance se cumple por construcción (la tool se registra solo si la audiencia lleva gate), y el archivo lo dice |
| F5 | `GITHUB_REPO = "ingadhoc/<repo>"` en el docstring | (d) | Genérico |

Los cinco caminos de error (`no-configurado`, `red`, `http-NNN`, el issue OK, y
"la tool responde, no rompe") son **idénticos en los tres** y quedan tal cual.

## 5. `api/mcp.mjs` → `mcp-handler.mjs`

| # | Diferencia | Clase | Veredicto |
|---|---|---|---|
| M1 | odumbo: `VERSIONADO = mapa().versionado !== false` y, si es false, **el parámetro del eje no se expone** (*"ofrecerle a un agente un filtro que siempre devuelve cero resultados es peor que no ofrecerlo — lo manda a reintentar contra una pared"*) | **(a) FIX** | Conservado y generalizado: `ejeHabilitado()`. La config dice QUÉ eje, el índice dice SI hay. Vale para los dos dialectos |
| M2 | `version` → `project` en `buscar()`, `leer()` y `feedback()` | **(b) DIALECTO** | `describirEje()` + `esquemaEje()`. Multivaluado en `buscar()`, escalar en `leer()` y `feedback()` — los tres repos coinciden en eso |
| M3 | oba: filtro `modules`; adhoc lo elimina (su fixture testea que *"no existe rastro de `modules` en ninguna respuesta"*) | **(c) DOMINIO** | `config.filtros.modules` |
| M4 | oba: prosa del `or-fallback` y de los artículos CROSS-VERSION en la descripción de `buscar()`; odumbo y adhoc la borran | **(a) FIX que casi se pierde** | **Medido**: `grep -c or-fallback lib/mcp/indice.mjs` → oba 3, odumbo 0, adhoc 0. La prosa no se borró por gusto: describe una capacidad que el motor de esos repos no tiene. Queda tras `capacidades.orFallback` y `eje.cross`. **Con esto, oba deja de perder la mejor descripción de tool de los tres al unificar** |
| M5 | adhoc: `leer()` ante un slug repetido devuelve la ambigüedad y no elige | **(b)+(a)** | `eje.desambiguaEnLeer` mete la frase en la descripción. La implementación es de `indice.mjs` (fuera de alcance), pero el contrato con el agente se declara acá |
| M6 | `feedback()` registrada solo `if (INTERNO)` (oba/odumbo) vs incondicional (adhoc) | **(a) FIX** | `if (conGate)`. En adhoc-docs, con `audiencias: ['interno']`, es siempre verdadero: mismo comportamiento, sin camino aparte |
| M7 | adhoc borra el import `FUZZY`, que oba y odumbo importan y **no usan** | (d) | Borrado (verificado: `FUZZY` solo aparece en la línea del import) |
| M8 | `serverInfo.name`, `instructions`, carteles público/interno, `title`s de las tools | **(c) DOMINIO** | Config. Las `instructions` de los tres son distintas y **tienen que serlo**: son el prompt del corpus |
| M9 | `todoCerrado()`: *"MCP interno sin DOCS_MCP_TOKENS"* vs *"MCP sin DOCS_MCP_TOKENS"* | (d) | *"MCP con auth sin DOCS_MCP_TOKENS"* |
| M10 | adhoc borra la nota honesta del transporte (*"la revisión 2026-07-28 eliminó las sesiones pero mcp-handler 2.1 negocia 2025-11-25"*) | (d) | **Se conserva la de oba**: es información que le ahorra media hora al próximo que debuguee el transporte |
| M11 | El índice se carga en scope de módulo, y si falla se guarda el error en vez de tirar al importar | — | Idéntico en los tres, conservado. Ahora vive dentro de la factory: una instancia por `crearMcp()`, mismo costo por instancia de Fluid Compute |

### Fix que este trabajo AGREGA (no estaba entero en ninguno)

**Fail-closed también en la capa función.** Los tres derivaban "¿lleva auth?"
de `DOCS_AUDIENCE === 'interno'` (adhoc: de nada, era incondicional). En oba y
odumbo, con la variable ausente `INTERNO` es `false` y **la función sirve el
MCP sin Bearer**; hoy no se nota porque el gate del edge corta antes, pero son
dos capas, y `middleware.js` documenta justamente el modo de falla en que la
función se invoca sin pasar por el gate (*"agregar un matcher para incluir
/api/mcp sería el bug, no el arreglo"*). Unificar sin este chequeo le sacaba a
adhoc-docs su Bearer incondicional. El handler ahora 503ea entero —GET
incluido— si `DOCS_AUDIENCE` no está en `config.audiencias`.

---

## Config resultante (una por corpus, `docs.mcp.config.mjs`)

Las tres, escritas contra el núcleo, están en `fixtures/configs.mjs` — y son
parte del entregable a propósito: **si alguno de los tres dialectos no se
puede expresar como config, la unificación es falsa** (el "falso positivo de
unificación" que nombra la spec). Los tres se expresan.

```
audiencias, audienciasConGate, cartelMcp{}   ← audiencia (gate + handler)
nombre, version, instructions, titulos{}     ← dominio
eje{param,duro,describe*,cross,...} | null   ← EJE (vocabulario abierto)
filtros{modules,seccion}                     ← dominio
capacidades{orFallback}                      ← capacidad real del motor
feedback{eje,notas}                          ← EJE + dominio
```

`api/mcp.mjs` de cada repo queda en cuatro líneas (ver encabezado de
`mcp-handler.mjs`), y `middleware.js` en dos: `crearGate(config)` + `next()`.

## Tests

`mcp.test.mjs` + `fixtures/`, adaptado del `tests/mcp.test.mjs` de adhoc-docs
(`node --test`, la convención que la spec declara "adelante"). **57 casos, 57
verdes** (`node --test` con `mcp-handler`/`zod` resueltos).

Dos cambios de fondo contra el original:

1. El original probaba el núcleo **y el motor** contra un `index.json` de
   fixture. El motor está fuera de alcance: el índice entra **inyectado**
   (`fixtures/indice-fake.mjs`, que no es un motor de búsqueda y lo dice) y lo
   que se prueba es el cableado. Los tests de `buscar`/`leer`/`normalizarTermino`
   del original le pertenecen a `indice.mjs` y viajan con él.
2. Cada caso corre **para los tres dialectos**. Un test que solo pasa con una
   config no prueba que el núcleo unifique.

Cobertura nueva respecto de los tres repos: el eje encendido/apagado por el
índice, el nombre del parámetro del eje en las tres tools, la prosa
condicionada por capacidad, `feedback` ausente en la audiencia pública, los
dos 503 de audiencia (edge y función), y el payload del issue en los tres
dialectos.

Sin red: el `fetch` de GitHub se stubea. Si el checkout no tiene
`mcp-handler`/`zod`, la franja del handler HTTP **se skipea explícitamente**
(41 casos verdes + 1 skip declarado) en vez de correr degradada.

---

## DUDAs

1. **Vocabulario del eje: cuánto queda como prosa declarada.** Hoy
   `config.eje` trae textos (`duro`, `describeBuscar`, `describeLeer`,
   `describeFeedback`, `cross`). Es honesto —no invento descripciones que
   ningún repo escribió— pero es config-de-strings.
   *Recomendación*: cuando el agente del eje cierre `eje: version | project |
   none`, esas cinco claves se derivan del nombre del eje y quedan solo como
   override opcional. `describirEje()` es el único lugar a tocar.

2. **`capacidades.orFallback` va a quedar obsoleta pronto.** Hoy es `true`
   solo en oba porque solo su `indice.mjs` tiene el fallback a OR. Al unificar
   el motor, la capacidad pasa a estar en los tres.
   *Recomendación*: que el flag lo emita **el índice** (como `versionado`), no
   la config del repo — el motor sabe qué sabe hacer. Mientras el motor esté
   forkeado, dejarlo en config es lo único verificable.

3. **`eje.avisaMezcla`** (el aviso de adhoc cuando un resultado mezcla varios
   projects) lo emite `indice.mjs`, no el handler. Lo declaré en el descriptor
   del eje para que el eje sea una sola declaración, pero el núcleo del MCP no
   lo usa.
   *Recomendación*: confirmarlo cuando se unifique `indice.mjs`; si el índice
   toma su config por otro camino, sacarlo de acá para no dejar config muerta.

4. **El 503 de la función ante audiencia ausente incluye el GET.** El GET
   informativo existe para el bug #82534 de Claude Code; con este cambio, un
   deployment mal configurado le devuelve 503 al preflight en vez del cartel.
   *Recomendación*: dejarlo así (un deployment sin audiencia declarada no
   debería atender), pero es un cambio de comportamiento observable para el
   consumidor y merece una línea en el changelog del paquete.

5. **`config.audiencias` duplica `docs.config.json`.** El gate corre en el
   edge y no puede leer el JSON; hoy la lista vive en el módulo de config JS.
   *Recomendación*: que el validador de schema de `docs.config.json` (mitigación
   de la etapa A) chequee que las dos listas coincidan. Es exactamente el tipo
   de drift silencioso donde empezó el fork.

6. **`serverInfo.version` está hardcodeada en `'1.0.0'` en los tres.**
   *Recomendación*: que el paquete la emita desde su propio `package.json`
   pineado — así un cliente MCP puede reportar contra qué versión de la
   plataforma habló. No lo cambié: sería inventar comportamiento.

7. **Guard de fuga y `middleware.js`** entran al paquete según la spec, pero
   no estaban en el alcance de este chat. El gate unificado asume que el guard
   sigue siendo del repo (`adhoc-docs` no lo tiene, y su 503 ante `publico` es
   hoy la única red).
