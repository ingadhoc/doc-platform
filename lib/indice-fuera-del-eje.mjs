/**
 * El contenido fuera del eje entra al índice de búsqueda de TODOS los valores
 * del eje.
 *
 * ── QUÉ ARREGLA ───────────────────────────────────────────────────────────
 * El contrato de la plataforma define `secciones.fueraDelEje` como las
 * secciones cuyos "artículos aplican a TODOS los valores del eje: pasan
 * cualquier filtro y ganan cualquier desambiguación"
 * (`schema/docs.config.schema.json`). El MCP lo cumple: filtrar por
 * `version: 18` devuelve igual las páginas de `relacion`, porque su `version`
 * es `null`. El buscador del sitio NO lo cumplía, y no por su culpa:
 *
 * Docusaurus emite un índice por versión —la última en la raíz del sitio, las
 * demás en su subdirectorio— y asocia el contenido sin versionar a la versión
 * ÚLTIMA. La sección fuera del eje es un plugin de docs sin versionar, así que
 * sus páginas entran solo al índice de la raíz. Parado en la 19 (la última) el
 * lector las encuentra; parado en la 18 no existen. Medido en producción:
 * `/18/search-index.json` tenía 468 URLs de la 18 y CERO de `relacion`.
 *
 * Es el mismo bug con dos caras. La otra —`searchContextByPaths`, que partía
 * el índice de la raíz y dejaba `relacion` afuera incluso desde la 19— se
 * arregla en la config (ver `lib/busqueda.cjs`). Esta cara no se puede
 * arreglar con config: el plugin decide a qué índice va cada documento a
 * partir de a qué versión de Docusaurus pertenece, y el contenido fuera del
 * eje pertenece a una sola.
 *
 * ── POR QUÉ UN POST-PROCESO Y NO OTRA COSA ────────────────────────────────
 * - **Versionar la sección** (emitirla bajo `/18/relacion/…` y `/19/relacion/…`)
 *   duplica URLs de contenido que es uno solo, y contradice el contrato: está
 *   fuera del eje justamente porque no tiene valor de eje.
 * - **Indexarla como `page` en vez de `docs`** sí la mete en todas las
 *   versiones —el plugin indexa las páginas no-docs en todas—, pero
 *   `parsePage()` emite UNA sección con todo el `<main>` condensado: se pierden
 *   los resultados por heading (los anchors `#backups`, `#contrasenas`), se
 *   pierde el breadcrumb, y entra la navegación como contenido. Cambia un
 *   agujero por resultados peores.
 * - **Swizzlear el buscador** para que consulte dos índices toca SearchBar,
 *   SearchPage y el worker del plugin: tres componentes de un tema ajeno, en
 *   vez de un artefacto que ya está escrito en disco.
 * - **Un `postBuild` en el plugin de Docusaurus de la plataforma**, que ya
 *   existe, es lo primero que uno intenta — y no funciona: Docusaurus corre los
 *   `postBuild` de todos los plugins con `Promise.all`
 *   (`@docusaurus/core/lib/commands/build/buildLocale.js:106`), o sea
 *   concurrentes y sin orden garantizado. No hay forma de asegurar que el
 *   nuestro corra DESPUÉS de que el buscador escriba sus índices. Un bin del
 *   `buildCommand` sí tiene orden, y además se testea solo.
 *
 * ── LA SALIDA ─────────────────────────────────────────────────────────────
 * Esto vive acá porque el plugin no sabe hacerlo, no porque sea el lugar justo.
 * El arreglo de fondo es upstream y es chico: en `processDocInfos()`, los
 * `loadedVersions` de un plugin de docs SIN versionar podrían sumarse a todos
 * los `versionOutDir` en vez de solo al de la versión última. Si esa PR entra,
 * este módulo se borra entero.
 *
 * El post-proceso lee los documentos ya parseados del índice de la raíz y los
 * suma al índice de cada versión, reconstruyendo el índice lunr con las mismas
 * opciones que usó el build (`lib/busqueda.cjs`). No re-parsea HTML y no toca
 * el sitio. Antes de escribir nada verifica tres cosas: que reconstruir el
 * índice de la versión SIN fusionar reproduzca el archivo del build byte a byte
 * —el único control que detecta que las opciones del buscador divergieron—, que
 * los ids no colisionen, y que no se pierda ningún documento.
 *
 * ── DÓNDE CORRE ───────────────────────────────────────────────────────────
 * En el `buildCommand` del consumidor, DESPUÉS del build del sitio y ANTES del
 * guard de fuga —el guard tiene que ver el artefacto final, índices incluidos:
 *
 *   npm --prefix site run build && npx docs-indice-fuera-del-eje --salida=site/build && npx docs-guard-fuga --salida=site/build
 *
 * Es no-op sin ruido en los corpus que no tienen el problema: sin eje
 * `version`, con un solo valor de eje, o sin secciones fuera del eje. Por eso
 * puede entrar al `buildCommand` de los tres repos aunque hoy solo uno lo
 * necesite — el día que odumbo-docs prenda el eje, ya está.
 */

import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

import { cargarConfig } from './config.mjs';
import busqueda from './busqueda.cjs';

const { OPCIONES_DE_INDICE } = busqueda;

/** Los cinco cuerpos de documentos que emite el plugin, en orden. */
const CUERPOS = ['títulos', 'headings', 'descripciones', 'keywords', 'contenido'];

/**
 * `search-index.json` es el caso de los tres repos: con `hashed: true` el hash
 * viaja en el query string, no en el nombre. El sufijo del patrón cubre las dos
 * formas que SÍ cambian el archivo — `hashed: 'filename'` y los
 * `search-index-<contexto>.json` de `searchContextByPaths`, que este paso
 * detecta para gritar en vez de para usarlos.
 */
const ES_INDICE = /^search-index.*\.json$/;

function parsearArgv(argv) {
  const flags = {};
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (m) flags[m[1]] = m[2];
  }
  return flags;
}

/**
 * Los índices que hay en un directorio (sin recursión). Devuelve rutas
 * absolutas. Normalmente es uno solo.
 */
function indicesEn(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => ES_INDICE.test(n))
    .sort()
    .map((n) => join(dir, n));
}

/**
 * `buildIndex` sale del plugin que instaló el CONSUMIDOR, no de este paquete:
 * reconstruir con otra copia de lunr que la que armó el índice original es
 * exactamente el riesgo que este módulo existe para no correr. Es la misma
 * política que `mcp-handler` y `zod` (ver README, "Lo que el consumidor ya
 * tiene y este paquete no declara"): superficie mínima en el build de sitios
 * públicos.
 */
function cargarMotor(cwd, subdirDelSitio) {
  const anclas = [
    resolve(cwd, subdirDelSitio, 'package.json'),
    resolve(cwd, 'package.json'),
  ];
  const errores = [];
  for (const ancla of anclas) {
    try {
      const req = createRequire(ancla);
      const base = dirname(req.resolve('@easyops-cn/docusaurus-search-local/package.json'));
      const { buildIndex } = req(join(base, 'dist/server/server/utils/buildIndex.js'));
      if (typeof buildIndex !== 'function') throw new Error('buildIndex no es una función');
      return { buildIndex };
    } catch (error) {
      errores.push(`  · desde ${ancla}: ${error.message}`);
    }
  }
  throw new Error(
    'no encontré `@easyops-cn/docusaurus-search-local` (el plugin que arma el índice).\n' +
      'Este paquete no lo declara como dependencia a propósito: lo instala el repo de ' +
      'contenido, que es el que decide con qué versión del buscador se deploya.\n' +
      errores.join('\n'),
  );
}

/**
 * Los documentos de un cuerpo cuya URL cae bajo un prefijo de sección.
 *
 * El prefijo se arma como `/<seccion>`, o sea que asume `baseUrl === '/'` — es
 * el caso de los tres repos. Con un `baseUrl` distinto no habría falsos
 * positivos silenciosos: no matchearía ninguno y el chequeo por sección de más
 * abajo aborta el build nombrando la sección.
 */
function documentosDe(cuerpo, prefijo) {
  return (cuerpo || []).filter((doc) => doc.u === prefijo || doc.u.startsWith(`${prefijo}/`));
}

/** Lee y parsea un índice, con el nombre del archivo en el error. */
function leerIndice(ruta, dirSalida) {
  const nombre = ruta.slice(dirSalida.length + 1);
  let crudo;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch (error) {
    throw new Error(`no se pudo leer ${nombre}: ${error.code || error.message}`);
  }
  let json;
  try {
    json = JSON.parse(crudo);
  } catch (error) {
    throw new Error(`${nombre} no es JSON válido: ${error.message}`);
  }
  if (!Array.isArray(json) || json.length !== CUERPOS.length) {
    throw new Error(
      `${nombre} no tiene la forma de un índice del plugin: esperaba un array de ` +
        `${CUERPOS.length} cuerpos (${CUERPOS.join(', ')}) y encontré ` +
        `${Array.isArray(json) ? `${json.length}` : typeof json}.`,
    );
  }
  return { crudo, json };
}

/**
 * Escritura atómica: un `ENOSPC` a mitad de un índice de 10 MB dejaría un JSON
 * truncado en el árbol del build. El `&&` del buildCommand aborta el deploy
 * igual, pero el artefacto local queda roto y el diagnóstico apunta al lugar
 * equivocado.
 */
function escribirIndice(ruta, contenido) {
  const temporal = `${ruta}.tmp`;
  writeFileSync(temporal, contenido, 'utf8');
  renameSync(temporal, ruta);
}

/**
 * @returns {{ code: 0|1, lineas: string[] }}
 */
export function correrIndiceFueraDelEje({ argv = [], cwd = process.cwd() } = {}) {
  const lineas = [];
  try {
    return { code: fusionar({ argv, cwd, lineas }), lineas };
  } catch (error) {
    // Red de seguridad: cualquier cosa que no esté prevista sale como mensaje y
    // exit 1, nunca como un stack de Node en medio del log del build.
    lineas.push(`✗ ${error.message}`);
    return { code: 1, lineas };
  }
}

function fusionar({ argv, cwd, lineas }) {
  const flags = parsearArgv(argv);
  const salida = flags.salida || 'site/build';
  const rutaConfig = flags.config || 'docs.config.json';
  const subdirDelSitio = flags.site || 'site';
  const dirSalida = resolve(cwd, salida);

  let config;
  try {
    config = cargarConfig({ ruta: rutaConfig, cwd });
  } catch (error) {
    lineas.push(`✗ ${error.message}`);
    return 1;
  }

  const secciones = config.secciones?.fueraDelEje ?? [];
  const eje = config.eje ?? {};
  const valores = (eje.valores ?? []).map((v) => v.id);
  const ultima = eje.default;

  // Los tres no-op. Ninguno es un error: son corpus a los que este paso no les
  // toca hacer nada, y el bin va igual en su buildCommand.
  if (eje.tipo !== 'version') {
    lineas.push(`· eje \`${eje.tipo}\`: nada que hacer (el problema es del versionado de Docusaurus)`);
    return 0;
  }
  if (secciones.length === 0) {
    lineas.push('· sin `secciones.fueraDelEje` en el contrato: nada que hacer');
    return 0;
  }
  const otras = valores.filter((v) => v !== ultima);
  if (otras.length === 0) {
    lineas.push(`· un solo valor de eje (\`${ultima}\`): su índice es el de la raíz y ya tiene todo`);
    return 0;
  }

  // El índice de la raíz: el de la versión última, y el único que hoy tiene el
  // contenido fuera del eje.
  const raiz = indicesEn(dirSalida);
  if (raiz.length !== 1) {
    lineas.push(
      `✗ esperaba UN índice en ${salida}/ y encontré ${raiz.length}` +
        (raiz.length ? `: ${raiz.map((r) => r.slice(dirSalida.length + 1)).join(', ')}` : '') +
        '.\n  Si son varios, el sitio todavía declara `searchContextByPaths` y el índice está ' +
        'partido por contexto: sacalo (ver lib/busqueda.cjs). Si no hay ninguno, el build ' +
        'corrió con DOCS_SEARCH=0 o el buscador no está instalado.',
    );
    return 1;
  }

  let buildIndex;
  try {
    ({ buildIndex } = cargarMotor(cwd, subdirDelSitio));
  } catch (error) {
    lineas.push(`✗ ${error.message}`);
    return 1;
  }

  const { json: indiceRaiz } = leerIndice(raiz[0], dirSalida);

  // Por sección, no por la suma: con dos secciones declaradas y una sola
  // emitida, un chequeo sobre el total pasa en verde y la segunda queda
  // invisible en todas las versiones sin que nadie se entere.
  const compartidos = CUERPOS.map(() => []);
  for (const seccion of secciones) {
    const prefijo = `/${seccion}`;
    const porCuerpo = indiceRaiz.map((entrada) => documentosDe(entrada.documents, prefijo));
    const total = porCuerpo.reduce((n, c) => n + c.length, 0);
    if (total === 0) {
      lineas.push(
        `✗ el índice de la raíz no tiene NINGÚN documento de \`${prefijo}\`.\n` +
          '  El contrato la declara fuera del eje, así que o el build dejó de emitirla, o ' +
          'no está en el `docsRouteBasePath` del sitio, o su URL cambió de forma. No escribo ' +
          'nada: sumar cero documentos en silencio es el bug que este paso previene.',
      );
      return 1;
    }
    porCuerpo.forEach((docs, i) => compartidos[i].push(...docs));
    lineas.push(`fuera del eje: ${porCuerpo[0].length} página(s) en \`${prefijo}\` (${total} entradas)`);
  }

  let tocados = 0;
  for (const valor of otras) {
    const dir = join(dirSalida, valor);
    const indices = indicesEn(dir);
    if (indices.length === 0) {
      // Un valor declarado sin contenido publicado todavía. No es un error: el
      // eje se declara antes de que la versión tenga artículos.
      lineas.push(`· ${valor}: sin índice en ${salida}/${valor}/ — salteado`);
      continue;
    }
    // El mismo guard que en la raíz: varios índices en el directorio de una
    // versión son restos de un build con contextos, y fusionar en un archivo que
    // el cliente ya no pide es trabajo que nadie va a ver.
    if (indices.length !== 1) {
      lineas.push(
        `✗ ${valor}: esperaba UN índice en ${salida}/${valor}/ y encontré ${indices.length}: ` +
          `${indices.map((r) => r.slice(dir.length + 1)).join(', ')}. Sobra un artefacto de un ` +
          'build con `searchContextByPaths`, o el directorio no se limpió.',
      );
      return 1;
    }

    const ruta = indices[0];
    const { crudo, json: original } = leerIndice(ruta, dirSalida);

    const yaEstaban = new Set((original[0].documents || []).map((d) => d.u));
    const faltantes = compartidos.map((docs) => docs.filter((d) => !yaEstaban.has(d.u)));
    const aSumar = faltantes.reduce((n, c) => n + c.length, 0);
    if (aSumar === 0) {
      lineas.push(`· ${valor}: ya tenía las páginas fuera del eje — sin cambios`);
      continue;
    }

    // Control 1 — el pipeline del post-proceso es el mismo que el del build.
    //
    // Reconstruye los documentos que la versión YA tenía y compara contra el
    // archivo tal cual lo dejó el plugin: si coincide byte a byte, este proceso
    // arma índices idénticos a los del build y lo fusionado va a buscarse igual
    // que el resto. Si no, `OPCIONES_DE_INDICE` divergió de las opciones del
    // tema del sitio — otro idioma, otro stemmer, otras stop-words— y el
    // resultado sería un índice que busca distinto según la versión.
    //
    // Cuesta un `buildIndex` extra (~1 s en el corpus real) y es el único
    // control que detecta esa divergencia: verificar que "algún término se
    // encuentra" no la detecta, porque un término exacto se encuentra con
    // cualquier stemmer.
    const testigo = JSON.stringify(buildIndex(original.map((e) => e.documents || []), OPCIONES_DE_INDICE));
    if (testigo !== crudo) {
      lineas.push(
        `✗ ${valor}: reconstruir su índice sin tocarlo NO reproduce el archivo del build.\n` +
          '  Las opciones del buscador del sitio y las de la plataforma divergieron: el índice ' +
          'fusionado buscaría distinto que el original. El sitio tiene que declarar su tema con ' +
          '`opcionesDelTema()` de @ingadhoc/docs-platform/busqueda, que comparte fuente con ' +
          '`OPCIONES_DE_INDICE`.',
      );
      return 1;
    }

    // Control 2 — los ids no colisionan.
    //
    // lunr usa `i` como ref, y el worker resuelve con `documents.find(...)`: dos
    // documentos con el mismo `i` hacen que el buscador muestre la página
    // equivocada, sin ningún error. Hoy no colisionan porque el contador del
    // plugin es global al build y no se resetea entre versiones — una invariante
    // no documentada de una dependencia externa, que es justo lo que este módulo
    // no da por sentado.
    for (let i = 0; i < original.length; i++) {
      const ids = new Set((original[i].documents || []).map((d) => d.i));
      const chocados = faltantes[i].filter((d) => ids.has(d.i)).map((d) => d.i);
      if (chocados.length) {
        lineas.push(
          `✗ ${valor}: ${chocados.length} id(s) del índice de la raíz chocan con los de esta ` +
            `versión en ${CUERPOS[i]} (p. ej. ${chocados[0]}). El plugin dejó de numerar los ` +
            'documentos de corrido entre versiones; fusionar así haría que el buscador muestre ' +
            'la página equivocada.',
        );
        return 1;
      }
    }

    const fusionado = original.map((entrada, i) => [...(entrada.documents || []), ...faltantes[i]]);
    const nuevo = buildIndex(fusionado, OPCIONES_DE_INDICE);

    // Control 3 — no se perdió nada de lo que la versión ya tenía.
    const antes = original.reduce((n, e) => n + (e.documents || []).length, 0);
    const despues = nuevo.reduce((n, e) => n + e.documents.length, 0);
    if (despues !== antes + aSumar) {
      lineas.push(`✗ ${valor}: quedaron ${despues} documentos y esperaba ${antes + aSumar}`);
      return 1;
    }

    escribirIndice(ruta, JSON.stringify(nuevo));
    tocados++;
    const detalle = faltantes
      .map((c, i) => (c.length ? `${CUERPOS[i]} +${c.length}` : null))
      .filter(Boolean)
      .join(', ');
    lineas.push(`✓ ${valor}: ${detalle}`);
  }

  lineas.push(
    tocados === 0
      ? '· ningún índice necesitaba cambios'
      : `✓ ${tocados} índice(s) actualizado(s): el contenido fuera del eje se busca desde toda versión`,
  );
  return 0;
}
