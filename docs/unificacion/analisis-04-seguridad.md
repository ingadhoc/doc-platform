# Capa de seguridad — best-of-three (etapa A)

Unificación del gate del edge y del guard de fuga de `oba-docs`, `odumbo-docs`
y `adhoc-docs`. Snapshots read-only del 23/08; ningún repo real fue tocado.

**Regla aplicada:** en seguridad no se relaja nada para unificar. Ante dos
severidades distintas gana la más estricta, y la diferencia se anota como DUDA.
Lo que se rescató de cada repo está abajo, con la evidencia de que la suite
unificada lo distingue.

---

## Foto medida (md5 de los archivos de la capa)

| archivo | oba-docs | odumbo-docs | adhoc-docs |
|---|---|---|---|
| `middleware.js` | `af500fb…` | `40683c7…` | `a514b1f…` |
| `lib/mcp/gate.mjs` | `940c227…` | `5a807c2…` | `6a9f402…` |
| `scripts/guard-fuga.mjs` | `c67514d…` | **`c67514d…` (idéntico)** | **no existe** |
| `scripts/test-bloques.mjs` | `0329fbc…` | `a134506…` | no existe |
| `scripts/test-middleware.mjs` | `f65c8f6…` | `93e0a00…` | `cb446ed…` |
| `tests/fixtures-bloques/` | 4 archivos | 5 (suma `substring.md`) | no existe |
| `.gitattributes` (crlf) | **no existe** | existe | no existe |

Dato que ordena todo lo demás: **el cuerpo ejecutable de `middleware.js` es
idéntico en los tres** (7 líneas: `import next`, `import decidir`, la función).
Lo que divergió es el comentario de cabecera y, sobre todo, `gate.mjs` — que es
donde vive la decisión. Un "best-of-three de middleware.js" que no toque
`gate.mjs` no unifica nada.

---

## 1. `middleware.js` + `gate.mjs` (el gate del edge)

### El hallazgo que manda: oba-docs es el MENOS estricto de los tres

```js
// oba-docs/lib/mcp/gate.mjs  — lo que había
if (env.DOCS_AUDIENCE !== 'interno') return null;   // ← público POR DESCARTE
```

Sin `DOCS_AUDIENCE` seteada, el sitio interno **sirve todo sin gate**. No es
teórico: las env vars de Vercel se hornean en el build, así que un deployment
buildeado antes de que la variable existiera queda sin gate para siempre (ya le
pasó a oba-docs, está en la spec de hosting). odumbo-docs y adhoc-docs tenían
el fix, cada uno a su manera:

| repo | qué hace sin `DOCS_AUDIENCE` | severidad |
|---|---|---|
| oba-docs | pasa (sitio abierto) | ✗ el agujero |
| odumbo-docs | 503 si el valor no está en `AUDIENCIAS = ['publico','interno']` (lista inline, comentada como "la única duplicada del repo") | ✓ |
| adhoc-docs | 503 si el valor no es exactamente `'interno'` (gate incondicional, una sola audiencia) | ✓ |

**Veredicto (FIX a conservar):** el fail-closed entra, y entra generalizado.
`decidir(request, env, { audiencias })` recibe la lista de audiencias que el
repo sabe servir; cualquier valor fuera de esa lista —incluida la ausencia— es
503, y el 503 corta **todo**: HTML, índice de búsqueda, assets y el MCP incluso
con un Bearer válido. El eje se encapsuló como argumento, no como `if` por repo:

```js
// middleware.js del consumidor — EJE (audiencia)
const AUDIENCIAS = ['publico', 'interno'];   // adhoc-docs: ['interno']
decidir(request, process.env, { audiencias: AUDIENCIAS });
```

**Default = `['interno']`** (el más estricto). Un consumidor que se olvida de
declarar la lista obtiene el comportamiento de adhoc-docs (gate encendido,
audiencia pública imposible), no el de oba-docs (abierto por descarte). Si el
olvido tiene que costar algo, que cueste disponibilidad. → **DUDA 2.**

### Clasificación del resto de las diferencias

| diferencia | clasificación | veredicto |
|---|---|---|
| `"Sitio interno mal configurado"` (oba) vs `"Sitio mal configurado"` (odumbo/adhoc) | FIX menor | gana el genérico: el 503 lo ve cualquiera y no tiene por qué contar que detrás hay un sitio interno. Hay test que lo verifica sobre el body. |
| Doc de cabecera: "los previews entran por la misma puerta" + "las env vars se hornean en el build" | FIX (documental) sólo en adhoc-docs | entra al `middleware.js` unificado como regla 3, con su test negativo. |
| Doc de cabecera: "el gate no se desarma en un sitio público porque una ausencia no se revisa en un PR" | FIX (documental) sólo en odumbo | entra. |
| Doc de cabecera: "el guard de fuga NO está acá y hay que decirlo en voz alta" | DOMINIO (adhoc-docs) | se reescribe como regla general: declarar `publico` sin guard en el buildCommand es publicar sin red. |
| `AUDIENCIAS` inline (odumbo) vs constante `AUDIENCIA = 'interno'` (adhoc) | DIALECTO del eje | encapsulado en el argumento `audiencias`. La lista sigue viajando por código porque **el edge no lee del filesystem** → duplicada con `docs.config.json` → **DUDA 6**. |
| textos del `REALM`, cartel del MCP, `RUTA_MCP`, `equal()` en tiempo constante, recorrido completo de tokens sin cortar por timing, `pedirToken()` sin challenge Basic, headers `no-store` + `X-Robots-Tag` | idénticos | se conservan tal cual, con sus comentarios de por qué (bug #82534 de Claude Code, `extractWWWAuthenticateParams` del TS SDK, realm ASCII). |
| fail-closed **por capa** de `DOCS_AUTH_PASSWORD` (sin contraseña, los humanos no entran pero las máquinas con Bearer válido siguen) | igual en los tres | se conserva: rotar la contraseña no tiene por qué tirar el MCP. |

### Evidencia de que la suite unificada discrimina

`middleware.test.mjs` (51 casos) corrido contra los tres gates originales:

```
gate de oba    → 10 fails  (los 9 de fail-closed de audiencia + el preview horneado sin vars)
gate de odumbo →  2 fails  (sólo porque no acepta el argumento `audiencias`; no le falta ninguna protección)
gate de adhoc  →  2 fails  (sólo los dos casos de sitio público, que ese repo no puede servir)
gate unificado → 51/51 ✓
```

Es la medición de la asimetría: al de oba le faltan protecciones; a los otros
dos les falta el parámetro del eje.

---

## 2. `scripts/guard-fuga.mjs` (el guard de fuga)

**En oba-docs y odumbo-docs este archivo era byte-idéntico** (`c67514de…`): no
hubo divergencia de comportamiento que laudar. Todo su valor está en tres
decisiones que ya tenía y que se conservan textuales, con su comentario:

1. **La audiencia esperada sale de `VERCEL_PROJECT_ID` contra el mapa
   `proyectos` de `docs.config.json`, NO de `DOCS_AUDIENCE`.** La versión vieja
   comparaba `$DOCS_AUDIENCE` contra `generated.json.audience`, que el
   preprocesador escribe *desde* `$DOCS_AUDIENCE`: una tautología que aprobaba
   exactamente el modo de falla que decía atacar.
2. **Las sondas las calcula el preprocesador** y viajan en
   `.guard/removido.json`. Dos parsers del mismo formato divergen, y cuando
   divergen el guard aprueba justo la fuga que el preprocesador dejó pasar.
3. **"No pude verificar" es FALLA, no aviso.**

Más los fixes finos del escaneo, que se conservan: sondas = **trigramas** (con
palabras sueltas bloqueó un deploy real por `database`/`responder`/`timeout` del
bundle de React), tags HTML removidos antes de normalizar, JSON decodificado con
`JSON.parse` (y no con regex sobre los escapes, que ciega el guard en
`C:\temp`), límites de palabra con lookaround en vez de `\b` (que es ASCII y se
rompe con acentos), lotes de 150 sondas por regex, y el índice del MCP
(`api/_generated/index.json`) sumado al escaneo porque vive fuera de la salida
del sitio y es el artefacto con el cuerpo entero de cada artículo.

### Lo que cambió

**a) Paths por config/argumento** (`--salida`, `--generated`, `--manifiesto`,
`--extra`, `--indice`, `--config`, y `docs.config.json → guard: {...}`), con los
defaults idénticos a los de hoy. Es lo mínimo para que el mismo archivo sirva a
tres repos con layouts distintos: DOMINIO por config, sin `if (repo === …)`.

**b) Cuatro refuerzos de estrictez** (marcados `ESTRICTEZ+` en el código):

| # | qué | por qué |
|---|---|---|
| a | `docs.config.json` ilegible → falla con nombre | antes era una excepción sin manejar: fallaba el build sin decir qué pasó, y cualquier refactor que la envolviera en un `try` silencioso dejaba el guard sin contrato |
| b | falta `audiences` en el contrato → falla con nombre | antes `CFG.audiences.includes()` tiraba `TypeError` |
| c | **`--esperada` se rechaza corriendo en Vercel** | antes se ignoraba en silencio. El buildCommand vive en las settings del proyecto: si pasarlo funcionara —o pareciera funcionar— sería el camino corto para neutralizar la fuente independiente sin tocar el repo → **DUDA 3** |
| d | el chequeo de `.guard` dentro de la salida sale del `if (sondas.length)` | un build sin sondas podía llevarse el `.guard/` entero (contenido interno en texto plano) adentro del artefacto público sin que nadie lo mirara |

**c) Suite propia.** El guard sólo se ejercitaba de rebote desde
`test-bloques.mjs`, y sólo en el camino feliz y el falso positivo.
`guard.test.mjs` son 29 casos que arman un repo de mentira en un temporal y
corren el guard de verdad: tautología de `DOCS_AUDIENCE`, audiencia cruzada,
proyecto no mapeado, manifiesto ausente / de otro build / sin sondas
discriminantes, fuga en HTML, fuga partida por tags, fuga en JSON escapado, fuga
en JSON roto, fuga en `api/_generated`, sondas con acentos, salida vacía,
`.guard` en la salida, y los dos falsos positivos.

**El guard entra a adhoc-docs por el paquete** (ADR 0007 + Fase 0 punto 4), pero
no alcanza con copiar el archivo → **DUDA 1**.

---

## 3. Fixtures de seguridad + `bloques.test.mjs`

### Las dos formas de escribir la directiva, y la tercera

Los fixtures son memoria de incidentes: cada uno es una forma de marcar
contenido interno que **en su momento se publicó** por un bug del
preprocesador. Las dos sintaxis que el título de la tarea nombra son:

- `:::interno` — tres puntos, la canónica;
- `::::interno` — **cuatro puntos**, anidado válido en Docusaurus. El patrón
  viejo pedía `:::` exacto, no matcheaba, y **el bloque se publicaba entero**.
  El fix vive en el regex `^\s*(:{3,})(interno|solo-version)…` y el cierre
  exige al menos tantos `:` como la apertura, igual que remark-directive.

Más la tercera vía, que también borra contenido: `audience: interno` en el
frontmatter (archivo completo). Y el caso del **code fence**: un `:::` dentro de
un ```` ```yaml ```` cerraba el bloque antes de tiempo y publicaba el resto
(`zanahoriadespuesdelfence`).

### CRLF: cómo se resolvió sin `.gitattributes`

`odumbo-docs` tenía `.gitattributes` con `tests/fixtures-bloques/manual/crlf.md
-text`, y el comentario explica por qué: un script que copió el molde reescribió
el fixture en modo texto y le normalizó los finales de línea, dejando el test
verde midiendo LF. **oba-docs y adhoc-docs no tienen ese `.gitattributes`** —
o sea que el fixture de oba está hoy a merced de la próxima herramienta que lo
toque.

Unificado: `fixtures/manual/crlf.md.tpl` se guarda con LF (git no tiene nada que
normalizar) y **el test lo materializa convirtiendo a `\r\n` en runtime**, más
un caso que **verifica los bytes antes de buildear**. Si algo lo normaliza, el
test lo dice en vez de probar LF en silencio. `.gitattributes` deja de ser un
requisito de correctitud; los repos que igual conserven un fixture CRLF
commiteado deberían mantener la línea (cinturón y tiradores).

### Falso positivo del guard

`substring.md` existe **sólo en odumbo-docs** (es uno de los fixes que el
sembrado descubrió y que la Fase 0 manda portar a oba-docs): el trigrama interno
`dias corridos si` es substring del público `dias corridos sin rechazo`. Sin
límites de palabra, el guard bloqueaba un deploy limpio. Entra al set unificado
—con su centinela `zanahoriasubstring`— y ahora corre también en oba-docs
(verificado: pasa en los dos repos).

### Diferencias de `test-bloques.mjs`, clasificadas

| diferencia | clasificación | veredicto |
|---|---|---|
| `POC_CONTENT`/`POC_VERSIONS` (oba) vs `DOCS_CONTENT` (odumbo) | DIALECTO del eje | el test setea los dos nombres; sin daño, y desaparece cuando `build.mjs` se unifique |
| frontmatter con `versions: ["19"]` (oba) vs sin `versions` (odumbo) | DOMINIO por config | el test lee el `docs.config.json` del consumidor y **inyecta** `versions:` sólo si el repo es versionado |
| `zanahoriasubstring` sólo en odumbo | FIX a conservar | entra al set |
| dos scripts a mano con contador de `fallas` | ruido | reemplazados por `node --test` |

### Lo que la suite unificada agrega

- **Control negativo que ninguno de los tres tenía:** primero corre el build
  **interno** y exige que los seis centinelas **estén**. Sin eso, el test de "no
  se publica" pasa igual con fixtures vacíos o con un build que no emite nada.
- `:::INTERNO` en mayúsculas sumado a las directivas mal escritas.
- Asserts sobre el mensaje del fail-closed (`directiva no reconocida`), no sólo
  sobre el exit code.
- Skip explícito y con motivo cuando el repo no declara la audiencia `publico`
  (adhoc-docs): un caso sin su capability se skipea, no se corre degradado.
- Un `todo` que deja visible el agujero medido en **DUDA 4**.

---

## Entregables y cómo se corren

```
04-seguridad/
├── middleware.js          # pegamento en la raíz del consumidor (EJE: AUDIENCIAS)
├── gate.mjs               # la decisión (va al paquete) — ver DUDA 7
├── guard-fuga.mjs         # el guard (va al paquete)
├── middleware.test.mjs    # 51 casos
├── guard.test.mjs         # 29 casos
├── bloques.test.mjs       # 27 casos (26 + 1 todo); skip si el repo no publica
├── fixtures/manual/       # variantes.md, archivo-entero.md, substring.md, crlf.md.tpl
└── tokens.mjs             # copia de apoyo para que la suite corra acá (NO es entregable: es de lib/mcp/)
```

```bash
node --test middleware.test.mjs guard.test.mjs          # sin dependencias, corre en cualquier parte
DOCS_REPO=~/repositorios/oba-docs node --test bloques.test.mjs
# overrides: DOCS_GATE_PATH, DOCS_MIDDLEWARE_PATH, DOCS_GUARD_PATH
```

Resultado medido acá: `middleware` 51/51, `guard` 29/29, `bloques` 26/26 + 1
todo contra oba-docs y contra odumbo-docs, y skip declarado contra adhoc-docs.

---

## DUDAS (lo que no cierro solo)

1. **El guard en adhoc-docs necesita más que el archivo.** Su `build.mjs` no
   tiene bloques `:::interno`, no emite `site/generated.json` con `audience` y
   su `docs.config.json` no tiene mapa `proyectos` (tiene `projects`, que es
   otra cosa: el registro de repos fuente). Con el guard tal cual, su build
   fallaría de arranque por "no existe site/generated.json". Las dos salidas:
   (a) adhoc-docs emite `audience` en `generated.json` y declara `proyectos`
   —mínimo para que el guard valide audiencia cruzada—, o (b) la ausencia se
   declara en `docs.config.json` con `motivo`, como el opt-out del registro
   (Fase 0 punto 4). **La estricta es (a)**; la decisión es de jjs.
2. **El default `audiencias = ['interno']`.** Un consumidor público que se
   olvide de declarar la lista se cae con 503 en vez de servir. Elegí
   disponibilidad-cae sobre fuga-silenciosa; confirmar que es el trade que
   quiere el dueño (y que el drift-check del CI lo agarra antes que un usuario).
3. **`--esperada` rechazado en Vercel.** Si algún `buildCommand` actual de los
   tres proyectos lo pasa, ese deploy pasa a fallar al adoptar el paquete. Hay
   que leer los tres buildCommand antes de publicar el tag. No pude verificarlos
   desde los snapshots.
4. **MEDIDO: el fail-closed del preprocesador emite y después falla.** Con
   `::: interno` (directiva mal escrita), oba-docs escribe
   `site/docs/manual/mal.md` **y** `site/static/agente/md/19/manual/mal.md` con
   la línea interna adentro, y recién después sale con exit 1. Hoy no fuga
   porque el `buildCommand` encadena con `&&` y el deploy se aborta: la
   protección está en el operador, no en el programa. Un `;` en lugar del `&&`,
   o un paso que reutilice `site/`, lo publica. Queda como `todo` en la suite;
   el arreglo es de la unificación de `build.mjs`.
5. **Límites heredados del enfoque léxico, sin resolver:** números y strings de
   menos de 5 caracteres nunca tienen sonda (una clave `4821`, una sigla),
   imágenes y adjuntos no se escanean, y una fuga dentro de `applyBlocks` no
   genera sonda. Está documentado en el header del guard; lo digo acá porque es
   la parte que un lector puede confundir con cobertura.
6. **La lista de audiencias queda duplicada** (`docs.config.json` +
   `middleware.js`), y no hay forma de evitarlo: el edge no lee del filesystem.
   Necesita un caso del drift-check del CI que compare las dos.
7. **Solape de ownership con la capa MCP:** `gate.mjs` vive en `lib/mcp/`, que
   es de otro chat de esta etapa. El único cambio de contrato que introduzco es
   la firma: `decidir(request, env, { audiencias })`, con default estricto y
   retro-compatible en los dos primeros parámetros. Hay que mergearlo con lo
   que salga de ahí, no elegir uno de los dos.
8. **`bloques.test.mjs` escribe en `<repo>/site/`** porque en oba y odumbo el
   `build.mjs` tiene la salida hardcodeada (`SITE = ROOT/site`); adhoc-docs ya
   soporta `POC_OUT`. Cuando `build.mjs` se unifique, adoptar `POC_OUT`/`DOCS_OUT`
   y el test deja de pisar el árbol del repo. Mientras tanto está documentado en
   el header: después de correr la suite hay que regenerar con `npm run gen`.
