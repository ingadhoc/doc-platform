/**
 * The full results page (`/search?q=…`), on the same worker as the box.
 */

import React, { useEffect, useState } from 'react';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import { useHistory, useLocation } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

import { Marcado, useBusqueda, useEje, useUrlDelIndice } from '../buscador/comun';
import { rutaDelHit } from '../buscador/logica.mjs';

function Resultados({ url, q, docSet, page, alElegir }) {
  const { respuesta, error } = useBusqueda(url, q, { docSet, page });
  if (error) return <p>No pudimos cargar el buscador. Probá de nuevo en un momento.</p>;
  if (!respuesta) return null;
  return (
    <ol className="buscador-pagina__lista" start={(respuesta.page - 1) * 10 + 1}>
      {respuesta.resultados.map((hit) => (
        <li key={hit.slug} className="buscador-pagina__resultado">
          <Link to={alElegir(hit)}>
            <Marcado texto={hit.title} rangos={hit.rangosTitulo} />
          </Link>
          {hit.ancla && hit.ancla !== hit.title && (
            <div className="buscador__ancla">
              <Marcado texto={hit.ancla} rangos={hit.rangosAncla} />
            </div>
          )}
          {hit.fragmento && (
            <p className="buscador__fragmento">
              <Marcado texto={hit.fragmento} rangos={hit.rangosFragmento} />
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function SearchPage() {
  const history = useHistory();
  const location = useLocation();
  const baseUrl = useBaseUrl('/');
  const params = new URLSearchParams(location.search);
  const docSet = params.get('docSet') || undefined;
  const eje = useEje(params.get('eje'));
  const url = useUrlDelIndice(eje);
  const qDeLaUrl = params.get('q') ?? '';

  const [q, setQ] = useState(qDeLaUrl);
  const [paginas, setPaginas] = useState(1);
  useEffect(() => setQ(qDeLaUrl), [qDeLaUrl]);
  useEffect(() => setPaginas(1), [q, url, docSet]);

  const { respuesta } = useBusqueda(url, q, { docSet });
  const alCambiar = (e) => {
    setQ(e.target.value);
    const siguiente = new URLSearchParams(location.search);
    siguiente.set('q', e.target.value);
    history.replace({ ...location, search: `?${siguiente}` });
  };
  const destino = (hit) => {
    const [pathname, hash] = rutaDelHit(hit, baseUrl).split('#');
    return { pathname, hash: hash ? `#${hash}` : '', state: { buscador: { q: q.trim(), resaltar: hit.resaltar } } };
  };

  return (
    <Layout>
      <Head>
        <title>{q ? `Buscar «${q}»` : 'Buscar'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="container margin-vert--lg buscador-pagina">
        <h1>Buscar en la documentación</h1>
        <input
          className="buscador-pagina__entrada"
          type="search"
          aria-label="Buscar en la documentación"
          placeholder="Qué querés hacer"
          autoComplete="off"
          value={q}
          onChange={alCambiar}
        />
        {q.trim() && respuesta && (
          <p className="buscador-pagina__total" role="status">
            {respuesta.total === 0
              ? `No encontramos nada para «${respuesta.q}».`
              : respuesta.total === 1
                ? '1 resultado'
                : `${respuesta.total} resultados`}
          </p>
        )}
        {q.trim() &&
          Array.from({ length: paginas }, (_, i) => (
            <Resultados key={i} url={url} q={q} docSet={docSet} page={i + 1} alElegir={destino} />
          ))}
        {respuesta && paginas < respuesta.paginas && (
          <button type="button" className="button button--secondary" onClick={() => setPaginas((n) => n + 1)}>
            Ver más resultados
          </button>
        )}
      </main>
    </Layout>
  );
}
