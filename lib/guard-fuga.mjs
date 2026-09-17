/**
 * Guard de fuga interno → público. Corre DENTRO del buildCommand, después del
 * build, y falla el deploy si el artefacto público contiene contenido interno.
 * El CLI es `bin/guard-fuga.mjs` (`docs-guard-fuga`); acá está la lógica, sin
 * `process.exit` ni globals, para poder testearla y para que el bin sea el
 * único que decide el exit code.
 *
 * UNIFICADO (etapa A). En oba-docs y odumbo-docs este archivo era
 * BYTE-IDÉNTICO (md5 c67514de…): no hubo que laudar ninguna diferencia de
 * comportamiento. adhoc-docs NO lo tenía —fue una omisión deliberada, "el día
 * que haga falta nadie se va a acordar"— y lo suma por el paquete (ADR 0007 y
 * Fase 0 de la spec de arquitectura). Lo que cambió respecto del original:
 *
 *   a) los paths salen de argumentos (con los defaults de hoy), para que el
 *      mismo archivo sirva a los tres repos;
 *   b) cuatro refuerzos de estrictez, marcados con `ESTRICTEZ+` abajo;
 *   c) el contrato se lee VALIDADO (`lib/config.mjs`): el guard es el primer
 *      consumidor que hace cumplir el schema en el build.
 *
 * POR QUÉ NO ALCANZA EL CI: los checks de GitHub Actions no corren en el build
 * de Vercel. Protegen el merge; no protegen el deploy.
 *
 * TRES DECISIONES DE DISEÑO, cada una por un agujero concreto que tuvo la
 * primera versión de este archivo:
 *
 * 1. La audiencia esperada se resuelve por `VERCEL_PROJECT_ID` contra el mapa
 *    `deploy.proyectos` de docs.config.json — NO por `DOCS_AUDIENCE`. La
 *    versión anterior comparaba `$DOCS_AUDIENCE` contra
 *    `generated.json.audiencia`, que el preprocesador escribe DESDE
 *    `$DOCS_AUDIENCE`: era una tautología que aprobaba exactamente el modo de
 *    falla que decía atacar. Con la env var mal seteada en el proyecto
 *    público, el guard decía "coherente", salteaba las sondas y publicaba el
 *    sitio interno completo.
 *
 * 2. Las sondas las calcula el PREPROCESADOR y viajan en `.guard/removido.json`.
 *    La versión anterior volvía a parsear el árbol fuente por su cuenta: dos
 *    parsers del mismo formato divergen, y cuando divergen el guard aprueba
 *    justo la fuga que el preprocesador dejó pasar. Además, un bloque que el
 *    guard no reconocía envenenaba el set entero (sus palabras contaban como
 *    públicas y borraban sondas de otros bloques).
 *
 * 3. "No pude verificar" es FALLA, no aviso. Un ⚠ en logs de build que nadie
 *    lee, seguido de deploy publicado, es operativamente idéntico a "todo bien".
 *
 * LO QUE ESTE GUARD NO CUBRE, y hay que saberlo:
 *   - Números y strings de menos de 5 caracteres no son sondas: una clave como
 *     `4821` o una sigla nunca va a tener una. Lo más caro de fugar es
 *     justamente lo que el enfoque léxico no ve.
 *   - Imágenes y adjuntos: si una captura tiene información interna, no hay
 *     sonda ni escaneo posible acá.
 *   - Una fuga DENTRO de applyBlocks (si dejara pasar una línea interna al
 *     output) no genera sonda. Para eso está el fail-closed del preprocesador,
 *     que falla ante cualquier directiva `:::interno` que no reconozca.
 *
 * Uso (ver `bin/guard-fuga.mjs`):
 *   npx docs-guard-fuga --salida=site/build
 *   npx docs-guard-fuga --salida=dist/publico --esperada=publico   # local
 *
 * Opciones (todas con default):
 *   --salida      artefacto del sitio a escanear      (site/build)
 *   --generated   declaración de audiencia del build  (site/generated.json)
 *   --manifiesto  manifiesto de sondas                (.guard/removido.json)
 *   --extra       dirs extra a escanear, coma          (api/_generated)
 *   --indice      índice del MCP, exigido si target=docusaurus
 *                                                     (api/_generated/index.json)
 *   --config      contrato de la plataforma            (docs.config.json)
 *   --contenido   nombre del árbol fuente que el manifiesto tiene que declarar
 *                                                     (content)
 *
 * Los paths NO se pueden fijar en `docs.config.json`: el contrato tiene
 * `additionalProperties: false` y un bloque de paths de una herramienta no es
 * parte del contrato config ↔ plataforma. Van en el buildCommand, que es donde
 * se ve qué se está escaneando.
 */

import fs from 'node:fs';

// La MISMA normalización con la que se construyó el índice. No una copia: si el
// chequeo tokenizara distinto que el motor, compararía dos vocabularios que no
// son el mismo y aprobaría justo la fuga que viene a buscar.
import MiniSearch from 'minisearch';

import { procesarTermino } from './mcp/indice.mjs';
import path from 'node:path';

import { cargarConfig } from './config.mjs';

/**
 * Corre el guard.
 *
 * @param {object} opciones
 * @param {string[]} opciones.argv     argumentos `--clave=valor`.
 * @param {string}   opciones.cwd      raíz del repo consumidor.
 * @param {object}   opciones.env      entorno (VERCEL, VERCEL_PROJECT_ID).
 * @param {Function} opciones.log      salida informativa.
 * @param {Function} opciones.error    salida de errores.
 * @returns {number} 0 = se publica; 1 = el deploy se bloquea.
 */
export function correrGuard({
  argv = [],
  cwd = process.cwd(),
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  const ROOT = cwd;
  const arg = (n, d) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.split('=').slice(1).join('=') : d;
  };
  const dado = (n) => argv.some((a) => a.startsWith(`--${n}=`));
  const rel = (p) => path.relative(ROOT, p);

  const EN_VERCEL = env.VERCEL === '1';
  const fallas = [];

  const terminar = () => {
    if (fallas.length) {
      error('\n✗ Guard de fuga: el build público NO se publica\n');
      for (const f of fallas) error(`  ${f}`);
      error('');
      return 1;
    }
    log('  ✓ guard de fuga OK');
    return 0;
  };

  // ── 0. Contrato de la plataforma ─────────────────────────────────────────
  const CFG_RUTA = arg('config', 'docs.config.json');
  let CFG = null;
  try {
    // ESTRICTEZ+ (a): antes esto era una excepción sin manejar. Reventar también
    // falla el build, pero sin decir qué pasó; y peor: cualquier refactor que
    // envolviera la lectura en un try silencioso dejaba el guard sin contrato.
    // ESTRICTEZ+ (b): el config entra VALIDADO contra el schema. Antes,
    // `CFG.audiences.includes(...)` tiraba TypeError si la clave faltaba;
    // ahora cada campo ausente o mal formado es una falla con nombre.
    CFG = cargarConfig({ ruta: CFG_RUTA, cwd: ROOT });
  } catch (e) {
    fallas.push(e.message);
  }

  const SALIDA = path.resolve(ROOT, arg('salida', 'site/build'));
  const GENERATED = path.resolve(ROOT, arg('generated', 'site/generated.json'));
  const MANIFIESTO = path.resolve(ROOT, arg('manifiesto', '.guard/removido.json'));
  const INDICE_AGENTE = path.resolve(ROOT, arg('indice', 'api/_generated/index.json'));
  const EXTRA = String(arg('extra', 'api/_generated'))
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((p) => path.resolve(ROOT, p));
  // NO se resuelve contra ROOT: es el NOMBRE del árbol fuente tal como lo
  // declara el manifiesto, para compararlo literal. Ver el chequeo del paso 3.
  const CONTENIDO_ESPERADO = arg('contenido', 'content');

  if (!CFG) return terminar();

  // El opt-out declarado (spec, Fase 0 punto 4): o el guard está activo, o su
  // ausencia está escrita con motivo en el contrato. Lo que ya no puede ser es
  // silenciosa — y el `motivo` queda en los logs del build, no en un olvido.
  if (CFG.deploy.guardDeFuga.activo === false) {
    log(`  · guard de fuga DECLARADO INACTIVO en ${CFG_RUTA}: ${CFG.deploy.guardDeFuga.motivo}`);
    return terminar();
  }

  // ── 1. Qué audiencia debería tener este build ────────────────────────────
  // Fuente independiente de DOCS_AUDIENCE: hace falta equivocarse en dos
  // lugares distintos (la env var del proyecto y el mapa versionado) para que
  // pase.
  let esperada = null;
  const proyecto = env.VERCEL_PROJECT_ID;

  if (EN_VERCEL) {
    const mapa = CFG.deploy.proyectos || {};
    esperada = mapa[proyecto] || null;
    if (!esperada) {
      fallas.push(
        `proyecto de Vercel no mapeado: VERCEL_PROJECT_ID="${proyecto || '(vacío)'}" no está en ${CFG_RUTA} → deploy.proyectos. ` +
        'Agregalo — sin eso el guard no sabe qué audiencia esperar y no puede proteger nada.',
      );
    }
    // ESTRICTEZ+ (c): en Vercel, `--esperada` se IGNORABA en silencio. Ahora es
    // falla: el buildCommand vive en las settings del proyecto, y si pasarlo
    // funcionara —o pareciera funcionar— sería el camino corto para neutralizar
    // la fuente independiente sin tocar el repo.
    if (dado('esperada')) {
      fallas.push('--esperada no se acepta corriendo en Vercel: la audiencia sale del mapa `deploy.proyectos`, no de un argumento del buildCommand');
    }
  } else {
    esperada = arg('esperada', null);
    if (!esperada) fallas.push('fuera de Vercel hay que pasar --esperada=publico|interno');
  }

  if (esperada && !CFG.audiences.includes(esperada)) {
    fallas.push(`audiencia esperada inválida: "${esperada}"`);
  }

  // ── 2. ¿El build es de esa audiencia? ────────────────────────────────────
  // `audiencia` es la clave del contrato unificado; `audience` se sigue
  // aceptando SÓLO acá porque `site/generated.json` y `.guard/removido.json`
  // son un tercer contrato que todavía emite cada repo, y el paso 1 de la
  // migración es emitir las dos (contrato-indice.md §5).
  const audienciaDe = (o) => o?.audiencia ?? o?.audience;

  if (!fs.existsSync(GENERATED)) {
    fallas.push(`no existe ${rel(GENERATED)}: el preprocesador no corrió`);
  } else if (esperada) {
    const real = audienciaDe(JSON.parse(fs.readFileSync(GENERATED, 'utf8')));
    if (real !== esperada) {
      fallas.push(`AUDIENCIA CRUZADA: el proyecto "${proyecto || 'local'}" espera "${esperada}" y el build es "${real}"`);
    } else {
      log(`  ✓ audiencia coherente: "${real}" (esperada por identidad de proyecto, no por DOCS_AUDIENCE)`);
    }
  }

  // Solo el build público se escanea: es el único sin barrera de acceso.
  if (esperada !== 'publico') {
    if (esperada) log(`  · build "${esperada}": no se escanea (este artefacto sí debe contener lo interno)`);
    return terminar();
  }

  // ── 3. Sondas del manifiesto que emitió el preprocesador ─────────────────
  let sondas = [];
  let manifiesto = null;
  if (!fs.existsSync(MANIFIESTO)) {
    fallas.push(`falta ${rel(MANIFIESTO)}: el preprocesador no emitió el manifiesto, así que no hay con qué verificar`);
  } else {
    const m = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
    manifiesto = m;
    if (audienciaDe(m) !== 'publico') {
      fallas.push(`el manifiesto es del build "${audienciaDe(m)}", no del público`);
    }
    // EL MANIFIESTO TIENE QUE SER DEL CONTENIDO QUE SE PUBLICA. La suite de
    // bloques de cada repo corre el preprocesador contra un fixture y deja SU
    // manifiesto acá: 20 sondas en vez de 853. Un guard corrido después del test
    // mide el sitio real contra las sondas de un fixture y sale en verde POR
    // VACÍO — no porque no haya fuga, sino porque no hay con qué buscarla.
    //
    // Pasó de verdad (oba-docs, commit 37269f7): la verificación local del
    // deploy de Finanzas corrió después de los tests y dio 0 hits, mientras
    // Vercel —que corre preprocesador, build y guard en un solo comando—
    // encontraba 5 hits. El manifiesto declara de qué árbol salió: hay que
    // mirarlo. Un manifiesto que no lo declara (el emisor viejo) no se rechaza:
    // el chequeo entra a medida que los repos empiezan a emitir el campo.
    const arbolDe = (o) => o?.contenido ?? o?.content;
    if (arbolDe(m) && arbolDe(m) !== CONTENIDO_ESPERADO) {
      fallas.push(
        `el manifiesto es del árbol "${arbolDe(m)}" y se está escaneando un build de ` +
        `"${CONTENIDO_ESPERADO}": las sondas no corresponden. Volvé a correr el ` +
        'preprocesador antes del guard (o pasá --contenido= si el árbol fuente no es `content`).',
      );
    }
    sondas = m.sondas || [];
    if (m.bloques === 0) {
      log('  · el árbol fuente no tiene contenido interno: nada que verificar');
    } else if (sondas.length === 0) {
      // FALLA, no aviso: hay contenido interno y ninguna palabra que lo distinga.
      fallas.push(
        `hay ${m.bloques} línea(s) de contenido interno pero NINGUNA sonda discriminante: ` +
        'el guard no puede verificar la fuga. Revisá el contenido interno o el cálculo de sondas.',
      );
    }
  }

  // ── 3 bis. El índice para agentes también es output público ──────────────
  // `site/static/agente/**` viaja al sitio porque Docusaurus copia `static/` a
  // la salida, así que el recorrido de SALIDA ya lo ve.
  // `api/_generated/index.json` NO: lo sirve la función MCP, vive fuera de la
  // salida del sitio y hay que sumarlo al escaneo a mano. Es el artefacto con
  // el cuerpo entero de cada artículo — el más caro de fugar de todos.
  //
  // Fail-closed: el emisor `agente` corre siempre en el target docusaurus. Si
  // el índice no está, no es "no había nada que escanear": es que algo no
  // corrió, y no poder verificar es falla.
  if (manifiesto && manifiesto.target === 'docusaurus' && !fs.existsSync(INDICE_AGENTE)) {
    fallas.push(
      `falta ${rel(INDICE_AGENTE)}: el emisor \`agente\` no corrió, ` +
      'así que el guard no puede verificar el índice que consume el MCP.',
    );
  }

  // El manifiesto tiene el contenido interno en texto plano: nunca en el output.
  // ESTRICTEZ+ (d): este chequeo estaba DENTRO del `if (sondas.length)`. Un build
  // sin sondas (o con el manifiesto ausente, que ya es falla) podía llevarse el
  // `.guard/` entero adentro de la salida sin que nadie lo mirara.
  if (fs.existsSync(path.join(SALIDA, '.guard'))) {
    fallas.push('el directorio .guard quedó dentro de la salida: contiene el contenido interno en texto plano');
  }

  // ── 4. Escanear el output ────────────────────────────────────────────────
  if (sondas.length) {
    // Las sondas son TRIGRAMAS de palabras contiguas. Con palabras sueltas este
    // guard bloqueó un deploy real por `database`, `responder` y `timeout`
    // encontradas en el bundle de React — y el JS no se puede excluir del
    // escaneo, porque Docusaurus mete el contenido de las páginas en sus chunks.
    //
    // Los tags HTML se quitan ANTES de normalizar: `<strong>timeout</strong> del
    // webservice` con los tags adentro no matchearía la frase.
    //
    // Los archivos JSON llevan el contenido ESCAPADO (`\n` literal por salto de
    // línea): sin decodificar, una sonda que arranca al principio de una línea
    // era invisible (`\nel límite real` → `nel límite real`). La decodificación
    // se hace con JSON.parse — escanear las strings decodificadas deja el texto
    // en el mismo dominio que las sondas, que salen del fuente sin escapes.
    // NO intentes reemplazar escapes con regex sobre el texto crudo: borra la
    // letra siguiente a un backslash LITERAL (`C:\temp` → `c emp`) y ciega al
    // guard justo en el tipo de archivo nuevo que vino a cubrir.
    //
    // LOS LÍMITES DE BLOQUE CORTAN, LOS INLINE NO. La versión anterior reemplazaba
    // TODO tag por un espacio, y con eso el final de un bloque quedaba pegado al
    // principio del siguiente: un trigrama que nadie escribió. Medido en el deploy
    // público de Finanzas (oba-docs, commit 37269f7) — 4 de las 5 "fugas" que
    // frenaron el build público eran cruces, no fugas:
    //
    //   `<h2>Qué agrega el módulo</h2><p>En la sección…`  → "el módulo en"
    //   dos entradas del search-index, `…tarjetas a cobrar` + `pago del servicio`
    //                                                     → "a cobrar pago"
    //
    // Ninguna es una frase: son artefactos de la normalización, y el guard no
    // puede descartarlas por su cuenta porque el `publicado` que las filtraría lo
    // calcula el preprocesador sobre el FUENTE, donde esos n-gramas no existen.
    //
    // El corte NO puede ser en todo tag: `<strong>timeout</strong> del webservice`
    // tiene que seguir matcheando, o el guard queda ciego justo donde una frase
    // interna lleva una negrita o un link adentro. Así que los tags de BLOQUE
    // pasan a `\n` —que corta el n-grama— y los INLINE siguen siendo un espacio.
    const BLOQUE = /<\/?(?:p|div|h[1-6]|li|ul|ol|dl|dt|dd|tr|td|th|table|thead|tbody|section|article|header|footer|nav|aside|main|figure|figcaption|details|summary|pre|blockquote|br|hr|form|label|option|script|style|title|button)\b[^>]*>/gi;
    const normalizar = (txt) => txt
      .replace(BLOQUE, '\n')
      .replace(/<[^>]*>/g, ' ')
      .toLowerCase()
      .replace(/[`*_~#>\[\]()|{}"'\\]/g, ' ')
      .replace(/[^a-záéíóúñü0-9\n]+/gi, ' ')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');

    // Una sola pasada por archivo con las sondas en lotes: 3400 artefactos × N
    // sondas con includes() sería medir el output N veces.
    // Límites de palabra con lookaround sobre espacios, no \b: \b es ASCII y se
    // rompe con los acentos. Y sin límites, `días corridos si` (interno) matchea
    // dentro de `días corridos sin rechazo` (público) y bloquea el deploy por un
    // trigrama que no es el mismo.
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lotes = [];
    for (let i = 0; i < sondas.length; i += 150) {
      const trozo = sondas.slice(i, i + 150);
      lotes.push({ re: new RegExp(`(?<= )(?:${trozo.map(escape).join('|')})(?= )`, 'g'), trozo });
    }

    // JSON (y sourcemaps): parsear y quedarse con todas las strings decodificadas.
    // Si el parse falla (JSON roto), fallback al texto crudo con los escapes
    // pasados a separador — sobre-matchea, que es la dirección segura.
    // Devuelve el texto decodificado Y el objeto parseado: el objeto lo necesita
    // el chequeo de vocabulario de abajo, y parsear dos veces un índice de 12 MB
    // es medir el output dos veces.
    const decodificarJson = (txt) => {
      try {
        const partes = [];
        const juntar = (v) => {
          if (typeof v === 'string') partes.push(v);
          else if (Array.isArray(v)) v.forEach(juntar);
          else if (v && typeof v === 'object') Object.values(v).forEach(juntar);
        };
        const objeto = JSON.parse(txt);
        juntar(objeto);
        return { texto: partes.join('\n'), objeto };
      } catch {
        // El escape decodificado corta el n-grama, igual que un límite de bloque:
        // `\n` era un salto de línea en el fuente, y las palabras de un lado y
        // del otro nunca fueron contiguas. Con un espacio acá nacían los mismos
        // trigramas de cruce que el fix de bloques vino a matar, pero en JSON.
        return { texto: txt.replace(/\\[nrtbfuxv]/g, '\n'), objeto: null };
      }
    };

    // ══ El chequeo de vocabulario, para los índices serializados ═════════════
    //
    // POR QUÉ HACE FALTA OTRO CHEQUEO, y qué cubre cada uno. Las sondas son
    // trigramas de palabras contiguas. En un índice serializado de MiniSearch
    // hay dos zonas bien distintas:
    //
    //   - los `storeFields` (title, description, headings, slug, url) viajan
    //     como strings CONTIGUAS, así que el escaneo de trigramas de arriba YA
    //     los cubre. Medido sobre el artefacto real: un índice construido desde
    //     el corpus interno le dispara 3 frases al escaneo de trigramas.
    //   - el CUERPO no. Va al `index`, que es un array de pares
    //     [término, datos]: palabras sueltas, sin orden. Ninguna sonda de tres
    //     palabras puede matchear ahí, y el cuerpo es el grueso del contenido.
    //
    // Los dos chequeos son COMPLEMENTARIOS. Este cubre la zona que el otro no
    // puede por construcción, no lo reemplaza.
    //
    // EL ASERTO ES DE SUBCONJUNTO, y no "que no aparezca ningún término
    // interno". La primera versión de este chequeo restaba el vocabulario
    // público de las sondas y buscaba los términos que quedaban. Andaba, pero
    // tenía dos agujeros que la revisión encontró y que este aserto cierra de
    // raíz:
    //
    //   a) aprobaba en SILENCIO un artefacto emitido con otro `processTerm`.
    //      Si el emisor tokeniza distinto que este motor, sus términos no son
    //      los mismos y ninguna comparación de igualdad podía matchear: el
    //      guard decía "limpio" sin haber verificado nada. Es la dirección de
    //      falla que la decisión 3 de arriba prohíbe.
    //   b) dependía de que el vocabulario removido y el del índice se
    //      tokenizaran igual, y NO lo hacían: partir por `[^\p{L}\p{N}]`
    //      rompe `n°30712345678` en dos, y MiniSearch lo deja entero. Medido:
    //      `cuit n°30712345678 interno` pasaba, el número suelto bloqueaba.
    //      Justo la clase —números, CUITs, IDs— que este chequeo viene a cubrir.
    //
    // El aserto correcto es: **todo término del índice tiene que existir en el
    // vocabulario del corpus PÚBLICO**. Un término de más es contenido que no
    // se publica, o un emisor que no es este motor. Las dos cosas cortan.
    // Medido sobre el artefacto real: 0 términos de más en el correcto, 148 en
    // uno construido desde el corpus interno.
    //
    // Y EL TOKENIZADOR SALE DE MINISEARCH, no de una regex nuestra: es el mismo
    // que usó el índice. Una copia acá es la divergencia del punto (b) otra vez.
    const tokenizar = MiniSearch.getDefault('tokenize');
    const termino = (txt) => tokenizar(txt || '').map(procesarTermino).filter(Boolean);

    // Se calcula UNA vez y sólo si aparece un índice serializado: tokenizar el
    // corpus público entero cuesta ~1 s y no hay por qué pagarlo en un build
    // que no emite ninguno.
    let vocabulario;
    const vocabularioPublico = () => {
      if (vocabulario) return vocabulario;
      let crudo;
      try {
        crudo = JSON.parse(fs.readFileSync(INDICE_AGENTE, 'utf8'));
      } catch (error) {
        // Sin el corpus no se puede verificar, y "no pude verificar es FALLA".
        // Con un mensaje, no con un stack trace: ESTRICTEZ+ (a).
        vocabulario = null;
        fallas.push(`no pude leer ${rel(INDICE_AGENTE)} para verificar los índices serializados: ${error.message}`);
        return null;
      }
      vocabulario = new Set();
      for (const a of crudo.articulos || []) {
        for (const t of [
          ...termino(a.title), ...termino(a.description), ...termino(a.body),
          ...termino((a.keywords || []).join(' ')),
          ...termino((a.headings || []).map((h) => h.text || h).join(' ')),
        ]) vocabulario.add(t);
      }
      return vocabulario;
    };

    // El vocabulario de lo que el preprocesador borró. No es el aserto —el
    // aserto es el subconjunto— pero separa un término que SABEMOS interno de
    // uno que simplemente no reconocemos, y eso cambia el mensaje y lo que hay
    // que ir a mirar.
    let removido;
    const vocabularioRemovido = () => (removido ??= new Set(sondas.flatMap(termino)));

    const hitsVocabulario = new Map();

    /** ¿Este JSON es un índice serializado de MiniSearch? */
    const declaraSerializacion = (o) => !!o && typeof o === 'object' && o.serializationVersion !== undefined;

    function chequearVocabulario(objeto, archivo) {
      if (!declaraSerializacion(objeto)) return;

      // Declara ser un índice serializado pero no tiene la forma: NO se saltea.
      // Un archivo que el guard no sabe leer y deja pasar es el agujero que
      // ESTRICTEZ+ vino a cerrar — si la forma cambia en una versión nueva de
      // MiniSearch, esto tiene que avisar, no aprobar.
      if (!Array.isArray(objeto.index)) {
        fallas.push(
          `${rel(archivo)} declara \`serializationVersion\` pero su \`index\` no es un array: ` +
            'no sé leer este índice, y un índice que no puedo verificar no se publica.',
        );
        return;
      }

      const publico = vocabularioPublico();
      if (!publico) return; // ya se reportó la falla
      const interno = vocabularioRemovido();

      for (const entrada of objeto.index) {
        if (!Array.isArray(entrada) || typeof entrada[0] !== 'string') {
          fallas.push(
            `${rel(archivo)} tiene una entrada de índice que no es un par [término, datos]: ` +
              'no sé leer este índice, y un índice que no puedo verificar no se publica.',
          );
          return;
        }
        const t = entrada[0];
        if (publico.has(t)) continue;
        if (!hitsVocabulario.has(t)) hitsVocabulario.set(t, { donde: new Set(), interno: interno.has(t) });
        const h = hitsVocabulario.get(t);
        if (h.donde.size < 3) h.donde.add(rel(archivo));
      }
    }

    const archivos = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(html|js|mjs|json|txt|xml|md|map|css|webmanifest)$/.test(e.name)) archivos.push(p);
      }
    };
    walk(SALIDA);
    const enSalida = archivos.length;
    for (const dir of EXTRA) walk(dir);

    if (enSalida === 0) {
      fallas.push(`no hay artefactos en ${rel(SALIDA)}: ¿corrió el build?`);
    } else {
      const hits = new Map();
      for (const f of archivos) {
        let txt;
        try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
        if (/\.(json|map|webmanifest)$/.test(f)) {
          const d = decodificarJson(txt);
          txt = d.texto;
          // El objeto se chequea acá y se suelta: no se retiene en una variable
          // que viva el resto de la iteración. Un índice serializado son 12 MB
          // parseados, y el escaneo de sondas que sigue no lo necesita.
          if (d.objeto) chequearVocabulario(d.objeto, f);
        }
        // Segmento por segmento: el lookaround de las sondas es sobre espacios, así
        // que cada bloque se escanea rodeado de espacios y ningún match cruza el
        // `\n` que separa dos bloques.
        for (const segmento of normalizar(txt).split('\n')) {
          const plano = ` ${segmento} `;
          for (const { re } of lotes) {
            re.lastIndex = 0;
            for (const m of plano.matchAll(re)) {
              const g = m[0];
              if (!hits.has(g)) hits.set(g, new Set());
              const donde = hits.get(g);
              if (donde.size < 3) donde.add(rel(f));
            }
          }
        }
      }
      if (hits.size) {
        fallas.push(`FUGA: ${hits.size} palabra(s) que el preprocesador borró por internas aparecen en el build público`);
        for (const [w, donde] of [...hits].slice(0, 10)) fallas.push(`    "${w}" → ${[...donde].join(', ')}`);
      } else {
        log(`  ✓ sin fuga: ${sondas.length} sonda(s), 0 hits en ${archivos.length} artefactos`);
      }

      if (hitsVocabulario.size) {
        const confirmados = [...hitsVocabulario.values()].filter((h) => h.interno).length;
        fallas.push(
          `ÍNDICE SERIALIZADO SIN VERIFICAR: ${hitsVocabulario.size} término(s) indexados en el build ` +
            `público NO existen en el corpus que se publica (${confirmados} vienen del texto que el ` +
            'preprocesador borró; el resto, o es contenido no publicado, o el índice no lo emitió este motor)',
        );
        for (const [t, h] of [...hitsVocabulario].slice(0, 10)) {
          fallas.push(`    "${t}"${h.interno ? ' [del texto borrado]' : ''} → ${[...h.donde].join(', ')}`);
        }
      } else if (vocabulario) {
        log(`  ✓ índices serializados: todos sus términos existen en el corpus público (${vocabulario.size} términos)`);
      }
    }
  }

  return terminar();
}
