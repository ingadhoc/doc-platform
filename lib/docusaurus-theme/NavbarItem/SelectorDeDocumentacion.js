import React from 'react';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';
import {useDocSet, valorDelEjeDe, ejeValoresDe} from '@theme/NavbarItem/docSet';
import {useLocation} from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * El selector de documentación: qué documentación estás leyendo.
 *
 * Es un control DISTINTO del selector de versión, y la diferencia importa
 * porque el navbar ya tuvo el problema de mezclar dos ejes en un control. Acá
 * son tres preguntas y tres respuestas: qué documentación (este selector), de
 * qué versión (`docsVersionDropdown`) y qué sección (los links de la
 * izquierda, que este componente hace que cambien con la documentación).
 *
 * CAMBIAR DE DOCUMENTACIÓN CONSERVA LA VERSIÓN. Es la contraparte de que
 * cambiar de versión conserve el artículo: los dos ejes son independientes y
 * ninguno pisa al otro. Sin esto, un cliente parado en la 18 que abre las
 * novedades termina leyendo las de la 19 — el mismo bug que el ADR 0010 de
 * knowledge-management arregló para los links.
 *
 * LAS DOCUS DE OTROS PRODUCTOS VAN ABAJO Y SEPARADAS. Odumbo y Tuqui no son
 * otra documentación de este producto: son otro producto. Van bajo su propio
 * encabezado y abren en pestaña nueva, porque allá ni el selector de versión ni
 * este buscador significan nada. Mezclarlas sin separar sería volver a meter
 * dos ejes en un control.
 */
export default function SelectorDeDocumentacion({docsExternas = [], ...props}) {
  const {siteConfig} = useDocusaurusContext();
  const {pathname} = useLocation();
  const {docSets = [], latestPath} = siteConfig.customFields ?? {};
  const activo = useDocSet();

  // Sin doc sets declarados el item no se dibuja: la feature es opcional y su
  // ausencia tiene que ser indistinguible de que no exista.
  if (!activo) return null;

  // Si el path no arranca con un valor del eje —la home `/`, `/search`, el
  // 404— no hay versión de la que agarrarse y se cae en la última, que es la
  // única respuesta posible. No es cosmético: sin esto el destino queda
  // `/manual`, una ruta que en un sitio versionado NO existe, y con
  // `onBrokenLinks: 'throw'` el build del 404 se cae. Es el mismo fallback que
  // hace el brand del navbar.
  const version = valorDelEjeDe(pathname, ejeValoresDe(siteConfig)) ?? latestPath ?? null;
  const prefijo = version ? `/${version}` : '';

  // Solo los doc sets que EXISTEN en este valor del eje. Un doc set puede no
  // tener contenido en una versión vieja —«Novedades de la 20» no existe en la
  // 18— y ofrecerlo igual sería un link a una ruta inexistente en cada página
  // de esa versión: con `onBrokenLinks: 'throw'` eso no es un 404, es el build
  // caído. El build emite `ejeValores` por doc set; sin el dato, se ofrece
  // (comportamiento viejo, y el corpus se entera por el build).
  const disponibles = docSets.filter(
    (d) => !version || !Array.isArray(d.ejeValores) || d.ejeValores.includes(version),
  );

  const items = [
    ...disponibles.map((d) => ({
      label: d.label,
      to: `${prefijo}/${d.entrada ?? d.secciones?.[0] ?? d.id}`,
      // `activeBasePath` y no solo `isActive`: el dropdown MOBILE decide si
      // arranca abierto con `containsActiveItems`, que mira `to` y
      // `activeBasePath` e IGNORA `isActive`. Sin esto, en teléfono el selector
      // aparece colapsado aun estando parado adentro de ese doc set.
      activeBasePath: `${prefijo}/${d.entrada ?? d.secciones?.[0] ?? d.id}`,
      isActive: () => d.id === activo.id,
    })),
    ...(docsExternas.length
      ? [
          {type: 'html', value: '<span class="dropdown__sep">Otros productos</span>'},
          ...docsExternas.map((d) => ({label: d.label, href: d.href, target: '_blank'})),
        ]
      : []),
  ];

  return <DropdownNavbarItem {...props} label={activo.label} items={items} />;
}
