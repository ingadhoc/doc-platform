/**
 * El parseo de la URL de un video, aparte del componente que lo pinta.
 *
 * Está separado de `lib/docusaurus-theme/Video.js` a propósito: el componente
 * necesita React y un bundler para existir, y esto no necesita nada — así se
 * testea con `node --test` como el resto del paquete, sin meterle una toolchain
 * de front al repo (que hoy tiene CERO devDependencies, y es una decisión, no
 * un olvido: ver el README).
 *
 * DOS SALIDAS, NO UNA LISTA DE PROVEEDORES. YouTube es el único caso con
 * miniatura derivable del ID y embed conocido; todo lo demás —Drive, Loom, un
 * .mp4 en un bucket— cae en `enlace` y se abre afuera. Agregar un proveedor
 * nuevo es agregar un `if` acá y nada más: el componente sólo distingue
 * `youtube` de `enlace`.
 */

/** Los IDs de YouTube son 11 caracteres del alfabeto base64url. */
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS_YOUTUBE = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const HOSTS_CORTOS = new Set(['youtu.be', 'www.youtu.be']);

/**
 * Extrae el ID de video de las tres formas de URL de YouTube que aparecen en el
 * contenido migrado:
 *
 *   - `https://www.youtube.com/watch?v=<id>`  (la que copia el navegador)
 *   - `https://youtu.be/<id>`                 (la del botón "Compartir")
 *   - `https://www.youtube.com/embed/<id>`    (la que quedó en los `<iframe>`)
 *
 * Devuelve `null` si la URL no es de YouTube o si el ID no tiene la forma
 * esperada. No adivina: una URL de YouTube sin ID válido es un enlace, no un
 * embed roto.
 */
export function idDeYoutube(url) {
  if (typeof url !== 'string' || url.trim() === '') return null;

  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();
  const segmentos = u.pathname.split('/').filter(Boolean);

  if (HOSTS_CORTOS.has(host)) {
    const id = segmentos[0];
    return id && ID_YOUTUBE.test(id) ? id : null;
  }

  if (HOSTS_YOUTUBE.has(host)) {
    if (segmentos[0] === 'watch') {
      const id = u.searchParams.get('v');
      return id && ID_YOUTUBE.test(id) ? id : null;
    }
    // `/embed/<id>`, `/live/<id>` y `/shorts/<id>` comparten la forma.
    if (['embed', 'live', 'shorts', 'v'].includes(segmentos[0])) {
      const id = segmentos[1];
      return id && ID_YOUTUBE.test(id) ? id : null;
    }
  }

  return null;
}

/**
 * La decisión completa, en un objeto: qué se pinta y con qué URLs.
 *
 *   { tipo: 'youtube', id, miniatura, embed }
 *   { tipo: 'enlace', url }
 *   null   — si no hay URL utilizable (el componente no pinta nada)
 *
 * `hqdefault.jpg` y no `maxresdefault.jpg`: la máxima resolución NO existe para
 * todos los videos (los subidos en baja devuelven 404 y el hueco queda gris),
 * y `hqdefault` está garantizada. 480×360 alcanza para una caja de 16:9 en una
 * columna de texto.
 */
export function parsearUrlVideo(url) {
  const id = idDeYoutube(url);
  if (id) {
    return {
      tipo: 'youtube',
      id,
      miniatura: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
      // `autoplay=1` sólo se pide DESPUÉS del click, que es lo que lo hace
      // legítimo: el navegador lo permite porque hubo gesto del usuario, y
      // nadie carga un iframe de YouTube que no pidió.
      embed: `https://www.youtube.com/embed/${id}?autoplay=1`,
    };
  }
  if (typeof url === 'string' && url.trim() !== '') {
    return { tipo: 'enlace', url: url.trim() };
  }
  return null;
}
