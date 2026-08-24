# La unificación, con su evidencia

Estos documentos son el insumo de la Etapa A: el relevamiento archivo por
archivo de los tres forks (`oba-docs`, `odumbo-docs`, `adhoc-docs`) con
`archivo:línea` sobre snapshots read-only, y las decisiones de diseño que
salieron de ahí. **No son documentación de uso** (eso es el `README.md` del
paquete): son la razón por la que el código es como es, y el registro de qué
fix salió de qué repo.

Se conservan tal como los escribieron los cuatro análisis, incluidos sus
DUDAs — salvo este índice, que dice qué pasó con cada una al ensamblar.

| Documento | Qué trae |
|---|---|
| [`diseno-eje.md`](./diseno-eje.md) | **la autoridad de diseño del contrato**: el eje como objeto, la regla única de `leer()`, el formato del id, `schemaVersion`, y la tabla campo por campo de los tres configs |
| [`docs.config.schema.json`](../../schema/docs.config.schema.json) | el schema publicado (vive en `schema/`, no acá: es contrato, no evidencia) |
| [`mapeo-configs.md`](./mapeo-configs.md) | los tres `docs.config.json` de hoy traducidos, listos para copiar, y qué código de cada repo cambia |
| [`contrato-indice.md`](./contrato-indice.md) | el segundo contrato (índice ↔ motor): lo que emite cada build hoy, medido, y el unificado |
| [`analisis-02-indice.md`](./analisis-02-indice.md) | 41 diferencias del motor de búsqueda: 17 fixes, 9 dialecto, 5 dominio, 10 ruido |
| [`analisis-03-nucleo.md`](./analisis-03-nucleo.md) | gate, auth, tokens, feedback y el handler del MCP; y la corrección de premisa: el que **no** tenía el fail-closed era oba-docs |
| [`analisis-04-seguridad.md`](./analisis-04-seguridad.md) | el gate del edge y el guard de fuga, con la medición de la suite unificada contra los tres gates originales (oba: 10 fails) |

## Qué DUDA cerró el ensamble, y con qué

| DUDA | Cómo quedó |
|---|---|
| 02-1 `audience` vs `audiencia` | **`audiencia`**, una sola clave (diseno-eje §7). El fallback a `DOCS_AUDIENCE` se conserva; el segundo nombre del campo, no |
| 02-2 id con eje `none` | `*::slug` — el `*` se lee "aplica a todos" y lo emite el build, no el lector |
| 02-3 aviso de mezcla con eje `version` | **encendido** para los dos ejes: mezclar la 18 con la 19 sin atribuir es tan caro como mezclar `oba` con `odumbo` |
| 02-5 `latest` con eje `project` | imposible por construcción: el default es del eje, y el validador exige que sea uno de sus valores |
| 02-6 defaults de las facetas por eje | salen de `build.metadata`, no del tipo de eje. La correlación era histórica |
| 03-1 prosa del eje en la config | derivada del `tipo` en `describirEje()`; la config sólo puede pisarla |
| 03-2 `capacidades.orFallback` | **borrada**: el motor es uno y lo tiene siempre |
| 03-3 `avisaMezcla` en el descriptor del handler | sacada de ahí: la emite el índice |
| 03-7 / 04-7 guard y `gate.mjs` en dos chats | mergeados: la fábrica de 03 con la estrictez de 04, y las dos suites verdes |
| 02-4 comodín: ¿del eje o del corpus? | **abierta** — ver "Para jjs" §6 del README |
| 02-7 la spec dice "vitest" | **abierta**: hay que corregir esa línea de la spec |
| 03-4 el 503 incluye el GET | **decidida** (el 503 corta todo) y anotada en el CHANGELOG como cambio observable |
| 03-5 / 04-6 audiencias duplicadas | **abierta**: falta el caso de CI que compare las dos listas |
| 03-6 `serverInfo.version` hardcodeada | **abierta**: no se cambió, sería inventar comportamiento |
| 04-1 el guard en `adhoc-docs` | **abierta**: es el punto 3 de "Para jjs" |
| 04-2 default `audiencias: ['interno']` | adoptado (gana la estricta); queda a ratificar por el dueño |
| 04-3 `--esperada` en los buildCommand | **abierta**: hay que leer los tres antes de taggear |
| 04-4 el preprocesador emite y después falla | **abierta**: `todo` declarado en la suite; lo arregla la unificación de `build.mjs` |
| 04-5 límites léxicos del guard | documentados en el header del guard y en el README |
| 04-8 `bloques.test.mjs` escribe en `site/` | **abierta** hasta que `build.mjs` acepte una salida configurable |
