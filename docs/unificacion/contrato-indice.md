# El segundo contrato: índice ↔ motor de búsqueda / MCP

El primero es `docs.config.json` (config ↔ plataforma). Este es el que el
`build.mjs` **emite** y `lib/mcp/indice.mjs` **lee**. La spec pide
`schemaVersion` en los dos (spec:76-78) y es el que más barato se rompe en
silencio: un índice con un campo que cambió de nombre no falla, devuelve
resultados vacíos con cara de resultado.

## 1. Los artefactos (idénticos en los tres repos)

| Artefacto | Quién lo lee | `body` |
|---|---|---|
| `api/_generated/index.json` | la función MCP (`lib/mcp/indice.mjs`) | **sí** |
| `site/static/agente/index.json` | quien lo baje estático | no |
| `site/static/agente/md/<…>.md` | quien no habla MCP | (el .md **es** el body) |

Emisión: oba build.mjs:998-1013, odumbo :685-701, adhoc :691-704. La copia
estática es el mismo objeto sin `body` (`articulos.map(({body, ...resto}) => resto)`).

## 2. Lo que emite cada build hoy — relevado

### Bloque `build`

| Campo | oba | odumbo | adhoc |
|---|---|---|---|
| `audience` | ✓ (:985) | ✓ (:664) | — |
| `audiencia` | — | — | ✓ (:679) |
| `generatedAt` | ✓ | ✓ | ✓ |
| `articulos` (conteo) | ✓ | ✓ | ✓ |
| `latest` | ✓ (:990) | ✓ sólo si versiona (:673) | — |
| `versionado` | — | ✓ (:670) | — |
| `projects: [{id,label}]` | — | — | ✓ (:684) |
| `manifiesto` | — | — | ✓ (:685), puede ser `null` |

### Nodos de `mapa` (nivel 1, progressive disclosure)

| Campo | oba | odumbo | adhoc |
|---|---|---|---|
| `seccion` | ✓ | ✓ | — (su nivel 1 es `project`) |
| `project` | — | — | ✓ (:659) |
| `categoria` | ✓ | ✓ | ✓ |
| `label` | ✓ (de `_categoria.json`) | ✓ + fallback `'Inicio'` | ✓ + fallback al label del registro |
| `count` | ✓ | ✓ | ✓ |
| `modules` (agregado) | ✓ (:978) | ✓ (emitido siempre) | — |
| `versions` (agregado) | ✓ (:993) | sólo si versiona (:678) | — |

Detalle que importa: el mapa de oba/odumbo está **agregado** — la clave es
`(seccion, categoria)` y las versiones se listan dentro del nodo (:966-980),
porque el mismo árbol existe en 19 y en 18. El de adhoc está **particionado** por
`project` (:653-666), porque los árboles son distintos.

### Entradas de `articulos`

| Campo | oba | odumbo | adhoc |
|---|---|---|---|
| `slug` | ✓ | ✓ | ✓ |
| `version` | ✓ (`null` = fuera del eje) | ✓ (siempre `null`) | — |
| `project` | — | — | ✓ |
| `title` | ✓ | ✓ | ✓ (frontmatter **o** primer `# H1`, :328) |
| `description` | ✓ (`''` si falta) | ✓ | ✓ |
| `keywords: [str]` | ✓ (obligatorio en el lint, :537-548) | ✓ | ✓ (sólo warning, :345-349) |
| `seccion` | ✓ | ✓ | ✓ (subárbol **dentro** del project, :322-323) |
| `url` | ✓ relativa (`/19/manual/…`) | ✓ | ✓ |
| `headings: [{id,text,level}]` | ✓ (:888-917) | ✓ | ✓ |
| `body` | ✓ sólo en `api/` | ✓ | ✓ |
| `modules` | ✓ si el fm lo trae (:955) | ✓ si el fm lo trae | — (:618, a propósito) |
| `type` | — | — | ✓ si el fm lo trae (:648) |
| `id` | **no se emite** (lo compone el lector, indice.mjs:170) | idem (:106) | idem (:119) |

### Lo que el lector consume (para no emitir de menos)

- Indexado por MiniSearch, los tres iguales: `['title','keywords','headingsText','description','body']`
  (oba indice.mjs:123, odumbo :59, adhoc :72). `headingsText` **no se emite**: lo
  deriva el lector de `headings` (adhoc build.mjs:625-627 explica por qué).
- `storeFields`: oba/odumbo `[slug, version, title, description, url, headings,
  seccion, modules]`; adhoc `[slug, project, title, description, url, headings,
  seccion, type]`.
- Los sidecars `md/` llevan frontmatter propio: oba/odumbo
  `{title, description, url, versions?}` (build.mjs:1008-1012), adhoc
  `{title, description, project, url}` (:701-704).

## 3. El índice unificado — `schemaVersion: 1`

```json
{
  "schemaVersion": 1,
  "build": {
    "audiencia": "interno",
    "generatedAt": "2026-08-23T11:00:00.000Z",
    "articulos": 754,
    "conCuerpo": true,
    "eje": {
      "tipo": "version",
      "default": "19",
      "valores": [
        { "id": "19", "label": "19.0" },
        { "id": "18", "label": "18.0" }
      ]
    },
    "metadata": { "modules": true, "types": [] },
    "manifiesto": null
  },
  "mapa": [
    {
      "seccion": "manual",
      "categoria": "ventas",
      "label": "Ventas",
      "count": 12,
      "ejeValores": ["18", "19"],
      "modules": ["sale"]
    }
  ],
  "articulos": [
    {
      "id": "19::manual/ventas/notas-de-credito",
      "slug": "manual/ventas/notas-de-credito",
      "eje": "19",
      "title": "Notas de crédito",
      "description": "…",
      "keywords": ["nota de credito", "reembolso"],
      "seccion": "manual",
      "url": "/19/manual/ventas/notas-de-credito",
      "headings": [{ "id": "emitirla", "text": "Emitirla", "level": 2 }],
      "modules": ["sale"],
      "body": "…"
    }
  ]
}
```

### Las decisiones, campo por campo

1. **`schemaVersion` en la raíz**, no dentro de `build`: versiona el sobre, y el
   lector lo chequea antes de mirar nada más. Misma regla que el config: tira si
   el emisor es más nuevo; un índice **sin** el campo es pre-unificación y falla
   con un mensaje que dice "corré el build del paquete nuevo".

2. **`build.audiencia`** (una sola clave, castellano). Gana el argumento que
   adhoc ya escribió en build.mjs:671-678 ("dos claves para el mismo dato es la
   doble fuente que se pudre"). Costo medido en oba-docs:
   `scripts/guard-fuga.mjs:89` y `:111-112`, `site/docusaurus.config.js:9` y
   `:70`, y los fallbacks `indice.mjs:214` / odumbo `:154`.

3. **`build.eje` reemplaza a `versionado` + `latest` + `projects`.** Un solo
   objeto, la misma forma que en el config (§1 de `diseno-eje.md`), y de ahí sale
   todo lo que el MCP hoy resuelve con tres campos distintos:
   - `tipo` reemplaza al booleano `versionado` (odumbo build.mjs:670 → lector
     indice.mjs:153) y decide si las tools exponen el filtro del eje
     (odumbo api/mcp.mjs:73-76);
   - `default` reemplaza a `latest` (oba build.mjs:990 → lector indice.mjs:216 →
     desambiguación en leer(), :550-553);
   - `valores` reemplaza a `projects` (adhoc build.mjs:684 → lector indice.mjs:130).
     **Sólo los valores activos** viajan al índice (adhoc ya lo hace así: emite
     `PROJECTS`, filtrado por `activo`, build.mjs:98). Los apagados no son
     contenido: son registro.

   Beneficio directo: se puede borrar la tolerancia de `projectsDeclarados()`
   (adhoc indice.mjs:126-136, que acepta strings **o** objetos "porque el
   contrato de la PoC dice 'la lista de projects' sin fijar la forma"). Con
   schema, la forma está fijada: el lector deja de adivinar.

4. **`articulos[].eje`** (string | `null`) reemplaza a `version` y a `project`.
   `null` = fuera del eje (el cross-version de hoy). Es el campo que hace que
   `pasaFiltros`, `hitDe`, `leer()` y los hints sean **un** código y no tres. La
   palabra de dominio (`version`/`project`) vive sólo en la superficie MCP
   (§4 de `diseno-eje.md`), no en el índice.

5. **`articulos[].id` lo emite el build**, con formato
   `` `${eje ?? '*'}::${slug}` `` (§2 de `diseno-eje.md`). Hoy lo compone el
   lector en tres lugares y oba emite de hecho ids `"null::relacion/…"`.

6. **`mapa[].ejeValores`** reemplaza a `versions`, y el mapa queda **agregado por
   `(seccion, categoria)`** para los dos ejes. Con `tipo: "project"` la
   agregación es un no-op porque el slug ya arranca con el project, así que
   `seccion`/`categoria` no colisionan entre projects — y el nodo gana el dato
   que hoy le falta: de qué valor(es) del eje viene. Con `none`, `ejeValores` se
   omite. El `label` conserva la cadena de fallbacks de cada repo (categoría →
   sección → label del valor del eje → `'Inicio'`).

7. **`build.metadata`** viaja para que el MCP sepa qué filtros ofrecer sin
   inferirlo del contenido. Cierra el bug abierto de odumbo (expone `modules`
   sobre un corpus con cero `modules:`, api/mcp.mjs:144), que es exactamente el
   bug que `versionado` cerró para `version`.
   - `articulos[].modules` sólo aparece si `metadata.modules === true`;
     `articulos[].type` sólo si `metadata.types` no está vacío. Ausencia de la
     faceta, no `[]` ni `null` sueltos (el criterio de odumbo indice.mjs:470-472:
     un campo vacío invita al agente a preguntarse qué falta).

8. **`build.conCuerpo: boolean`** es el otro campo nuevo, y cubre un modo de falla
   real de hoy: los dos artefactos difieren **sólo** en la presencia de `body`
   (oba build.mjs:1002-1005) y son indistinguibles por contenido. Si el MCP termina
   leyendo la copia estática —bundle reubicado, `DOCS_INDICE_PATH` mal puesto
   (oba indice.mjs:145-152 prueba tres rutas)— `leer()` devuelve `body: ''` con
   `encontrado: true`. Con el flag, el lector de la función falla fuerte y con
   nombre en vez de servir artículos vacíos.

9. **`build.manifiesto`** se conserva opcional (`null` cuando no hay fetch,
   adhoc build.mjs:105-111). Sólo lo llena un corpus con `fuente`: es la
   procedencia (project → repo → ref → sha → archivos, fetch.mjs:386-393) y es lo
   que permite auditar qué publicación salió.

### Campos que NO entran

- `headingsText` — derivado, lo arma el lector (adhoc build.mjs:625-627).
- `sidebarId` — detalle del emisor Docusaurus, hoy igual al id.
- `versionedSections` y cualquier resto del eje versión en un corpus `none`.
- `build.articulos` (conteo) **sí** entra aunque sea redundante con
  `articulos.length`: el lector lo prefiere (`idx.build.articulos ?? idx.articulos.length`,
  oba indice.mjs:587) y en la copia estática es el único chequeo de integridad
  barato.

## 4. Regla del lector

```js
const INDICE_SOPORTADO = 1;
const crudo = leerIndiceCrudo();
if (!Number.isInteger(crudo.schemaVersion)) {
  throw new Error('índice sin schemaVersion: lo emitió un build pre-unificación. Corré el build del paquete actual.');
}
if (crudo.schemaVersion > INDICE_SOPORTADO) {
  throw new Error(`el índice declara schemaVersion ${crudo.schemaVersion} y esta plataforma lee hasta ${INDICE_SOPORTADO}: actualizá @ingadhoc/docs-platform en este repo.`);
}
if (crudo.build?.conCuerpo === false && ESPERA_CUERPO) {
  throw new Error('este índice viene sin body (es la copia estática): la función MCP necesita api/_generated/index.json.');
}
```

Tirar y no degradar es la decisión: hoy los lectores tienen fallbacks blandos
(`crudo.build?.audience || process.env.DOCS_AUDIENCE || 'desconocida'`,
indice.mjs:214) que convierten un índice equivocado en un índice que responde
mal. El fallback a la env var se conserva **sólo** como el propio comentario de
adhoc lo justifica (indice.mjs:181-184: índice viejo o a medio generar), nunca
como segundo nombre de un campo.

## 5. Migración, en orden

1. El build empieza a emitir `schemaVersion: 1` + los campos nuevos **y** los
   viejos (`audience`, `version`/`project`, `latest`, `versionado`) — un solo
   deploy, sin lector nuevo.
2. Entra el lector del paquete, que exige `schemaVersion` y lee sólo los campos
   nuevos.
3. El build deja de emitir los viejos. Recién acá cambian los consumidores de
   fuera del MCP: `guard-fuga.mjs:89` y `:111-112`,
   `site/docusaurus.config.js:9`/`:70` de oba, y `docusaurus.config.js:19-21` de
   odumbo.

El paso 1 es el único que puede correr antes de que exista el paquete, y es el
que hace que el drift-check bloqueante (spec:79-82) tenga algo que comparar.
