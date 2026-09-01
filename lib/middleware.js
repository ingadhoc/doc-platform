/**
 * Gate de acceso del sitio. UNIFICADO (etapa A) desde los tres forks
 * (oba-docs / odumbo-docs / adhoc-docs). Este archivo se queda en la RAÍZ de
 * cada repo consumidor —Vercel lo exige ahí— y es solo pegamento: la decisión
 * completa vive en `decidir()`, que viene del paquete pineado.
 *
 * Un build de Docusaurus es HTML estático: no hay servidor ni sesión donde
 * poner un login. Este middleware es el portero, y corre en el edge ANTES de
 * servir cualquier archivo — HTML, JS, CSS, el índice de búsqueda y la
 * función del MCP.
 *
 * TRES REGLAS QUE NO SE TOCAN
 *
 * 1. NO declarar `config.matcher`. Sin matcher, Vercel invoca el middleware en
 *    todas las rutas del proyecto. Un matcher con exclusiones es el único modo
 *    de que un asset saltee el gate, y el contenido interno vive también en el
 *    índice de búsqueda, no solo en el HTML. (El matcher default de Next.js
 *    excluye `api` como PRIMERA exclusión: copiarlo dejaría el MCP corriendo
 *    sin gate y en silencio. Agregar un matcher "para incluir /api/mcp" sería
 *    el bug, no el arreglo.) Hay un test que lo verifica sobre el CÓDIGO.
 *
 * 2. Fail-closed, y sobre la VARIABLE, no sobre su valor. Pedir credencial
 *    nunca depende de que la credencial exista, y "no sé qué audiencia soy" no
 *    se resuelve sirviendo todo: `DOCS_AUDIENCE` ausente o desconocida es 503.
 *    Es el fix que odumbo-docs y adhoc-docs tenían y oba-docs no — allá la
 *    línea era `if (env.DOCS_AUDIENCE !== 'interno') return null` y el sitio
 *    quedaba público POR DESCARTE. Lo mismo vale para el MCP y
 *    DOCS_MCP_TOKENS, y para DOCS_SESION_SECRET en el camino humano.
 *
 * 3. LOS PREVIEWS ENTRAN POR LA MISMA PUERTA. El gate no mira `VERCEL_ENV` ni
 *    `VERCEL_URL`: cualquier deployment del proyecto —producción, preview de
 *    PR, branch alias— pasa por acá con la misma decisión. La contracara
 *    operativa es que `DOCS_AUDIENCE` tiene que estar seteada en TODOS los
 *    environments del proyecto (Production, Preview y Development), porque las
 *    env vars de Vercel se hornean en el build: un deployment buildeado antes
 *    de que existiera la variable queda sin gate para siempre (le pasó a
 *    oba-docs). Con el fail-closed de la regla 2, ese deployment devuelve 503
 *    en vez de servir documentación interna abierta. El test negativo de esto
 *    vive en `middleware.test.mjs`.
 *
 * Variables de entorno del proyecto:
 *   DOCS_AUDIENCE      = una de AUDIENCIAS (OBLIGATORIA: sin ella, 503)
 *   DOCS_SESION_SECRET = secreto de firma de la sesión (humanos, login con Odoo)
 *   DOCS_MCP_TOKENS    = "tuqui:tok1,claude-code:tok2" (máquinas, Bearer)
 *
 * Y las del login con Odoo, que consumen las funciones de `/api/auth/*` y no
 * este middleware: DOCS_ODOO_URL, DOCS_ODOO_CLIENT_ID, DOCS_ODOO_CLIENT_SECRET,
 * DOCS_ODOO_SCOPE, DOCS_SITIO_URL.
 *
 * POR QUÉ EL GATE NO SE DESARMA EN UN SITIO PÚBLICO (odumbo): el gate es la
 * única pieza que decide, en runtime, si este deploy sirve contenido a
 * cualquiera. Sacarlo "porque hoy no hace falta" convierte una decisión
 * explícita en una ausencia, y una ausencia no se revisa en un PR.
 *
 * EL GUARD DE FUGA ES LA OTRA MITAD, y no es opcional. El gate protege lo que
 * ya está deployado; el guard (`guard-fuga.mjs`, dentro del buildCommand)
 * impide que el artefacto público contenga contenido interno. Un repo que
 * declare `publico` en AUDIENCIAS sin tener el guard corriendo en su
 * buildCommand está publicando sin red. adhoc-docs no lo tenía y lo suma con
 * el paquete (ADR 0007 + Fase 0 de la spec de arquitectura).
 *
 * ALCANCE: credencial compartida para humanos, sin trazabilidad de quién
 * entró; token por consumidor para máquinas, sin identidad por usuario. Es una
 * decisión de la PoC (tasks 71948 y 71544), no un olvido. El reemplazo previsto
 * es validar contra el OIDC de nuestro Odoo (72391): cambia la función de
 * chequeo, no la arquitectura.
 *
 * LA LÓGICA VIVE EN EL PAQUETE (ESM puro, sin builtins de Node — apto edge y
 * testeable: `tests/middleware.test.mjs` del paquete). NADA de `auth.mjs` en esta capa: usa
 * `node:crypto`, que no existe en el edge. Y el repo raíz NO declara
 * `"type": "module"`: hacerlo rompe el SSG de Docusaurus EN SILENCIO cuando
 * el build corre con cwd en la raíz (páginas cáscara con exit 0 — pasó, CI
 * rojo del 19/08); por eso el código de la plataforma es `.mjs` explícito.
 */

import { next } from '@vercel/functions';

import { decidir } from '@ingadhoc/docs-platform/gate';

/**
 * EJE (audiencia) — LO ÚNICO QUE CAMBIA POR REPO. Las audiencias que este repo
 * sabe emitir, declaradas por código y versionadas en git (el edge no lee del
 * filesystem, así que no salen de `docs.config.json`; tienen que coincidir con
 * el `audiences` de ahí, y el drift-check del CI lo compara).
 *
 * Cualquier valor de DOCS_AUDIENCE fuera de esta lista es 503.
 *
 *   oba-docs / odumbo-docs → ['publico', 'interno']
 *   adhoc-docs             → ['interno']            (no hay build público)
 *
 * Sin el argumento, el paquete asume `['interno']`: el default es el estricto.
 */
const AUDIENCIAS = ['publico', 'interno'];

export default async function middleware(request) {
  const respuesta = await decidir(request, process.env, { audiencias: AUDIENCIAS });
  // Autenticado (o sitio público): sigue al archivo estático / a la función.
  return respuesta ?? next();
}
