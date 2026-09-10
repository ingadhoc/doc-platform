import ComponentTypesInicial from '@theme-init/NavbarItem/ComponentTypes';
import SelectorDeDocumentacion from '@theme/NavbarItem/SelectorDeDocumentacion';

/**
 * El mapa de tipos de item del navbar, apilado sobre el de theme-classic.
 *
 * `@theme-init` y no `@theme-original`: quien envuelve es un plugin. Ver
 * `MDXComponents.js` de esta carpeta.
 *
 * Agrega UNO: `custom-selectorDeDocumentacion`. El prefijo `custom-` no es
 * decorativo — es la convención con la que Docusaurus valida tipos de item que
 * no son suyos (`NavbarItem/index.js`); sin él, el schema Joi de
 * `theme-classic/lib/options.js` rechaza el item y el build falla.
 */
export default {
  ...ComponentTypesInicial,
  'custom-selectorDeDocumentacion': SelectorDeDocumentacion,
};
