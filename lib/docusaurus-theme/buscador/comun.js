import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { ejeValoresDe } from '@theme/NavbarItem/docSet';

import { buscar } from './cliente.js';
import { tramos } from './logica.mjs';

/**
 * The axis value the reader is on, or `eje` when it is one of the site's
 * values (the `/search` page gets it from its URL).
 */
export function useEje(eje) {
  const { siteConfig } = useDocusaurusContext();
  const { pathname } = useLocation();
  const valores = ejeValoresDe(siteConfig);
  if (eje && valores.includes(eje)) return eje;
  const primero = pathname.split('/').filter(Boolean)[0];
  return valores.includes(primero) ? primero : null;
}

/** The URL of the index the box downloads for `eje`. */
export function useUrlDelIndice(eje) {
  return useBaseUrl(`/buscador/${eje ? `${eje}.json` : 'indice.json'}`);
}

/**
 * Runs `q` against the worker and keeps the last answer. An older answer that
 * arrives late never replaces a newer one.
 */
export function useBusqueda(url, q, { docSet, page = 1 } = {}) {
  const [estado, setEstado] = useState({ q: '', respuesta: null, cargando: false, error: null });
  const ultimo = useRef(0);
  useEffect(() => {
    const consulta = q.trim();
    const pedido = ++ultimo.current;
    if (!consulta) {
      setEstado({ q: '', respuesta: null, cargando: false, error: null });
      return;
    }
    setEstado((e) => ({ ...e, cargando: true }));
    buscar(url, { q: consulta, docSet, page }).then(
      (respuesta) => pedido === ultimo.current && setEstado({ q: consulta, respuesta, cargando: false, error: null }),
      (error) => pedido === ultimo.current && setEstado({ q: consulta, respuesta: null, cargando: false, error }),
    );
  }, [url, q, docSet, page]);
  return estado;
}

/** `texto` with the `rangos` marked like the page highlight. */
export function Marcado({ texto, rangos }) {
  return tramos(texto, rangos).map((t, i) =>
    t.marca ? (
      <mark key={i} data-markjs="true">
        {t.texto}
      </mark>
    ) : (
      <React.Fragment key={i}>{t.texto}</React.Fragment>
    ),
  );
}
