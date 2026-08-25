/**
 * El plugin de Docusaurus de la plataforma: lo único que un repo consumidor
 * tiene que agregar a su `docusaurus.config.js` para tener los componentes MDX
 * y los estilos del paquete.
 *
 *   // site/docusaurus.config.js
 *   plugins: [
 *     require.resolve('@ingadhoc/docs-platform/docusaurus-plugin'),
 *     …
 *   ]
 *
 * `.cjs` a propósito. El paquete es `"type": "module"`, pero el
 * `docusaurus.config.js` de los tres repos es CommonJS (Docusaurus impide que
 * el sitio sea `"type": "module"`, lo mismo que ya obliga a importar el gate
 * por ruta relativa en el middleware — está en el README). Un `.js` de este
 * paquete sería ESM y el `require` del config fallaría según la versión de
 * Node. La extensión saca la ambigüedad.
 *
 * DOS COSAS Y NADA MÁS:
 *
 *   - `getThemePath` — publica `lib/docusaurus-theme/` como capa de theme, así
 *     `MDXComponents.js` de acá se apila sobre el de theme-classic (que sigue
 *     alcanzable como `@theme-original/MDXComponents`).
 *   - `getClientModules` — mete el CSS en el bundle sin pedirle al consumidor
 *     que lo importe en su `custom.css`.
 *
 * POR QUÉ LA CARPETA SE LLAMA `docusaurus-theme`. No es cosmético: el webpack
 * de Docusaurus NO transpila nada de `node_modules` salvo lo que matchee
 * `/docusaurus(?:(?!node_modules).)*\.jsx?$/` (`lib/webpack/base.js`,
 * `excludeJS`). Sin la palabra `docusaurus` en la ruta, el JSX de `Video.js`
 * llega crudo al bundler y el build revienta con un error de sintaxis. Si
 * alguna vez se renombra esta carpeta, el build de los tres sitios se cae.
 */

const path = require('node:path');

module.exports = function pluginDocsPlatform() {
  return {
    name: '@ingadhoc/docs-platform',
    getThemePath() {
      return path.resolve(__dirname, 'docusaurus-theme');
    },
    getClientModules() {
      return [path.resolve(__dirname, 'docusaurus-theme', 'styles.css')];
    },
  };
};
