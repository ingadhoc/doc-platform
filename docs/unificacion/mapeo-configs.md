# Los tres configs, traducidos al schema unificado

Campo por campo, con el config nuevo completo al final de cada sección (listo
para copiar). El schema es
[`docs.config.schema.json`](./docs.config.schema.json); el por qué de cada
decisión está en [`diseno-eje.md`](./diseno-eje.md).

**Verificado**: los tres bloques JSON de abajo validan contra el schema con
`ajv` (draft 2020-12), y ocho configs inválidos a propósito (sin
`schemaVersion`, `version` sin `default`, `none` con `valores`, `activo: false`
sin `motivo`, guard apagado sin `motivo`, clave desconocida, id reservado,
`version` con `fuente`) son rechazados.

---

## oba-docs — `eje: "version"`

| Antes | Después | Nota |
|---|---|---|
| `versions: ["19","18"]` | `eje.valores: [{id:"19",…},{id:"18",…}]` | el orden de declaración es el orden del eje (nueva primero) |
| `latest: "19"` | `eje.default: "19"` | obligatorio con `tipo: "version"` |
| `versionLabel: "{v}.0"` | `valores[].label: "19.0" / "18.0"` | el template desaparece; 2 valores no justifican una plantilla |
| `versionPath: "{v}"` | *(nada)* | `path` default = `id`, y `"{v}"` era la identidad |
| `audiences` | `audiences` | igual |
| `versionedSections: ["manual","guias"]` | *(se borra)* | nunca se leyó; la nav se deriva del árbol (ADR 0004 §6) |
| `crossVersionSections: ["relacion"]` | `secciones.fueraDelEje: ["relacion"]` | se lee en build.mjs:525, 798, 824 |
| `proyectos` | `deploy.proyectos` | mismos ids, mismo mapa |
| *(implícito en el código)* | `metadata.modules: true` | 17 archivos de `content/` declaran `modules:` |
| *(no existía)* | `deploy.guardDeFuga: {activo:true}` | el guard existe (`scripts/guard-fuga.mjs`) y ahora se declara |
| *(no existía)* | `schemaVersion: 1` | |

```json
{
  "schemaVersion": 1,
  "eje": {
    "tipo": "version",
    "default": "19",
    "valores": [
      { "id": "19", "label": "19.0" },
      { "id": "18", "label": "18.0" }
    ]
  },
  "audiences": ["publico", "interno"],
  "secciones": { "fueraDelEje": ["relacion"] },
  "metadata": { "modules": true },
  "deploy": {
    "proyectos": {
      "prj_TKfHZIDS1PZoy85bduKO89gugXBb": "publico",
      "prj_ig447DB9ZQXbfhCWjXg9JCUYHQzy": "interno"
    },
    "guardDeFuga": { "activo": true }
  }
}
```

**Qué cambia en el código de oba-docs**

- `build.mjs:83-84` (`label()`/`vpath()` con templates) → leer
  `valor.label ?? valor.id` y `valor.path ?? valor.id`.
- `build.mjs:830-834`: el sidebar deja de cablear `manual`/`guias` y se deriva
  del árbol menos `secciones.fueraDelEje` (como adhoc build.mjs:552-556).
- `build.mjs:844` y `:1133`, `:1323`: `audience:` → `audiencia:` (ver
  `contrato-indice.md` §5 para la lista completa de consumidores).
- Comportamiento de `leer()`: **no cambia** (declara `default` ⇒ sigue
  eligiendo), salvo que ahora lo anuncia (`elegidoPor: "default"`) y desaparece
  el fallback `candidatos[0]`.

---

## odumbo-docs — `eje: "none"`

| Antes | Después | Nota |
|---|---|---|
| `versionado: false` | `eje.tipo: "none"` | |
| `versions: []` | *(prohibido)* | el schema no deja declarar valores sin eje |
| `latest: null` | *(prohibido)* | mismo motivo — su propio código ya evita emitir `versiones: []` + `latest: null` juntos "porque invita al agente a preguntarse cuál falta" (indice.mjs:469-472) |
| `audiences` | `audiences` | igual |
| `versionedSections: []` | *(se borra)* | |
| `crossVersionSections: []` | *(se borra)* | sin eje nada está afuera |
| `proyectos` (1 entrada) | `deploy.proyectos` | igual; el segundo proyecto sigue sin mapear y el guard sigue fallando cerrado |
| *(implícito)* | `metadata.modules: false` | **cero** archivos de `content/` declaran `modules:` — hoy su MCP expone el filtro igual (api/mcp.mjs:144) |
| *(no existía)* | `deploy.guardDeFuga: {activo:true}` | el guard existe |
| *(no existía)* | `schemaVersion: 1` | |

```json
{
  "schemaVersion": 1,
  "eje": { "tipo": "none" },
  "audiences": ["publico", "interno"],
  "metadata": { "modules": false },
  "deploy": {
    "proyectos": { "prj_uwm1uHEaZPf6K7EkvbVD6VTqzUxI": "publico" },
    "guardDeFuga": { "activo": true }
  }
}
```

**Qué cambia en el código de odumbo-docs**

- Desaparece el crash latente de `build.mjs:91` (`CFG.versionLabel.replace(...)`
  sobre un campo que su config no tiene): sin `eje.valores`, la plataforma
  unificada no construye labels de eje.
- `api/mcp.mjs:144`: el filtro `modules` deja de ofrecerse
  (`metadata.modules: false`) — es el mismo criterio que su propio comentario
  aplica a `version` en `:67-70`.
- `lib/mcp/indice.mjs` gana el fallback de contenido fuera del eje y el
  `or-fallback` de `buscar()` que hoy le faltan (los fixes #11/#12): pasan a ser
  una implementación del paquete, no un cherry-pick.
- `site/docusaurus.config.js:19-21` tira si `generated.json` dice
  `versionado: true`. Se traduce a `eje.tipo !== "none"`.

---

## adhoc-docs — `eje: "project"`

| Antes | Después | Nota |
|---|---|---|
| `projects: [{...}]` | `eje.valores: [{...}]` + `eje.tipo: "project"` | |
| `projects[].id` | `valores[].id` | mismas reglas: slug, único, no reservado (fetch.mjs:135-150) |
| `projects[].label` | `valores[].label` | pasa de obligatorio a opcional con default `id` (hoy fetch.mjs:127 lo exige) |
| `projects[].repo/path/ref` | `valores[].fuente.repo/path/ref` | agrupado: es transporte, no eje |
| `projects[].exclude` (`include` soportado por el fetch) | `valores[].fuente.exclude` / `.include` | |
| `projects[].activo` | `valores[].activo` | de obligatorio a opcional con default `true` |
| `projects[].motivo` | `valores[].motivo` | sigue siendo obligatorio con `activo: false` (`if/then` del schema) |
| `audiences: ["interno"]` | `audiences: ["interno"]` | igual |
| `types: [...]` | `metadata.types: [...]` | mismos 6 valores; sigue validando `fm.type` |
| *(no tenía)* | `metadata.modules` ausente (= `false`) | build.mjs:618: "`modules` NO viaja: es vocabulario del dominio de OBA" |
| *(no tenía)* | `deploy.guardDeFuga` | **obligatorio** — la ausencia del guard deja de poder ser silenciosa (spec, Fase 0.4) |
| *(no tenía)* | `deploy.proyectos` | opcional; hoy no hay guard que lo lea. Cuando entre, hay que mapear el `prj_` del sitio interno |
| *(sin `latest`)* | *(sin `eje.default`)* | **es la decisión, no un olvido**: sin default, `leer()` devuelve ambigüedad (indice.mjs:487-511) |
| *(no existía)* | `schemaVersion: 1` | |

El `motivo` del `guardDeFuga` de abajo es un **placeholder marcado**: la salida
final (opt-out firmado vs. entra el guard) es el punto 3 de "Para jjs" en
`diseno-eje.md`.

```json
{
  "schemaVersion": 1,
  "eje": {
    "tipo": "project",
    "valores": [
      {
        "id": "adhoc-way",
        "label": "Adhoc Way",
        "fuente": { "repo": "ingadhoc/adhoc-way", "path": "docs", "ref": "main" }
      },
      {
        "id": "oba",
        "label": "Odoo by Adhoc",
        "fuente": { "repo": "ingadhoc/oba-project", "path": "docs", "ref": "main" }
      },
      {
        "id": "odumbo",
        "label": "Odumbo",
        "fuente": {
          "repo": "ingadhoc/odumbo-project",
          "path": "docs",
          "ref": "main",
          "exclude": ["evals/**", "prompts/**", "knowledge/**"]
        }
      },
      {
        "id": "consultoria-tecnica",
        "label": "Consultoría Técnica",
        "activo": false,
        "motivo": "Nombra clientes. Su dueño decide si publica y con qué exclusiones.",
        "fuente": {
          "repo": "ingadhoc/consultoria-tecnica-project",
          "path": "docs",
          "ref": "main"
        }
      }
    ]
  },
  "audiences": ["interno"],
  "metadata": {
    "types": ["concepto", "referencia", "procedimiento", "troubleshooting", "guia", "indice"]
  },
  "deploy": {
    "guardDeFuga": {
      "activo": false,
      "motivo": "PENDIENTE DE FIRMA (jjs) — este repo no tiene build público: su gate es incondicional (lib/mcp/gate.mjs) y el guard de fuga protege contra la fuga de bloques internos AL build público, que acá no existe."
    }
  }
}
```

**Qué cambia en el código de adhoc-docs**

- `tools/fetch.mjs`: `cfg.projects` → `cfg.eje.valores`, y `p.repo/path/ref/
  include/exclude` → `p.fuente.*` (fetch.mjs:120-121, 127-131, 159-163, 201-215,
  266-305, 338-350). `leerRegistro()` deja de validar a mano lo que valida el
  schema y se queda con lo que un JSON Schema no puede: ids reservados contra las
  rutas reales del sitio, unicidad de ids y la coherencia con `content/`.
- `tools/build.mjs:98`: `CFG.projects.filter(activo !== false)` →
  `CFG.eje.valores.filter(...)`; `:336` → `CFG.metadata?.types`.
- `leer()` **no cambia de comportamiento** (sin `default` ⇒ sigue devolviendo
  ambigüedad), pero el `motivo` pasa de `"ambiguo-entre-projects"` a
  `"ambiguo-en-eje"` y `mismoSlugEnOtrosProjects` a `otrosDelEje`.
- Gana el `or-fallback` de `buscar()` y el guard de fuga (o el opt-out firmado).

---

## Lo que ninguno de los tres declara y el schema tampoco inventa

- **`site/generated.json`** (config ↔ sitio) es un **tercer** contrato, fuera del
  alcance de esta tarea: hoy oba emite `{audience, latest, versions[]}`
  (build.mjs:843-847), odumbo `{audience, versionado, …}` (build.mjs:424-430 /
  519-525) y adhoc `{audiencia, generado, projects[], manifiesto}`
  (build.mjs:558-563). Se unifica igual que el índice y con el mismo
  `schemaVersion`; queda anotado acá para que no se pierda.
- **La lista de audiencias del `gate.mjs`** sigue duplicada inline porque el edge
  no lee del filesystem (odumbo gate.mjs:23-27). Se cierra generando ese módulo
  desde el config en el build — no agregando un campo.
