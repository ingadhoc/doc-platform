import React from 'react';
import NavbarItemInicial from '@theme-init/NavbarItem';
import {useDocSet} from '@theme/NavbarItem/docSet';

/**
 * Envuelve cada item del navbar para que los links de sección sigan al doc set
 * activo.
 *
 * El item declara a qué documentación pertenece con `docSet: '<id>'`; si el
 * usuario está leyendo otra, el item no se dibuja. Estando en el manual no se
 * ven las ramas de novedades, y al revés — que es exactamente el pedido: quien
 * consulta el manual todos los días no quiere el contenido de transición en su
 * navegación.
 *
 * `@theme-init` Y NO `@theme-original`, por lo mismo que lo explica
 * `MDXComponents.js` de esta misma carpeta: quien envuelve acá es un PLUGIN, y
 * desde un plugin `@theme-original/NavbarItem` se resuelve a ESTE archivo. El
 * síntoma no es un "ciclo" legible — es
 * `RangeError: Maximum call stack size exceeded` en las 1047 páginas.
 *
 * ADITIVO POR DEFECTO. Un item sin `docSet` se dibuja siempre, así que el
 * navbar de un corpus que no usa la feature queda idéntico. Lo mismo si el
 * corpus no declara `docSets`: `useDocSet()` devuelve `null` y no se filtra
 * nada. Es la propiedad que permite publicar esto sin tocar odumbo-docs ni
 * adhoc-docs.
 */
export default function NavbarItem({docSet, ...props}) {
  const activo = useDocSet();
  if (docSet && activo && docSet !== activo.id) return null;
  return <NavbarItemInicial {...props} />;
}
