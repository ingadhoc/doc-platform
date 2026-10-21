/**
 * The site's search box, on the same engine as the MCP (task 75112). Replaces
 * the one from `@easyops-cn/docusaurus-search-local`, whose layout it keeps;
 * the combobox is ours, without `@easyops-cn/autocomplete.js`.
 */

import React, { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import { useHistory, useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { useDocSet } from '@theme/NavbarItem/docSet';

import { cargarIndice, precargarCuandoEsteLibre } from '../buscador/cliente';
import { Marcado, useBusqueda, useEje, useUrlDelIndice } from '../buscador/comun';
import { COMBOBOX_INICIAL, accionDeTecla, combobox, rutaDelHit } from '../buscador/logica.mjs';

export default function SearchBar({ handleSearchBarToggle }) {
  const history = useHistory();
  const location = useLocation();
  const baseUrl = useBaseUrl('/');
  const urlBuscar = useBaseUrl('/search');
  const docSet = useDocSet()?.id;
  const eje = useEje();
  const url = useUrlDelIndice(eje);
  const id = useId();
  const input = useRef(null);

  const [q, setQ] = useState(location.state?.buscador?.q ?? '');
  const [enfocado, setEnfocado] = useState(false);
  // after mount: the server render does not know the platform
  const [teclaDelAtajo, setTeclaDelAtajo] = useState('ctrl');
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setTeclaDelAtajo('⌘');
  }, []);
  const [lista, despachar] = useReducer(combobox, COMBOBOX_INICIAL);
  const { respuesta, cargando, error } = useBusqueda(url, q, { docSet });
  const hits = respuesta?.resultados ?? [];

  useEffect(() => precargarCuandoEsteLibre(url), [url]);
  useEffect(() => {
    despachar({ tipo: 'resultados', total: hits.length });
  }, [respuesta]); // eslint-disable-line react-hooks/exhaustive-deps

  // The page highlight belongs to the query that opened it: emptying the box
  // drops it (task 76999).
  const quitarResaltadoDePagina = useCallback(() => {
    if (location.state?.buscador) history.replace({ ...location, state: null });
  }, [history, location]);

  const elegir = useCallback(
    (hit) => {
      despachar({ tipo: 'cerrar' });
      input.current?.blur();
      history.push(rutaDelHit(hit, baseUrl), { buscador: { q: q.trim(), resaltar: hit.resaltar } });
    },
    [history, baseUrl, q],
  );

  const verTodos = `${urlBuscar}?${new URLSearchParams({ q: q.trim(), ...(eje ? { eje } : {}), ...(docSet ? { docSet } : {}) })}`;

  const alCambiar = (e) => {
    setQ(e.target.value);
    despachar({ tipo: 'abrir' });
    if (!e.target.value) quitarResaltadoDePagina();
  };
  const alTeclear = (e) => {
    const accion = accionDeTecla(e, lista);
    if (!accion) return;
    e.preventDefault();
    if (accion.tipo === 'elegir') elegir(hits[accion.indice]);
    else if (accion.tipo === 'limpiar') limpiar();
    else despachar(accion);
  };
  const limpiar = () => {
    setQ('');
    quitarResaltadoDePagina();
    input.current?.focus();
  };
  const alEnfocar = () => {
    setEnfocado(true);
    despachar({ tipo: 'abrir' });
    cargarIndice(url).catch(() => {});
    handleSearchBarToggle?.(true);
  };
  const alDesenfocar = () => {
    setEnfocado(false);
    despachar({ tipo: 'cerrar' });
    handleSearchBarToggle?.(false);
  };

  useEffect(() => {
    const atajo = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', atajo);
    return () => document.removeEventListener('keydown', atajo);
  }, []);

  const abierto = lista.abierto && enfocado && q.trim() !== '' && (respuesta || error);
  const idLista = `${id}-lista`;
  const idOpcion = (i) => `${id}-opcion-${i}`;

  return (
    <div className={`navbar__search buscador${enfocado ? ' buscador--enfocado' : ''}`}>
      <input
        ref={input}
        className="navbar__search-input buscador__entrada"
        type="search"
        placeholder="Buscar"
        aria-label="Buscar en la documentación"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(abierto)}
        aria-controls={idLista}
        aria-activedescendant={abierto && lista.activo >= 0 ? idOpcion(lista.activo) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={alCambiar}
        onKeyDown={alTeclear}
        onFocus={alEnfocar}
        onBlur={alDesenfocar}
        onMouseEnter={() => cargarIndice(url).catch(() => {})}
      />
      {cargando && enfocado && <span className="buscador__cargando" aria-hidden="true" />}
      {q ? (
        <button type="button" className="buscador__limpiar" aria-label="Borrar la búsqueda" onMouseDown={(e) => e.preventDefault()} onClick={limpiar}>
          ✕
        </button>
      ) : (
        <span className="buscador__atajo" aria-hidden="true">
          <kbd>{teclaDelAtajo}</kbd>
          <kbd>K</kbd>
        </span>
      )}
      <div className="buscador__desplegable" hidden={!abierto} onMouseDown={(e) => e.preventDefault()}>
        <ul id={idLista} role="listbox" aria-label="Resultados" className="buscador__lista">
          {hits.map((hit, i) => (
            <li
              key={hit.slug}
              id={idOpcion(i)}
              role="option"
              aria-selected={i === lista.activo}
              className={`buscador__opcion${i === lista.activo ? ' buscador__opcion--activa' : ''}`}
              onMouseMove={() => i !== lista.activo && despachar({ tipo: 'apuntar', indice: i })}
              onClick={() => elegir(hit)}
            >
              <span className="buscador__titulo">
                <Marcado texto={hit.title} rangos={hit.rangosTitulo} />
              </span>
              {hit.ancla && hit.ancla !== hit.title && (
                <span className="buscador__ancla">
                  <Marcado texto={hit.ancla} rangos={hit.rangosAncla} />
                </span>
              )}
              {hit.fragmento && (
                <span className="buscador__fragmento">
                  <Marcado texto={hit.fragmento} rangos={hit.rangosFragmento} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {error ? (
          <p className="buscador__vacio">No pudimos cargar el buscador. Probá de nuevo en un momento.</p>
        ) : hits.length === 0 ? (
          <p className="buscador__vacio">No encontramos nada para «{respuesta?.q}».</p>
        ) : (
          <a
            className="buscador__ver-todos"
            href={verTodos}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) return;
              e.preventDefault();
              despachar({ tipo: 'cerrar' });
              input.current?.blur();
              history.push(verTodos);
            }}
          >
            Ver los {respuesta.total} resultados
          </a>
        )}
      </div>
    </div>
  );
}
