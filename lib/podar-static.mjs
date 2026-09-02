/**
 * Poda de la copia cruda de `static/` en el artefacto del sitio. Corre DENTRO
 * del buildCommand, después del build y ANTES del guard. El CLI es
 * `bin/podar-static.mjs` (`docs-podar-static`); acá está la lógica, sin
 * `process.exit` ni globals, para poder testearla.
 *
 * EL AGUJERO QUE CIERRA. Las imágenes de los repos de contenido viven en
 * `site/static/img/` y se escriben en el markdown como rutas absolutas
 * (`![alt](/img/ejemplo/captura.png)`). Docusaurus resuelve esa ruta contra
 * `static/`, procesa la imagen y la emite hasheada en
 * `assets/images/captura-<hash>.png`, que es lo que el HTML termina sirviendo.
 * Pero ADEMÁS copia `static/` entero a la salida, tal cual. O sea: cada imagen
 * se publica dos veces, y la segunda copia se publica **exista o no una página
 * que la muestre**.
 *
 * Ahí está la fuga. El preprocesador borra el TEXTO de los bloques `:::interno`
 * del build público, pero nadie toca los archivos: una captura referenciada
 * únicamente desde un bloque interno no aparece en ninguna página pública y aun
 * así queda en el artefacto. El guard de fuga no lo veía porque mira TEXTO en
 * los artefactos, y una captura no tiene texto que grepear.
 *
 * POR QUÉ MIRAR LA SALIDA Y NO EL FUENTE. La tentación es parsear `content/` y
 * borrar lo que esté referenciado desde bloques internos. Es exactamente el
 * error que `guard-fuga.mjs` documenta en su decisión de diseño 2: un segundo
 * parser del mismo formato diverge del preprocesador, y cuando diverge deja
 * pasar justo la fuga que decía atacar. Acá no se parsea nada del fuente. La
 * regla es sobre el artefacto y no necesita saber qué es "interno":
 *
 *     un archivo de `static/` que NINGÚN artefacto del build referencia
 *     no tiene por qué viajar en el build.
 *
 * Eso cubre la fuga como caso particular —una imagen que solo estaba en un
 * bloque interno no la referencia ninguna página pública— y de paso saca las
 * huérfanas, que en un manual con años de capturas no son pocas.
 *
 * SE COMPARA POR RUTA, NO POR NOMBRE, y no es un detalle de implementación: es
 * la diferencia entre que el bin sirva o no. La primera versión indexaba por
 * basename y dos archivos con el mismo nombre en carpetas distintas se
 * salvaban juntos — `img/publico/captura.png` mantenía viva a
 * `img/interno/captura.png`. Con capturas de manual (`captura.png`, `1.png`,
 * `factura.png`) esa colisión no es hipotética, y le pasaba por al lado
 * exactamente al caso que el bin existe para atajar. Lo encontró una revisión
 * del PR, reproducido. El fallback por basename sobrevive SOLO cuando el
 * nombre es único entre los candidatos; si es ambiguo y la referencia no trae
 * directorio, se conserva y se REPORTA, porque ahí ni el bin ni nadie puede
 * saber a cuál apuntaba.
 *
 * QUÉ NO SE PODA. Todo lo que aparezca mencionado en cualquier artefacto
 * textual del build (HTML, JS, JSON, CSS, mapas, manifiestos, markdown), que es
 * donde Docusaurus emite cualquier referencia: el logo y el favicon del
 * `docusaurus.config.js` se referencian desde el HTML y sobreviven solos, sin
 * necesidad de una lista blanca que alguien tendría que mantener.
 *
 * EL MODO DE FALLA. Si el escaneo no detectara una referencia real, la imagen
 * se borraría y quedaría rota en el sitio. Es visible —una imagen rota se ve—,
 * pero para que no pase en silencio el CLI reporta cuántos archivos borró,
 * cuántos conservó y cuántos quedaron ambiguos, y `--dry-run` lista sin tocar
 * nada.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Artefactos donde puede aparecer una referencia a un archivo de `static/`.
 *
 * `.md` está en la lista y NO es un detalle: el índice para agentes que emite
 * el preprocesador (`agente/md/*.md`, lo que sirve el MCP) lleva el markdown
 * con las rutas ORIGINALES, no las hasheadas que usa el HTML. Sin `.md` acá, la
 * poda se llevaría las imágenes de todo el contenido que un agente consume por
 * MCP y las dejaría rotas del lado del agente mientras el sitio se ve bien. Lo
 * encontró el test `la captura interna se poda`, que al principio esperaba que
 * la copia cruda de una imagen pública sobreviviera por su nombre: no
 * sobrevive, porque el HTML la nombra hasheada.
 */
const TEXTUALES = /\.(html|js|mjs|cjs|json|txt|xml|css|map|webmanifest|svg|md)$/i;

/**
 * Lo que se poda si nadie lo referencia.
 *
 * `svg` está acá Y en TEXTUALES a propósito: un SVG puede ser tanto una imagen
 * que se publica como un archivo con referencias adentro. Se resuelve por
 * ubicación — dentro de un subdir podable es candidato y no se escanea; fuera,
 * se escanea y no es candidato. Sin `svg` en esta lista, un diagrama interno en
 * SVG no era candidato y quedaba publicado para siempre: para docu técnica no
 * es un formato exótico.
 */
const PODABLES = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|mp4|webm|mov|m4v|pdf|zip)$/i;

/**
 * Extensiones podables, como alternancia — se usa para armar `TOKEN`.
 * Mantener en sincronía con `PODABLES`.
 */
const EXTS = 'png|jpe?g|gif|webp|avif|bmp|ico|svg|mp4|webm|mov|m4v|pdf|zip';

/** Separadores que nunca forman parte de una ruta dentro de un artefacto. */
const SEPARADORES = /[\s"'`()<>[\]{},;=|]+/;

/**
 * ¿Esta pieza de texto termina en una extensión podable?
 *
 * El texto se parte por separadores y cada pieza se prueba con esto, en vez de
 * barrer el archivo con una regex tipo `[^sep]{0,300}\.(ext)`. Esa forma tiene
 * backtracking cuadrático —cada posición reintenta cientos de caracteres— y
 * sobre un build real tardaba medio minuto en 15 MB de texto. Partir es lineal.
 * La versión original era peor todavía: usaba `\.[A-Za-z0-9]{2,5}` como
 * extensión, que en un bundle minificado matchea cada `obj.map` y `a.length`.
 */
const TERMINA_EN_PODABLE = new RegExp(`\\.(?:${EXTS})(?:[?#].*)?$`, 'i');

function recorrer(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, fn);
    else fn(p);
  }
}

/**
 * Decodifica percent-encoding de forma tolerante. El HTML emite
 * `captura%20de%20pantalla.png`; sin esto, un nombre con espacios o acentos
 * —normal en capturas subidas a mano en un repo en español— no matchea con su
 * archivo y la imagen se borra estando en uso.
 *
 * Se aplica al TOKEN, no al texto entero: decodificar cada artefacto completo
 * era un `replace` global sobre cada archivo del build para aprovechar unos
 * pocos caracteres.
 */
function decodificar(txt) {
  if (!txt.includes('%')) return txt;
  return txt.replace(/(?:%[0-9A-Fa-f]{2})+/g, (m) => {
    try { return decodeURIComponent(m); } catch { return m; }
  });
}

/** Normaliza un token de texto a algo comparable con una ruta del artefacto. */
function normalizarToken(t) {
  return t.replace(/\\/g, '/').split(/[?#]/)[0].replace(/^\.+/, '').replace(/^\/+/, '');
}

/**
 * Poda los archivos de `<salida>/<subdir>` que ningún artefacto referencia.
 *
 * @param {object} o
 * @param {string} o.salida     raíz del artefacto del sitio (ej. `site/build`)
 * @param {string[]} o.subdirs  subdirectorios a podar, relativos a `salida`
 * @param {string[]} [o.extra]  dirs FUERA de la salida que también referencian
 *                              (ej. `api/_generated`, el índice del MCP)
 * @param {boolean} [o.dryRun]  no borra, solo informa
 * @returns {{candidatos:number, referenciados:number, podados:string[], ambiguos:string[], bytes:number, error?:string}}
 */
export function podarStatic({ salida, subdirs, extra = [], dryRun = false }) {
  if (!fs.existsSync(salida)) {
    return { candidatos: 0, referenciados: 0, podados: [], ambiguos: [], bytes: 0, error: `no existe la salida ${salida}` };
  }

  // 1. Candidatos, indexados por RUTA relativa a la salida (no por nombre).
  const porRuta = new Map();   // 'img/a/b.png' -> ruta absoluta
  const porBase = new Map();   // 'b.png'       -> Set de rutas relativas
  const dirs = subdirs.map((s) => path.join(salida, s)).filter((d) => fs.existsSync(d));
  for (const d of dirs) {
    recorrer(d, (p) => {
      if (!PODABLES.test(p)) return;
      const rel = path.relative(salida, p).split(path.sep).join('/');
      porRuta.set(rel, p);
      const b = path.posix.basename(rel);
      if (!porBase.has(b)) porBase.set(b, new Set());
      porBase.get(b).add(rel);
    });
  }
  if (porRuta.size === 0) {
    return { candidatos: 0, referenciados: 0, podados: [], ambiguos: [], bytes: 0 };
  }

  // Nombres que solo puede tener un candidato: ahí una referencia sin
  // directorio es inequívoca.
  const baseUnico = new Map();
  for (const [b, rutas] of porBase) if (rutas.size === 1) baseUnico.set(b, [...rutas][0]);

  // Candidatos cuyo nombre la regex de tokens no captura entero (espacios y
  // demás): para esos se busca la ruta literal en el texto, que es más lento
  // pero son la excepción.
  const raros = [...porRuta.keys()]
    .filter((r) => /[\s"'`()<>[\]{},;=]/.test(r))
    .map((rel) => ({ rel, formas: [...new Set([rel, encodeURI(rel)])] }));

  // 2. Referencias. Se recorre cada artefacto textual UNA vez, se extraen sus
  //    tokens y se resuelven contra los índices: O(texto), no O(texto × candidatos).
  const referenciados = new Set();
  const ambiguos = new Set();
  const podablesAbs = dirs.map((d) => path.resolve(d));

  const escanear = (p) => {
    if (!TEXTUALES.test(p)) return;
    const abs = path.resolve(p);
    // Lo que vive dentro de un subdir podable no cuenta como referencia: si no,
    // un SVG suelto ahí adentro podría mantener viva a media carpeta.
    if (podablesAbs.some((d) => abs === d || abs.startsWith(d + path.sep))) return;
    let txt;
    try { txt = fs.readFileSync(p, 'utf8'); } catch { return; }

    for (const pieza of txt.split(SEPARADORES)) {
      if (pieza.length < 5 || !TERMINA_EN_PODABLE.test(pieza)) continue;
      const tok = normalizarToken(decodificar(pieza));
      if (!tok) continue;
      const b = path.posix.basename(tok);
      const conEseNombre = porBase.get(b);
      if (!conEseNombre) continue;
      // Coincidencia por RUTA: la referencia real casi siempre trae
      // directorios, y así dos archivos homónimos no se salvan juntos. Solo
      // cuenta si el token TERMINA en la ruta candidata (`/manual/img/a/b.png`
      // para `img/a/b.png`), nunca al revés: que la ruta del archivo termine
      // como el token es justamente el caso ambiguo —`img/a/captura.png` vs un
      // `captura.png` pelado— y ahí no se puede saber a cuál apuntaba.
      let porRutaOk = false;
      for (const rel of conEseNombre) {
        if (tok === rel || tok.endsWith('/' + rel)) { referenciados.add(rel); porRutaOk = true; }
      }
      if (porRutaOk) continue;
      // Una URL absoluta a OTRO host que casualmente termina con el mismo
      // nombre no dice nada de nuestro archivo: si no coincidió por ruta, no
      // cuenta. Sin esto, un `https://cdn.example/x/absoluta.png` mantenía viva
      // a `img/absoluta.png`, que no tiene nada que ver.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pieza) || pieza.startsWith('//')) continue;
      // Sin directorio que desambigüe: solo vale si el nombre es único.
      const unico = baseUnico.get(b);
      if (unico) { referenciados.add(unico); continue; }
      // Ambiguo de verdad: se conservan todos y se reporta, porque acá nadie
      // puede saber a cuál apuntaba la referencia.
      for (const rel of conEseNombre) { referenciados.add(rel); ambiguos.add(rel); }
    }

    // Los nombres que la regex de tokens no captura enteros (espacios y
    // demás) se buscan literales, en su forma cruda y en la encodeada, que es
    // como los emite el HTML.
    for (const { rel, formas } of raros) {
      if (referenciados.has(rel)) continue;
      if (formas.some((f) => txt.includes(f))) referenciados.add(rel);
    }
  };

  recorrer(salida, escanear);
  for (const d of extra) recorrer(d, escanear);

  // 3. Podar lo que quedó sin referencia.
  const podados = [];
  let bytes = 0;
  for (const [rel, abs] of porRuta) {
    if (referenciados.has(rel)) continue;
    try { bytes += fs.statSync(abs).size; } catch { /* ya no está */ }
    if (!dryRun) { try { fs.unlinkSync(abs); } catch { /* idem */ } }
    podados.push(rel);
  }

  return {
    candidatos: porRuta.size,
    referenciados: referenciados.size,
    podados,
    ambiguos: [...ambiguos],
    bytes,
  };
}
