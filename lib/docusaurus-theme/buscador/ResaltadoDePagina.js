/**
 * Marks in the page what the engine found, when the reader arrives from the
 * search box. The query travels in the history state, not in the URL, so a
 * shared or reloaded link never carries a stale highlight (task 76999).
 */

import React, { useEffect } from 'react';
import { useHistory, useLocation } from '@docusaurus/router';

const SALTEAR = 'script, style, mark, button, .buscador-chip';

function marcarEn(raiz, ubicar) {
  const nodos = [];
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.data.trim() && !n.parentElement?.closest(SALTEAR) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (recorrido.nextNode()) nodos.push(recorrido.currentNode);

  const marcas = [];
  for (const nodo of nodos) {
    // right to left, so the earlier positions stay valid after each split
    for (const { pos, largo } of ubicar(nodo.data).reverse()) {
      nodo.splitText(pos + largo);
      const palabra = nodo.splitText(pos);
      const marca = document.createElement('mark');
      marca.dataset.markjs = 'true';
      palabra.replaceWith(marca);
      marca.append(palabra);
      marcas.push(marca);
    }
  }
  return marcas;
}

function desmarcar(marcas) {
  for (const marca of marcas) {
    const padre = marca.parentNode;
    if (!padre) continue;
    marca.replaceWith(...marca.childNodes);
    padre.normalize();
  }
}

export default function ResaltadoDePagina() {
  const history = useHistory();
  const location = useLocation();
  const buscador = location.state?.buscador;

  useEffect(() => {
    if (!buscador?.resaltar) return undefined;
    let cancelado = false;
    let marcas = [];
    // after the MDX content and its code blocks render
    const espera = setTimeout(async () => {
      const { ubicarTerminos } = await import('../../mcp/motor.mjs');
      const raiz = document.querySelector('article');
      if (cancelado || !raiz) return;
      marcas = marcarEn(raiz, (texto) => ubicarTerminos(texto, buscador.resaltar));
    });
    return () => {
      cancelado = true;
      clearTimeout(espera);
      desmarcar(marcas);
    };
  }, [buscador]);

  if (!buscador?.q) return null;
  return (
    <div className="buscador-chip" role="status">
      <span>
        Resaltado: <mark data-markjs="true">{buscador.q}</mark>
      </span>
      <button type="button" className="buscador-chip__quitar" onClick={() => history.replace({ ...location, state: null })}>
        Quitar
      </button>
    </div>
  );
}
