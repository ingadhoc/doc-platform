/**
 * El badge de país de la página: "Solo Argentina", "Solo Chile y Uruguay".
 *
 * QUÉ ES `paises` Y QUÉ NO. Es una FACETA de dominio, como `modules`: no
 * multiplica el build, no bifurca la URL y no oculta bloques (no existe
 * `:::solo-pais`). Un solo árbol, una sola página. Lo único que agrega en el
 * sitio es este cartel, que le dice al lector —antes de que empiece a
 * configurar— que lo que sigue no aplica donde él opera.
 *
 * LA AUSENCIA NO SE PINTA. Sin `paises:` en el frontmatter la página es
 * universal, y una universal NO lleva badge: un "Aplica a todos los países"
 * arriba de cada artículo del manual es ruido en el 95% de las páginas. El
 * badge es la excepción, no el default.
 *
 * TAMPOCO SE PINTA EN `localizaciones/`. Ahí el país lo deriva el build del
 * path y no está en el frontmatter del fuente, así que este componente no lo
 * ve — que es lo correcto: la página ya vive bajo *Localizaciones › Chile* y
 * repetir "Solo Chile" arriba del título es decir dos veces lo mismo. El país
 * derivado sí viaja al índice del agente, donde nadie ve la ruta.
 *
 * `@theme-init` Y NO `@theme-original`: la razón está escrita entera en
 * `MDXComponents.js` de esta misma carpeta. Desde un componente de PLUGIN,
 * `@theme-original/DocItem/Content` se resuelve a ESTE archivo y el build
 * muere con `Cannot access '__WEBPACK_DEFAULT_EXPORT__' before initialization`.
 *
 * ATRIBUTOS EN camelCase (`className`, no `class`). React descarta en silencio
 * los atributos DOM en minúscula; ya pasó con los `<video>` del contenido
 * migrado.
 */

import React from 'react';

import { useDoc } from '@docusaurus/plugin-content-docs/client';
import Content from '@theme-init/DocItem/Content';

/**
 * Los nombres que ve el lector. El código pelado ("Solo UY") es jerga interna:
 * el manual lo lee un contador, no el build.
 *
 * Es un mapa y no una llamada a `Intl.DisplayNames`: son tres países, el
 * castellano de la interfaz no depende del navegador del que lee, y un
 * `Intl.DisplayNames` devuelve "Argentina" pero también sorpresas por locale.
 * Un país que entre al vocabulario de un repo y no esté acá cae al código, que
 * es feo pero no miente.
 */
const NOMBRES = {
  AR: 'Argentina',
  CL: 'Chile',
  UY: 'Uruguay',
};

/** "Argentina" · "Chile y Uruguay" · "Argentina, Chile y Uruguay". */
function enumerar(nombres) {
  if (nombres.length <= 1) return nombres[0] ?? '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

export default function ContentConPais(props) {
  const { metadata } = useDoc();
  const declarados = metadata?.frontMatter?.paises;
  const paises = (Array.isArray(declarados) ? declarados : declarados ? [declarados] : [])
    .map((p) => String(p).trim().toUpperCase())
    .filter(Boolean);

  if (paises.length === 0) return <Content {...props} />;

  const nombres = paises.map((p) => NOMBRES[p] ?? p);

  return (
    <>
      <div className="docs-paises" role="note">
        <span className="docs-paises-etiqueta">Solo {enumerar(nombres)}</span>
      </div>
      <Content {...props} />
    </>
  );
}
