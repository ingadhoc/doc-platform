# CHANGELOG — @ingadhoc/docs-platform

Los repos de contenido consumen este paquete **pineado por tag**, así que este
archivo es el que dice qué se están perdiendo mientras no suben el pin.

**Convención (la parsea `bin/drift-check.mjs`, no la rompas):**

- una sección por versión: `## vX.Y.Z — AAAA-MM-DD` (la fecha es obligatoria:
  es la que permite medir el lag de adopción);
- un ítem por cambio, con el módulo adelante: `- indice: …`;
- los cambios de seguridad arrancan con la etiqueta **`[seguridad]`**;
- un ítem `[seguridad]` que nombra `guard` o `gate` **bloquea el CI** de los
  consumidores rezagados. Los demás se reportan y no bloquean.

---

## v0.8.2 — 2026-09-04

- **[seguridad] drift-check: la etiqueta `[seguridad]` en negrita no se
  detectaba, y el bloqueo llevaba cuatro meses apagado.** `deSeguridad`
  filtraba con `/^\[seguridad\]/i` sobre el ítem crudo; el parser saca el
  `- ` del bullet y nada más, así que desde la v0.5.0 —cuando este archivo
  empezó a escribir todos los ítems en negrita— `**[seguridad] gate: …` dejó de
  empezar con `[` y ningún ítem matcheó. Medido con `pineado: v0.4.1`: decía
  `0 de seguridad, 0 bloqueantes` cuando eran **7 y 3**. Los tests no lo veían
  porque el fixture usaba texto plano, la única forma que este archivo ya no
  usa; ahora está en negrita y sin el fix fallan cuatro. La etiqueta se busca
  sobre el ítem sin su énfasis de markdown.
- **Subí el pin y mirá lo que el check no te dijo en cuatro meses.** Al adoptar
  esta versión, un consumidor rezagado va a ver de golpe los `[seguridad]` que
  se le venían acumulando. Si te bloquea por `[seguridad] guard: bin nuevo
  docs-podar-static` (v0.7.1), el bloqueo es correcto: sin ese bin el build
  copia `static/` entero.

## v0.8.1 — 2026-09-04

- **mcp-handler: la prosa del comodín ahora la enciende el contenido en las
  TRES frases, no en una.** La v0.8.0 apagó la frase `CROSS-VERSION` de la
  `description` de `buscar()` cuando el corpus no declara
  `secciones.fueraDelEje`, con el argumento de que una tool que ofrece un
  filtro sin contenido detrás miente. Quedaron encendidas las otras dos, que
  dicen lo mismo en el lugar donde el LLM mira cuando arma la llamada: la
  `description` del parámetro `version` de `buscar()` ("los artículos que
  aplican a todas las versiones (`version: null`) pasan igual") y la de
  `leer()` ("un artículo que aplica a todas las versiones se devuelve para
  cualquiera que pidas"). Medido en el MCP de oba-docs en producción: cero
  artículos con `version: null` y las dos frases igual anunciándolos.
  Ahora las tres salen y se van juntas, con la misma condición.
- **mcp-handler: nada de esto toca el motor.** El comodín sigue encendido —un
  artículo con `eje: null` sigue pasando cualquier filtro— y el parámetro
  `version` sigue expuesto igual. Es prosa, no capacidad.
- **mcp-handler: cómo se recuperan las tres frases.** Con `cross` encendido, o
  sea cuando el corpus declara `secciones.fueraDelEje` **y su adaptador lo
  reenvía a `crearMcp`**. Los tres consumidores de hoy tienen `cross` en null:
  oba dejó de reenviar `secciones` en la #73556, adhoc va por eje `project` y
  odumbo no tiene eje. Volver a ponerlo en `docs.config.json` no alcanza —
  también hay que tocar el `docs.mcp.config.mjs` del repo.
- **mcp-handler: cada override pisa SU superficie, y eso no cambió.**
  `eje.describeBuscar` / `eje.describeLeer` pisan la `description` del
  parámetro; `eje.cross` pisa la frase del cuerpo de `buscar()`. Son dos
  overrides distintos: pisar uno no apaga el otro. Y ninguno de los tres es
  una clave de `docs.config.json` —el `eje` del schema tiene
  `additionalProperties: false`— sino del objeto que el adaptador
  `docs.mcp.config.mjs` le pasa a `crearMcp`.

---

## v0.8.0 — 2026-09-02

- **indice-fuera-del-eje: se borra el bin `docs-indice-fuera-del-eje` y su
  módulo.** Sacalo del `buildCommand` y del CI antes de subir el pin: el bin ya
  no existe y `npx docs-indice-fuera-del-eje` va a fallar el build.
  El paso existía para un problema que dejó de tenerse: el plugin del buscador
  asocia el contenido SIN versionar a la versión última, así que una sección
  fuera del eje quedaba invisible parado en una versión vieja, y este
  post-proceso la sumaba al índice de cada versión sobre el artefacto ya
  construido. El único corpus que tenía contenido fuera del eje era oba-docs con
  `relacion`, y por la #73556 `relacion` pasó a vivir DENTRO de cada versión: ya
  no hay contenido que aplique a todas, en ningún repo. Un paso de build que
  siempre es no-op es un paso que nadie va a revisar el día que empiece a
  romper. Si un corpus vuelve a necesitar contenido fuera del eje, esto vuelve
  desde el historial —el módulo estaba entero y testeado— o, mejor, se arregla
  upstream, que es donde su propio docstring decía que iba el fix.

- **config: `secciones.fueraDelEje` SIGUE siendo válido en el schema.** No hay
  nada que coordinar de este lado: el campo se acepta igual, con la misma
  semántica de contrato (los artículos de esas secciones aplican a todos los
  valores del eje). Un repo puede sacarlo de su `docs.config.json` cuando le
  quede sin uso, o dejarlo, y el validador no se queja en ninguno de los dos
  casos.

- **mcp-handler: la prosa CROSS-VERSION de `buscar()` ahora la enciende el
  contenido, no el tipo de eje.** Con eje `version` y `secciones.fueraDelEje`
  vacío o ausente, la `description` de la tool anunciaba igual "la única
  excepción son los artículos CROSS-VERSION (…): aparecen bajo cualquier filtro
  y vienen con `version: null` en el hit" — una excepción sin un solo artículo
  detrás. Es el mismo criterio con el que este paquete apaga el eje de odumbo y
  el `modules` que nadie declara: una tool que ofrece un filtro sin contenido
  detrás miente. El comodín del MOTOR no se toca: un artículo con `eje: null`
  sigue pasando cualquier filtro, porque es una capacidad del motor y no
  depende del campo de config.

- **busqueda: `opcionesDelTema()` no necesita argumentos.** `docsRouteBasePath`
  pasa a tener default `['/']`, que es lo que tienen los tres repos ahora que
  nadie monta un segundo plugin de docs; el parámetro sigue existiendo para el
  corpus que alguna vez lo necesite. Podés simplificar la llamada del
  `docusaurus.config.js` a `opcionesDelTema()`. Se va también la constante
  `OPCIONES_DE_INDICE`, que sólo existía para que el bin borrado reconstruyera
  índices lunr con el mismo pipeline que el tema: cero consumidores.
  Lo que NO se va es la decisión de no usar `searchContextByPaths` — sigue
  vigente y sigue documentada acá. Nota honesta: el bin borrado era además lo
  que DETECTABA su reaparición (fallaba el build si encontraba el índice
  partido por contexto); esa red se pierde, y la decisión queda sostenida sólo
  por tener una única fuente de las opciones del tema.

- **README: se reemplaza la sección "El buscador y el contenido fuera del eje"
  por "El buscador del sitio"**, con lo que sigue siendo cierto.

---

## v0.7.1 — 2026-09-02

- **[seguridad] guard: bin nuevo `docs-podar-static`, para el `buildCommand`.**
  El guard de fuga mira TEXTO en los artefactos del build, y una captura de
  pantalla no tiene texto que grepear: las imágenes nunca se verificaron. Y sí
  se filtran. Docusaurus copia `static/` entero a la salida ADEMÁS de emitir las
  imágenes procesadas en `assets/images/`, así que cada imagen se publica dos
  veces, y la copia cruda se publica **exista o no una página que la muestre**.
  Una captura referenciada solo desde un bloque `:::interno` no aparece en
  ninguna página pública y aun así queda servida bajo `/img/…`. Se detectó con
  casos reales en un repo consumidor; el detalle y su remediación están en la
  task interna, porque este repo es público.

  El bin saca de la salida los archivos de `static/` que **ningún** artefacto
  del build referencia. La regla es sobre el artefacto emitido y no necesita
  saber qué es "interno": no se parsea el árbol fuente, que es el error que
  `lib/guard-fuga.mjs` documenta en su decisión de diseño 2 (dos parsers del
  mismo formato divergen, y cuando divergen dejan pasar justo la fuga). Va en el
  `buildCommand` **antes** del guard:

      … && npx docs-podar-static --salida=site/build && npx docs-guard-fuga …

  De paso baja el peso del deploy: en un manual con años de capturas, la copia
  cruda de `static/img` es casi toda material que ninguna página muestra.

  **Al adoptarlo, verificá el reporte del bin la primera vez.** Dice cuántos
  archivos conservó y cuántos borró; si el número de borrados es sospechosamente
  alto para tu repo, corré `--dry-run` antes. El modo de falla es una imagen
  rota en el sitio, visible pero en producción.

  Ojo con una referencia que no es obvia: el índice para agentes
  (`agente/md/*.md`, lo que sirve el MCP) lleva las rutas ORIGINALES de las
  imágenes, no las hasheadas del HTML. Es lo único que mantiene viva la copia
  cruda de una imagen pública, y por eso el escaneo incluye `.md`. Si tu repo
  emite parte de ese índice FUERA de la salida —`api/_generated`, como el
  `--extra` del guard— pasalo en `--extra` o vas a perder esas imágenes del
  lado del agente con el sitio viéndose bien. `--salida` no sirve para eso: es
  la raíz de lo que se poda, no solo de lo que se escanea.

  Se compara por RUTA, no por nombre de archivo: dos capturas homónimas en
  carpetas distintas (`captura.png`, `1.png` — lo normal en un manual) no se
  salvan entre sí. Cuando una referencia no trae directorio y el nombre está
  repetido, el archivo se conserva y sale listado en el reporte, porque ahí no
  hay forma de saber a cuál apuntaba.

---

## v0.7.0 — 2026-09-02

- **busqueda: la configuración del buscador pasa a la plataforma
  (`@ingadhoc/docs-platform/busqueda`).** Vivía copiada en el
  `docusaurus.config.js` de cada repo y había divergido: oba-docs partía el
  índice con `searchContextByPaths` y adhoc-docs documentaba en un comentario
  por qué no lo hacía. Además de la higiene hay una razón dura: el
  post-proceso de abajo reconstruye índices lunr y tiene que hacerlo con el
  mismo idioma y pipeline que usó el build — con dos configuraciones separadas,
  el día que una cambie el índice reconstruido busca distinto que el original.
- **indice-fuera-del-eje: bin nuevo `docs-indice-fuera-del-eje`, para el
  `buildCommand`.** El contrato declara que los artículos de
  `secciones.fueraDelEje` "aplican a TODOS los valores del eje". El MCP lo
  cumplía; el buscador del sitio no, y no por su culpa: Docusaurus emite un
  índice por versión y asocia el contenido sin versionar a la versión ÚLTIMA,
  así que parado en una versión vieja la sección no existía. Medido en
  producción: `/18/search-index.json` tenía 468 URLs de la 18 y CERO de
  `relacion` — buscar "seguridad en la nube" desde la 18 daba cero resultados.
  El bin lo corrige sobre el artefacto ya construido, y **falla el build** en vez
  de escribir un índice dudoso: si el artefacto no es el que sabe leer (índice
  partido por contexto, formato del plugin cambiado, una sección que dejó de
  emitirse —chequeada **por sección**, no sobre el total), si reconstruir el
  índice de una versión sin tocarlo no reproduce el archivo del build (o sea que
  las opciones del buscador del sitio y las de la plataforma divergieron), o si
  los ids de los documentos colisionan entre índices (que haría que el buscador
  muestre la página equivocada, sin ningún error). Es **no-op** sin eje `version`, con un solo valor de eje, o sin
  secciones fuera del eje: entra al `buildCommand` de los tres repos aunque hoy
  solo lo necesite oba-docs.

  Va DESPUÉS del build y ANTES del guard de fuga:

  ```
  npm --prefix site run build \
    && npx docs-indice-fuera-del-eje --salida=site/build \
    && npx docs-guard-fuga --salida=site/build
  ```

---

## v0.6.3 — 2026-09-01

- **drift-check: un lockfile desalineado con el `package.json` ahora BLOQUEA**,
  en vez de avisar. Un pin atrasado es un riesgo diferido; un lock desalineado
  es que lo que se deploya no es lo que el repo declara — y el CI lo bendice
  igual. Pasó: los tres repos subieron el pin a v0.6.0 editando el lock a mano,
  el lock siguió resolviendo v0.4.1, y producción se deployó con la versión
  vieja con todo en verde. El mensaje ahora dice el `npm install` exacto, porque
  editar la línea a mano no re-resuelve el paquete.
- docs: `docs/login-con-odoo.md` suma **cómo se prueba un cambio de auth** —
  ningún preview de PR ejerce el login, qué clase de error es invisible para la
  suite y por qué, la batería de `curl` sin browser, y las dos pruebas que sí
  necesitan a una persona.

---

## v0.6.2 — 2026-09-01

- **[seguridad] login-odoo: `puertaLogin`, `puertaCallback` y `puertaLogout` —
  las tres rutas listas para montar, como objetos con `fetch`.** El pegamento
  de los repos exportaba una función pelada, y Vercel entonces la invoca al
  estilo Node con `(req, res)`: `request.headers.get` no existe, `request.url`
  es relativa, y las tres rutas contestan 500 — el sitio interno queda sin
  acceso humano, que es lo que pasó en producción. Un objeto con `fetch` es lo
  único que hace que llegue un `Request` web. Es la misma forma que ya usaba
  `mcp-handler`, que por eso nunca tuvo el problema.

  El consumidor pasa a `export { puertaLogin as default } from
  '@ingadhoc/docs-platform/login-odoo';`. Que la forma viva en el paquete y no
  en el pegamento de cada repo es para que el próximo sitio no lo redescubra.

---

## v0.6.1 — 2026-09-01

- **[seguridad] login-odoo: las tres rutas de la puerta devolvían 500 en
  producción.** En el runtime de la función, Vercel pasa `request.url` como
  RUTA RELATIVA (`/api/auth/login?volver=%2F`), no como URL absoluta, así que
  `new URL(request.url)` tiraba `ERR_INVALID_URL`. En el edge la misma
  propiedad viene absoluta: por eso el gate mandaba a loguearse y el login
  contestaba 500 — nadie podía entrar, y el sitio interno quedaba sin acceso
  humano. Se ve solo corriendo en Vercel; el `Request` estándar no deja
  construir una url relativa, así que la suite no podía verlo. Ahora hay un
  `urlDelPedido()` que arma la URL absoluta desde los headers del proxy, y un
  test que construye el pedido con la forma que llega de verdad.
- login-odoo: el host del proxy (`x-forwarded-host`) gana sobre el que traiga
  `request.url`, donde puede venir el host interno del hosting. El
  `redirect_uri` tiene que ser el público o Odoo no lo reconoce.

---

## v0.6.0 — 2026-09-01

Cierra dos agujeros del login de la v0.5.0 —encontrados revisando el PR antes de
mergearlo— y saca la credencial compartida. Es el final de la task 72391: a la
documentación interna se entra con el usuario de Odoo, y no hay otra forma.

- **[seguridad] sesion: el propósito va adentro de la firma (`typ`), y
  `verificarSesion()` exige cuál espera.** Con el mismo secreto se firmaban dos
  cosas —el intento de login y la sesión— y una firma válida no decía para qué
  se emitió. Como `/api/auth/login` pasa sin credencial (tiene que pasar),
  cualquiera desde internet pedía esa ruta, se quedaba con la cookie del intento,
  le cambiaba el nombre a `docs_sesion` y entraba a toda la documentación
  interna: sin pasar por Odoo, sin ser nadie y renovable indefinidamente.
  Reproducido antes del fix. Una cookie sin `typ` tampoco vale: fail-closed.
- **[seguridad] login-odoo: `userinfo` pasa a ser la autorización, no un
  adorno.** `oauth.provider.client` no tiene ningún campo para restringir quién
  puede autorizar un cliente, así que cualquiera que pueda loguearse en nuestro
  Odoo completaba el flujo — incluidos los ~4200 usuarios portal activos, que
  son clientes. El filtro vive ahora en el scope (**`DOCS_ODOO_SCOPE`**, nueva y
  obligatoria, sin default): un `oauth.provider.scope` sobre `res.users` con un
  `ir.filters` de `share = False`, que hace que `userinfo` conteste `{}` para
  todo el que no sea interno. Una respuesta vacía es un NO. Odoo caído es 502 y
  no deja sesión: ante la duda no se abre. El usuario archivado queda afuera,
  que es lo correcto.
- **[seguridad] gate: se fue la credencial compartida.** `DOCS_AUTH_PASSWORD`,
  `DOCS_AUTH_USER`, el challenge `Basic` y `REALM_DEFAULT` no existen más, y con
  ellos las dos cosas que la credencial no podía dar: saber quién entró, y que
  rotarla alcanzara (cada deployment viejo seguía accesible con el secreto de su
  época). El fail-closed pasa a ser sobre `DOCS_SESION_SECRET`.
  **No queda break-glass, a propósito**: un segundo camino que abre todo es lo
  que se vino a sacar. Si Odoo no responde, la documentación interna no se sirve
  a humanos. Las máquinas no dependen de esto — el MCP y los estáticos con
  Bearer siguen andando con `DOCS_MCP_TOKENS`, y ese fail-closed por capa está
  fijado por tests.
- **login-odoo: el `redirect_uri` sale del host del request y `DOCS_SITIO_URL`
  desaparece.** Una variable con la URL del sitio solo podía decir dos cosas: lo
  mismo que el host real —y entonces sobra— o algo distinto. Lo segundo rompía
  los previews: quien abría un preview de PR se logueaba, Odoo lo devolvía al
  callback de PRODUCCIÓN y terminaba ahí, con la cookie en el dominio de
  producción, sin enterarse de que nunca vio el preview. Ahora cada deployment
  pide volver a sí mismo. Como la lista de `redirect_uri` la valida Odoo, un
  host que no esté registrado falla con un error de Odoo a la vista en vez de
  mandar a alguien a otro sitio en silencio — y habilitar un preview es agregar
  su URL al client.
- login-odoo: `/api/auth/logout` — tercera ruta de puerta. Borra la cookie y
  nada más; no cierra la sesión de Odoo. Es para la máquina prestada, no para la
  baja de alguien: eso lo hace archivar el usuario en Odoo, que corta el próximo
  login y vence la sesión viva en menos de 12 h.

**Para el consumidor:** además del `await` de la v0.5.0, hay que configurar
`DOCS_SESION_SECRET` y las `DOCS_ODOO_*` en el proyecto de Vercel **antes** de
subir el pin — sin `DOCS_SESION_SECRET` el sitio interno devuelve
503. `DOCS_AUTH_PASSWORD` y `DOCS_AUTH_USER` se pueden borrar: ya no las lee
nadie.

---

## v0.5.0 — 2026-09-01

Entrar a la documentación interna con **el usuario de Odoo** en vez de la
credencial compartida (task 72391). El gate sigue siendo el mismo y sigue
cubriendo todas las rutas: lo que cambia es la función de chequeo.

- **[seguridad] gate: `decidir()` ahora es `async` y hay que `await`-earla.** Es
  un cambio incompatible y silencioso si no se adopta: sin el `await`, el
  middleware devuelve una promesa donde el runtime espera una respuesta, y un
  sitio interno puede terminar sirviendo contenido sin gate. El pegamento de cada
  repo consumidor pasa a `export default async function middleware(request)` +
  `await decidir(...)`. Una línea por repo, y no es opcional.
- gate: acepta una **cookie de sesión firmada** (`DOCS_SESION_SECRET`). Con
  sesión válida pasa; sin ella, a una persona navegando la manda al login
  (302) y a una máquina le contesta 401 sin challenge `Basic`.
- gate: `RUTAS_DE_PUERTA` — `/api/auth/login` y `/api/auth/callback` pasan sin
  credencial, porque una puerta cerrada con llave desde afuera no se abre. Es
  una **lista exacta**, no un prefijo: con `/api/auth/*` alcanzaría agregar un
  archivo en esa carpeta para publicar sin gate. Hay un test que la fija.
- gate: la credencial compartida sigue valiendo mientras `DOCS_AUTH_PASSWORD`
  esté configurada, y es el break-glass para cuando Odoo no responda. El
  fail-closed ahora es sobre las dos variables: sin ninguna, 503.
- sesion: nace `@ingadhoc/docs-platform/sesion` — firma y verifica la cookie con
  WebCrypto (HMAC-SHA256), con la expiración adentro de la firma. Apto edge.
- login-odoo: nace `@ingadhoc/docs-platform/login-odoo` con `manejarLogin` y
  `manejarCallback`, el ida y vuelta OAuth2 contra `oauth_provider` de OCA. Se
  llama así y no `oidc` porque ese módulo es OAuth2 pelado: sin discovery, sin
  JWKS y sin `id_token`.
- login-odoo: **la identidad sale de `odoo_user_id`, que ya viene en la
  respuesta del token**, no de `/oauth2/userinfo`. Ese endpoint arma su
  respuesta con un `search` sobre `res.users`, que excluye los archivados, y con
  un usuario archivado devuelve `{}` y HTTP 200: el login se caería con una
  sesión válida en la mano. El email y el nombre se piden aparte y son
  opcionales.
- login-odoo: el destino de vuelta se valida contra rutas protocol-relative
  (`//otro.com`, `/\otro.com`), que convertirían al login en un trampolín.

---

## v0.4.1 — 2026-08-25

- docusaurus-plugin: el import de `@docusaurus/plugin-content-docs/client` del badge de países no resolvía con `npm ci` (el paquete vive en el node_modules de la raíz del consumidor y Docusaurus en `site/node_modules`); el plugin ahora lo alias-ea resolviéndolo desde el siteDir. Localmente el hoisting lo tapaba — en CI rompía el bundle entero.

---

## v0.4.0 — 2026-08-25

El widget de chat de Tuqui deja de ser una implementación inline de un sitio y
pasa a ser una función del paquete. La convención queda cerrada: **cualquier
sitio de la plataforma lo embebe declarando `TUQUI_EMBED_ID` en su proyecto de
Vercel** — si está, se agrega; si no está, no existe.

- tuqui-embed: nace `@ingadhoc/docs-platform/tuqui-embed` con `tuquiEmbedScripts(env = process.env)`, que devuelve el array para el campo `scripts` de `docusaurus.config.js`: `[]` sin la variable, y un solo `{ src: 'https://tuqui.com/embed.js', defer: true, 'data-embed-id': <id> }` con ella. Sin default: prender el chat es una decisión del proyecto de Vercel, no algo que arrastre un build local, el build interno o un fork.
- tuqui-embed: **sin `data-color`**. El estilo lo gobierna Tuqui, que es el único lugar donde se cambia sin redeployar tres sitios; un data-attribute por sitio era la copia forkeada del ADR 0007 otra vez. El sitio que ya lo tenía inline lo pierde en el mismo movimiento.
- tuqui-embed: el id se **valida contra la forma UUID** y el build **aborta** con mensaje explícito si viene malformado. No es paranoia de más: esto corre en el `buildCommand` de sitios públicos y el valor se interpola dentro de un tag `<script>` de todas las páginas — un espacio, una comilla o un `"><script` en la variable de entorno es inyección de markup. Una variable ausente, vacía o con solo espacios no es un error: es el caso "sin widget".
- README: sección *Widget de Tuqui* con el import **que funciona de verdad** desde un `docusaurus.config.js` CJS (`require('@ingadhoc/docs-platform/tuqui-embed')`, piso Node ≥20.19 / ≥22.12), más las dos alternativas probadas para Nodes más viejos (ruta relativa a `node_modules`, o `await import()` con la config `async`).
- Fuera de alcance declarado: **un embed por `project`** dentro de un sitio multi-doc. Hoy el widget es del sitio, uno por deploy; el caso por sección es una v2.

## v0.3.0 — 2026-08-25

Nace la faceta `paises`. **No es un eje**: no multiplica el build, no bifurca
URLs y `TIPOS_DE_EJE` no se toca. Es un campo que viaja al índice y se filtra
duro, como `modules` — con una diferencia que es todo el diseño: el tag
**excluye**, y la **ausencia del tag nunca oculta**.

- indice: `politicaDeEje()` suma `paises` a `filtrosDominio` y `camposDominio` cuando el índice declara `build.metadata.paises` con vocabulario. Sin vocabulario no hay faceta: ni filtro, ni campo, ni comodín.
- indice: `pasaFiltros()` gana el **comodín por faceta** (`politica.dominiosComodin`): en un dominio con comodín, la lista propia vacía o ausente **pasa siempre**. Es el Fix #12 una faceta más abajo — sin esto, filtrar por UY borra todo el contenido universal, que es la mayor parte del manual. `modules` conserva la semántica opuesta: sin módulos declarados, no matchea ningún filtro de módulo.
- indice: `paises` viaja en el hit de `buscar()` y en la salida de `leer()`, con `null` —no `[]`— cuando el artículo es universal: un array vacío se lee como "ningún país" y es justo lo contrario.
- mcp-handler: `buscar()` expone el filtro `paises` cuando **el índice** declara el vocabulario (mismo criterio que el eje: el config declara prosa, el índice declara qué hay). El prompt dice las tres cosas que el LLM no puede deducir del nombre del parámetro: el filtro es duro, excluye, y un artículo sin país se devuelve siempre.
- config: `metadata.paises` entra al schema del `docs.config.json` — vocabulario cerrado, ISO alpha-2 en MAYÚSCULAS.
- docusaurus-theme: badge de país arriba del h1 (`DocItem/Content.js`, wrapper de `@theme-init/DocItem/Content`) — "Solo Argentina" / "Solo Chile y Uruguay", con los nombres de un mapa AR/CL/UY y no el código pelado. Una página sin `paises:` **no** lleva badge.
- docusaurus-theme: indicador discreto en el árbol para las clases `pais-AR` / `pais-CL` / `pais-UY` que el build del consumidor estampa vía `sidebar_class_name`. Los dos estilos van en `styles.css`, con su variante de modo oscuro.

## v0.2.0 — 2026-08-25

- docusaurus-theme: nace la capa de theme del paquete — `lib/docusaurus-plugin.cjs` + `lib/docusaurus-theme/`. El consumidor agrega `require.resolve('@ingadhoc/docs-platform/docusaurus-plugin')` a sus `plugins:` y obtiene el scope MDX y los estilos, sin swizzle.
- docusaurus-theme: componente `<Video url title/>` global en MDX — YouTube embebido con miniatura derivada del ID y sin iframe hasta el click (patrón lite-youtube); cualquier otra URL rinde un botón "Ver video". Laudo del 24/08 (estándar § Videos y gifs).
- docusaurus-theme: los títulos del contenido suben un escalón — h2 2.25rem, h3 1.7rem, h4 1.15rem (el h1 ya estaba en 3rem y no se toca). Pedido de los POs del 24/08.
- video-url: parseo puro exportado (`parsearUrlVideo`, `idDeYoutube`) en `@ingadhoc/docs-platform/video-url`, con sus 14 casos de test.

## v0.1.2 — 2026-08-24

- guard/tests: la suite `bloques` le declara al guard su árbol de fixtures (`--contenido=`) — el chequeo de procedencia de v0.1.1 la detectaba, correctamente, como manifiesto ajeno.

## v0.1.1 — 2026-08-24

Tres fixes del guard de fuga, **medidos contra el deploy público de Finanzas**
(`oba-docs`, commit `37269f7`). Ese build quedó rojo con 5 "fugas" y ninguna era
una fuga: cada falso positivo destapó un problema distinto del guard. Los tres
quedaron fuera del snapshot con el que se unificó la plataforma y entran acá.

Un falso positivo del guard no es gratis: se paga reescribiendo prosa correcta
o —peor— aprendiendo a ignorar el guard, que es exactamente la forma en que un
gate de seguridad deja de proteger.

- [seguridad] guard: los límites de BLOQUE cortan el n-grama y los INLINE no.
  `normalizar()` reemplazaba TODO tag por un espacio, así que el final de un
  bloque quedaba pegado al principio del siguiente y nacían trigramas que nadie
  escribió (`<h2>Qué agrega el módulo</h2><p>En la sección…` → "el módulo en";
  dos entradas del search-index → "a cobrar pago"). Eran 4 de los 5 falsos
  positivos. Ahora los tags de bloque pasan a `\n` y el escaneo va segmento por
  segmento, para que ningún match cruce dos bloques. Los inline siguen siendo un
  espacio: `<strong>timeout</strong> del webservice` tiene que seguir matcheando
  o el guard queda ciego justo donde una frase interna lleva una negrita adentro.
- [seguridad] guard: los escapes `\n\r\t…` del fallback de JSON roto se decodifican
  a `\n`, no a espacio. Mismo principio: eran un salto de línea en el fuente, y
  las palabras de un lado y del otro nunca fueron contiguas.
- [seguridad] guard: el manifiesto tiene que ser **del contenido que se publica**.
  Si `.guard/removido.json` declara un árbol (`contenido`, o `content` en el
  emisor viejo) distinto del que se está escaneando, el guard falla. Esto es lo
  que explica por qué la verificación local de Finanzas daba 0 hits y Vercel
  encontraba 5: la suite de bloques corre el preprocesador contra un fixture y
  deja SU manifiesto ahí —20 sondas en vez de 853—, y el guard corrido después
  medía el sitio real contra las sondas de un fixture, saliendo verde POR VACÍO.
  Un manifiesto que no declara el árbol no se rechaza: el chequeo entra a medida
  que los repos emiten el campo. El nombre esperado se pasa con `--contenido=`
  (default `content`).

Lo que NO viaja en este bump: las sondas que discriminan (descartar trigramas de
puras palabras funcionales o números, como `la 19 0`, y fallar si una línea
interna se queda sin sonda). Es del emisor —el preprocesador de cada repo—, no
del guard, y sigue en cada repo hasta que el preprocesador se unifique.

## v0.1.0 — 2026-08-23

Primer paquete. Unifica en un solo lugar el motor de búsqueda, el núcleo del
MCP, el gate del edge y el guard de fuga que vivían forkeados en `oba-docs`,
`odumbo-docs` y `adhoc-docs` (ADR 0006 y 0007 de `knowledge-management`,
Etapa A de la spec `arquitectura-plataforma-docs`). No es un merge: cada
diferencia se clasificó como fix, dialecto del eje, dominio del corpus o ruido,
y **los fixes se conservan todos**. La evidencia, archivo por archivo y con
`archivo:línea`, está en `docs/unificacion/`.

### El contrato, que antes no existía

- config: `docs.config.json` tiene schema publicado (`schema/docs.config.schema.json`),
  `schemaVersion` y validador propio sin dependencias (`lib/config.mjs`). Antes
  eran tres esquemas distintos y ningún validador: "ahí empezó el fork".
- config: el eje del corpus es UN objeto (`{ tipo: version|project|none,
  default?, valores[] }`) y reemplaza a `versions`/`latest`/`versionado`/
  `projects`/`versionLabel`/`versionPath`. `versionedSections` se borra (era
  código muerto: cero lecturas en los tres repos).
- config: `deploy.guardDeFuga` es obligatorio — la ausencia del guard de fuga
  deja de poder ser silenciosa (se declara con `motivo`).
- índice: `schemaVersion`, `build.audiencia` (una sola clave, en castellano),
  `build.eje`, `build.metadata`, `build.conCuerpo`, `articulos[].eje` y
  `articulos[].id` emitido por el build (`${eje ?? '*'}::${slug}`).
- los dos lectores TIRAN si el emisor declara un `schemaVersion` más nuevo del
  que saben leer, y si no lo declara. Nada de degradar en silencio.

### Del motor de búsqueda — rescatado de `oba-docs` (los fixes que nunca se propagaron)

- indice: STOPWORDS del español + `processTerm` compartido entre indexado y
  query (fix #11). Sin esto, "quiero saber cómo hago para dar por pagada una
  factura" devolvía cero: cada palabra de relleno era un filtro más.
- indice: fallback automático a OR cuando el AND da 0, con `modo:
  "or-fallback"` y una `nota` que le pide al agente verificar pertinencia antes
  de citar (fix #12). Los filtros por metadata siguen exactos y duros en los
  dos modos.
- indice: los artículos fuera del eje (`eje: null`, el cross-version de
  `relacion/`) pasan cualquier filtro del eje y `leer()` los devuelve para
  cualquier valor pedido. Sin esto, TODO el contenido cross-version era
  invisible en la práctica: la skill del consumidor filtra siempre por versión.
- indice: hint de "tu query es toda palabras vacías", y el texto del hint de
  filtros consciente del fallback OR.
- mcp-handler: la prosa de `buscar()` que describe el or-fallback y los
  artículos cross-eje. Estaba sólo en `oba-docs` y era la mejor descripción de
  tool de las tres — al unificar se perdía.

### Del motor de búsqueda — rescatado de `adhoc-docs`

- indice: `motivo` machine-readable en los soft-fail de `leer()`
  (`slug-inexistente`, `slug-fuera-del-valor-pedido`, `ambiguo-en-eje`): el
  agente ramifica sin parsear castellano.
- indice: URLs absolutas también en las sugerencias de los soft-fail (antes la
  mitad de las URLs de una misma respuesta eran pegables en un ticket y la otra
  mitad no).
- indice: `leer()` devuelve ambigüedad estructurada en vez de elegir cuando el
  corpus no declara `eje.default`; `buscar()` sin filtro del eje avisa que los
  resultados vienen mezclados de varios valores — ahora para los dos ejes, no
  sólo para `project`.
- indice: el label del valor del eje viaja a la respuesta, y `mapa()` expone los
  valores DECLARADOS además de los presentes (un valor declarado que no aparece
  no tiene docu o su fetch falló, y eso se ve).

### Del motor de búsqueda — rescatado de `odumbo-docs`

- indice / mcp-handler: el eje es configurable y **no se ofrece lo que no
  existe**: con `eje.tipo: "none"` el MCP no expone el filtro del eje, y sin
  `metadata.modules` no expone `modules`. Una tool que ofrece un filtro sin
  contenido detrás miente y manda al agente a reintentar contra una pared.
- indice: `mapa()` no emite listas vacías del eje: un `valores: []` con un
  `default: null` al lado invita al agente a preguntarse qué falta.

### Seguridad

- [seguridad] gate: fail-closed sobre la VARIABLE y no sólo sobre su valor.
  `DOCS_AUDIENCE` ausente o desconocida es 503 y corta todo — HTML, índice de
  búsqueda, assets y el MCP incluso con Bearer válido. En `oba-docs` la línea
  era `if (env.DOCS_AUDIENCE !== 'interno') return null` y el sitio quedaba
  público POR DESCARTE; las env vars de Vercel se hornean en el build, así que
  un deployment buildeado antes de que la variable existiera se quedaba sin
  gate para siempre (le pasó).
- [seguridad] gate: el default de `audiencias` es `['interno']`, el estricto.
  Un consumidor que se olvida de declarar la lista obtiene gate incondicional,
  no sitio abierto. Si el olvido cuesta algo, que cueste disponibilidad.
- [seguridad] gate: fail-closed también en la capa función (`mcp-handler`), no
  sólo en el edge: audiencia ausente o no servible es 503 para todo, incluido
  el GET informativo. Cubre el modo de falla de la función invocada sin pasar
  por el middleware.
- [seguridad] gate: el 503 no delata que detrás hay un sitio interno, no se
  indexa (`X-Robots-Tag`) y no se cachea.
- [seguridad] guard: el guard de fuga entra al paquete como bin
  (`docs-guard-fuga`) y por lo tanto entra a `adhoc-docs`, que no lo tenía.
- [seguridad] guard: la audiencia esperada sale de `VERCEL_PROJECT_ID` contra
  `deploy.proyectos`, no de `DOCS_AUDIENCE` — la versión vieja comparaba la env
  var contra un archivo escrito DESDE esa env var: una tautología que aprobaba
  el modo de falla que decía atacar.
- [seguridad] guard: cuatro refuerzos de estrictez — contrato ilegible o
  inválido falla con nombre (antes era un `TypeError`), `--esperada` se rechaza
  corriendo en Vercel (antes se ignoraba en silencio, y era el camino corto
  para neutralizar la fuente independiente desde el buildCommand), y el chequeo
  de `.guard/` dentro de la salida ya no depende de que haya sondas.
- [seguridad] guard: el índice del MCP (`api/_generated/index.json`) se escanea
  aunque viva fuera de la salida del sitio: es el artefacto con el cuerpo
  entero de cada artículo, el más caro de fugar.
- [seguridad] guard: falsos positivos que bloquearon deploys limpios, cerrados
  — sondas por trigramas (no palabras sueltas del bundle de React), tags HTML
  removidos antes de normalizar, JSON decodificado con `JSON.parse` y no con
  regex sobre los escapes, y límites de palabra con lookaround en vez de `\b`
  (que es ASCII y se rompe con acentos).
- auth: `igual()` documenta lo que hace de verdad. El comentario de `oba-docs`
  ("hasheamos primero, dos digests de 32 bytes") describía un código que no
  existe — un comentario que miente sobre una comparación en tiempo constante
  es una trampa para el próximo que la toque.
- tokens: la gramática de `DOCS_MCP_TOKENS` vive una sola vez, compartida entre
  el edge (que compara con su `equal()` propio) y la función (que usa
  `node:crypto`). Dos parsers del mismo formato divergen, y cuando divergen el
  gate y el `withMcpAuth` dejan de estar de acuerdo sobre qué token vale.

### Herramientas nuevas del paquete

- `docs-guard-fuga`: el guard, como bin, con paths por argumento.
- `docs-drift-check`: mide el rezago del pin de un consumidor contra el último
  tag, falla si hay `[seguridad]` de guard o gate sin adoptar, y siempre
  reporta el lag en días (el insumo de la alarma de la Etapa B). Sin red, exit
  0 con warning: GitHub caído no puede volverse un build caído.
- suites del paquete: `buscar`, `mcp`, `middleware`, `guard`, `config` y
  `bloques` (esta última necesita un repo de contenido y se skipea con motivo
  si no hay).

### Cambios de comportamiento observables para los consumidores

- el GET informativo del MCP devuelve **503** si el deployment no declara una
  audiencia servible (antes devolvía el cartel).
- `leer()` sin valor del eje ya no cae a `candidatos[0]`: o elige el `default`
  declarado **y lo dice** (`elegidoPor: "default"`), o devuelve ambigüedad.
- `otrasVersiones` / `mismoSlugEnOtrosProjects` → **`otrosDelEje`**
  (`[{ valor, url }]`).
- `mapa()` devuelve el eje como objeto (`eje: { tipo, param, valores, default?,
  declarados? }`) y ya no `versionado` / `latest` / `versiones` / `projects`.
- los builds tienen que emitir `schemaVersion`, `build.audiencia`, `build.eje`,
  `build.conCuerpo` y `articulos[].id`; los índices viejos no se leen.
