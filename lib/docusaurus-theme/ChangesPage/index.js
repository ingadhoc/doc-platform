/**
 * The `/changes` page of a PR preview: the pages the PR changes, with a link
 * to each one in the preview and the diff of its text. The data comes from
 * `lib/cambios.mjs`, at build time.
 */

import React from 'react';
import Head from '@docusaurus/Head';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

import { rutaDelHit } from '../buscador/logica.mjs';

const ESTADO = { modificada: 'Modificada', nueva: 'Nueva', borrada: 'Borrada' };
const CAMPO = { titulo: 'Título', descripcion: 'Descripción' };

const cuenta = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

function Partes({ partes }) {
  return partes.map((p, i) =>
    p.tipo === 'agregado' ? <ins key={i}>{p.texto}</ins> : p.tipo === 'quitado' ? <del key={i}>{p.texto}</del> : <span key={i}>{p.texto}</span>,
  );
}

function Bloque({ bloque }) {
  if (bloque.tipo === 'omitido') {
    return <div className="cambios__omitido">{cuenta(bloque.lineas, 'línea sin cambios', 'líneas sin cambios')}</div>;
  }
  if (bloque.tipo === 'contexto') return <div className="cambios__contexto">{bloque.lineas.join('\n')}</div>;
  return (
    <div className="cambios__cambio">
      <Partes partes={bloque.partes} />
    </div>
  );
}

// A deleted page is no longer in the preview: its old URL goes as text.
function Versiones({ pagina, baseUrl }) {
  return (
    <ul className="cambios__versiones">
      {pagina.versiones.map((v) => (
        <li key={v.eje ?? '*'}>
          {pagina.estado === 'borrada' ? (
            <span>{v.label ? `${v.label}: ${v.url}` : v.url}</span>
          ) : (
            <a href={rutaDelHit(v, baseUrl)}>{v.label ? `Ver en ${v.label}` : 'Ver la página'}</a>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ChangesPage({ cambios }) {
  const baseUrl = useBaseUrl('/');
  const { resumen, paginas } = cambios;
  const desglose = [
    resumen.modificadas && cuenta(resumen.modificadas, 'modificada', 'modificadas'),
    resumen.nuevas && cuenta(resumen.nuevas, 'nueva', 'nuevas'),
    resumen.borradas && cuenta(resumen.borradas, 'borrada', 'borradas'),
  ].filter(Boolean);

  return (
    <Layout>
      <Head>
        <title>Cambios de este PR</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="container margin-vert--lg cambios">
        <h1>Cambios de este PR</h1>
        {paginas.length === 0 ? (
          <p>Este PR no cambia el título ni el texto de ninguna página.</p>
        ) : (
          <p>
            {cuenta(paginas.length, 'página', 'páginas')}: {desglose.join(', ')}. Lo tachado sale y lo resaltado entra.
          </p>
        )}
        {paginas.map((p, i) => (
          <section key={i} className="cambios__pagina">
            <h2>
              <span className={`cambios__estado cambios__estado--${p.estado}`}>{ESTADO[p.estado]}</span> {p.titulo}
            </h2>
            <Versiones pagina={p} baseUrl={baseUrl} />
            {p.campos?.map((c) => (
              <p key={c.campo} className="cambios__campo">
                <strong>{CAMPO[c.campo]}:</strong> <Partes partes={c.partes} />
              </p>
            ))}
            {p.bloques?.length > 0 && (
              <div className="cambios__diff">
                {p.bloques.map((b, j) => (
                  <Bloque key={j} bloque={b} />
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
    </Layout>
  );
}
