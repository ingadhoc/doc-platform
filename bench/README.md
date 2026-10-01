# Banco de medición de la búsqueda

Corre `buscar()` del motor contra el índice real de cada sitio y sus casos. Tarda unos segundos y no toca la red. Los casos y los índices no se versionan acá: los casos son de cada repo de contenido y `normalizar.mjs` los trae a `bench/casos/`. Sirve para medir un cambio del motor antes de publicarlo: se corre la versión actual, se corre la variante y se comparan caso por caso.

```bash
bench/indices.sh <dir>                        # índices desde origin/main de cada sitio (~15 s)
node bench/normalizar.mjs                     # casos de cada repo → bench/casos/
node bench/correr.mjs --indices=<dir>/indices --perfil=ambos --salida=antes.json
node bench/correr.mjs --indices=<dir>/indices --motor=<otro>/lib/mcp/indice.mjs --salida=despues.json
node bench/correr.mjs --comparar=antes.json,despues.json   # sólo los casos que cambian
```

Otras opciones de `correr.mjs`:

- `--suite=bench/suite-ciegos.json`: los casos a ciegas del set de ajuste.
- `--suite=bench/suite-validacion.json`: los del set de validación (ver abajo).
- `--solo=tuqui-docs`: una sola corrida.
- `--indice=… --casos=…`: un par suelto, sin suite.
- `--familias`: desglose por familia.
- `--md=reporte.md`: el reporte en Markdown.
- `--verboso`: todos los casos, no sólo los fallos.

En la suite, una corrida puede llevar `idioma` para los índices con idiomas: un código (`"es"`) se pasa en cada consulta, `"caso"` pasa el `idioma` de cada caso, `"mezcla"` busca en todos los idiomas y junta por score relativo (sólo para medir esa alternativa), y sin el campo no se pasa nada (el motor detecta). `tuqui-docs-bilingue.json` lo genera `indices.sh` con `tools/emitir-indice-bilingue.mjs` de tuqui-docs, si el repo lo trae.

El motor se importa por path (`--motor`) y se le cambia el índice con `DOCS_INDICE_PATH` + `_resetIndice()`. Un motor anterior a `PERFIL` (< v0.14.0) sólo corre el perfil `agente`. Una corrida cuyo índice o archivo de casos no existe se saltea y lo dice.

## Formato único de casos

`{ sitio, origen, casos: [...] }`, el mismo en `bench/casos/` y en `evals/busqueda/` de cada repo (ahí `origen` sobra: lo pone `normalizar.mjs`). Cada caso tiene:

| campo | qué es |
|---|---|
| `id`, `familia`, `q` | identificador, agrupador y consulta |
| `filtros` | argumentos extra de `buscar()`, por ejemplo `{ version: "19" }` |
| `tipo` | `ranking` (tiene respuesta), `declinar` (el corpus no la tiene) o `regresion` (sin oráculo: sólo tasas y `--comparar`) |
| `esperado` / `tope` | slugs que valen (alcanza con uno) y puesto máximo que cuenta como acierto |
| `esperadoArchivo` | en lugar de `esperado`: archivos fuente. Se traducen al slug con la regla `archivoASlug` de la suite. Si ninguno existe en ese índice, el caso queda como `no-medible` |
| `acepta` | en `declinar`, qué señales cuentan: `cero`, `or-fallback`, `nota-pobreza` |
| `idioma` | el idioma de la pregunta (`es`, `en`) |
| `brechaConocida` | el repo de origen ya lo marca como falla esperada |

## De dónde salen los casos

`normalizar.mjs` lee de cada clon (`--clones=~/repositorios`, un directorio por repo: `oba-docs`, `odumbo-docs`, `adhoc-docs` y `tuqui-docs`, que es `Tuqui-AI/docs`) la rama `--ref` (por defecto `origin/main`) con `git show`, sin cambiar de rama ni tocar el árbol de trabajo. No agrega ni quita casos.

Los golden sets que cada repo ya tenía, cada uno en su formato, se traducen a `bench/casos/<sitio>.json`:

- **oba-docs**: `scripts/golden/consultas.json`. `casos` pasa a `ranking` y `sinRespuesta` a `declinar`, todo con `version: 19` como en su runner.
- **adhoc-docs**: las consultas `buscar` del corpus real de `golden/consultas.mjs`. 06 y 11 pasan a `declinar` (su README dice qué se espera de ellas) y el resto a `regresion`, porque el set no afirma slugs. Las del fixture quedan afuera.
- **tuqui-docs**: `evals/casos.json`. `top1`, `top3` y `alguno` pasan a `ranking` con tope 1, 3 y 3; `declina` pasa a `declinar` con su oráculo (cero u or-fallback).
- **odumbo-docs**: no tiene casos de búsqueda.

Los sets a ciegas ya vienen en el formato del banco y se copian tal cual, después de verificar que cada caso tenga lo que su `tipo` pide:

| en el repo de contenido | en el banco | suite |
|---|---|---|
| `evals/busqueda/ciegos.json` | `bench/casos/ciegos/<sitio>.json` | `suite-ciegos.json` |
| `evals/busqueda/validacion.json` | `bench/casos/validacion/<sitio>.json` | `suite-validacion.json` |

Nombran el archivo fuente (`esperadoArchivo`), no el slug, y tienen tope 3. `ciegos` es el set de **ajuste**: con él se eligen las variantes del motor. `validacion` se escribe después, sobre otros artículos, y **no se usa para ajustar**: se corre al final para confirmar; si una variante se elige mirándolo, deja de servir. Cada repo explica sus sets en `evals/busqueda/README.md`.

Un repo sin un set no genera el archivo (y si había uno de otra corrida, lo borra). Para medir un set antes de que llegue al repo, `--evals=<dir>` lo lee de `<dir>/<sitio>/evals/busqueda/` en disco; los golden sets siguen saliendo de los clones.

## Métricas

`@1`, `@3`, `MRR` (1/puesto dentro de la primera página del motor medido —20 hits hasta v0.20.0, 10 desde v0.21.0—, o 0) y `ok@tope` se calculan sobre los casos `ranking`. `cero`, `or-fallback` y `rescate` (rescate de tipeo) son tasas sobre todos los casos. `declina` es aciertos/total de los casos `declinar`. `débil decl` cuenta los `declinar` que vuelven con `resultadosDebiles` (v0.19.0) y `débil rank@3` es la tasa de casos `ranking` resueltos en el top 3 que vuelven marcados igual: la primera tiene que ser alta y la segunda baja. `tamaño` es lo que pesa la respuesta de `buscar()` tal como la manda la tool MCP (`JSON.stringify(…, null, 2)`): promedio, p50 y p90 en bytes, y tokens aproximados como bytes / 3,5. La línea base de cada sitio está en el `evals/busqueda/README.md` de su repo; los reportes locales (`--md`, `--salida`) van en `bench/resultados/`, que no se versiona.
