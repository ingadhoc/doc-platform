/**
 * `<Video url="…" title="…"/>` — el video del contenido, sin iframe hasta que
 * alguien lo pida (patrón "lite-youtube").
 *
 * POR QUÉ NO ES UN `<iframe>` DIRECTO. Un embed de YouTube trae ~1 MB de JS y
 * varias conexiones a terceros, y se paga aunque nadie mire el video. En una
 * página de manual con dos o tres videos eso es la mitad del peso de la página.
 * Acá el load pinta una `<img>` (la miniatura real, derivada del ID) con un
 * botón de play encima; el `<iframe>` recién nace en el click, ya con
 * `autoplay=1`, así que el video arranca solo y el click no se pierde.
 *
 * QUÉ NO ES YOUTUBE. Drive, Loom, un `.mp4` suelto: no hay miniatura derivable
 * ni embed confiable (Drive rompe el embed cuando el archivo no es público, y
 * el modo de falla es una caja gris sin explicación). Esos casos rinden un
 * botón que abre la URL en otra pestaña — feo de menos, pero nunca miente.
 *
 * ATRIBUTOS EN camelCase. React descarta en silencio los atributos DOM en
 * minúscula (`allowfullscreen`, `frameborder`) salvo por un warning en consola.
 * Ya pasó con los `<video>` del contenido migrado —cargaban y se quedaban en el
 * primer frame— y por eso los repos tienen un lint del estándar que lo atrapa
 * (`falla-media.md` en oba-docs). Este archivo no puede reintroducirlo.
 */

import React, { useState } from 'react';

import { parsearUrlVideo } from '../video-url.mjs';

/** Lo que dice el botón cuando el `.md` no declaró `title`. */
const SIN_TITULO = 'Ver video';

export default function Video({ url, title }) {
  const [reproduciendo, setReproduciendo] = useState(false);
  const video = parsearUrlVideo(url);

  // Sin URL utilizable no se pinta un placeholder roto: no se pinta nada.
  if (!video) return null;

  const etiqueta = title && title.trim() !== '' ? title.trim() : SIN_TITULO;

  if (video.tipo !== 'youtube') {
    return (
      <a
        className="button button--primary button--lg docs-video-enlace"
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {title && title.trim() !== '' ? `Ver video: ${etiqueta}` : SIN_TITULO}
      </a>
    );
  }

  if (reproduciendo) {
    return (
      <iframe
        className="docs-video"
        src={video.embed}
        title={etiqueta}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      className="docs-video docs-video-poster"
      aria-label={`Reproducir video: ${etiqueta}`}
      onClick={() => setReproduciendo(true)}
    >
      {/* `alt=""`: la miniatura es decorativa — lo que nombra al video es el
          `aria-label` del botón, y repetirlo acá se lo lee dos veces. */}
      <img
        className="docs-video-miniatura"
        src={video.miniatura}
        alt=""
        loading="lazy"
        width="480"
        height="360"
      />
      <span className="docs-video-play" aria-hidden="true">
        <svg viewBox="0 0 68 48" focusable="false">
          <path
            className="docs-video-play-fondo"
            d="M66.52 7.74a8 8 0 00-5.65-5.67C55.79 1 34 1 34 1S12.21 1 7.13 2.07a8 8 0 00-5.65 5.67C.4 12.85.4 24 .4 24s0 11.15 1.08 16.26a8 8 0 005.65 5.67C12.21 47 34 47 34 47s21.79 0 26.87-1.07a8 8 0 005.65-5.67C67.6 35.15 67.6 24 67.6 24s0-11.15-1.08-16.26z"
          />
          <path className="docs-video-play-flecha" d="M27 34V14l18 10-18 10z" />
        </svg>
      </span>
    </button>
  );
}
