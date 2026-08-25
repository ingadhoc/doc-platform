/**
 * El scope global de MDX del sitio: lo que un `.md` de un repo consumidor puede
 * escribir SIN un `import` arriba.
 *
 * Se apila sobre el de theme-classic, no lo reemplaza: los repos siguen
 * teniendo `<Tabs>`, `<details>`, los admonition y todo lo demás. Acá sólo se
 * agregan los componentes de la plataforma.
 *
 * `@theme-init` Y NO `@theme-original`. Los dos existen y sólo uno sirve acá:
 *
 *   - `@theme-original/X` lo usa un componente **swizzleado en el `src/theme`
 *     del sitio**. Un plugin también lo escribe al registrar su theme, y como
 *     el último gana, desde ESTE archivo `@theme-original/MDXComponents` se
 *     resuelve a ESTE archivo. El build no dice "ciclo": dice
 *     `Cannot access '__WEBPACK_DEFAULT_EXPORT__' before initialization` y
 *     `Cannot read properties of undefined (reading 'jsx')` en cada página.
 *   - `@theme-init/X` es el que apunta al theme que proveyó el componente
 *     ORIGINALMENTE (`aliases/index.js`: "only applied once, to the initial
 *     theme that provided this component"). Es el que corresponde cuando quien
 *     envuelve es un plugin, como acá.
 *
 * Un `import` arriba del markdown no es una opción para este contenido: el
 * cuerpo entero de cada artículo viaja al índice para agentes (`emitAgente()`),
 * y una línea de import es ruido en la respuesta del MCP. Por eso el registro
 * es global.
 */

import MDXComponents from '@theme-init/MDXComponents';

import Video from '@theme/Video';

export default {
  ...MDXComponents,
  Video,
};
