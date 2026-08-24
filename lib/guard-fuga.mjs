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
 *
 * Los paths NO se pueden fijar en `docs.config.json`: el contrato tiene
 * `additionalProperties: false` y un bloque de paths de una herramienta no es
 * parte del contrato config ↔ plataforma. Van en el buildCommand, que es donde
 * se ve qué se está escaneando.
 */

import fs from 'node:fs';
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
    const normalizar = (txt) => txt
      .replace(/<[^>]*>/g, ' ')
      .toLowerCase()
      .replace(/[`*_~#>\[\]()|{}"'\\]/g, ' ')
      .replace(/[^a-záéíóúñü0-9]+/gi, ' ')
      .trim();

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
    const decodificarJson = (txt) => {
      try {
        const partes = [];
        const juntar = (v) => {
          if (typeof v === 'string') partes.push(v);
          else if (Array.isArray(v)) v.forEach(juntar);
          else if (v && typeof v === 'object') Object.values(v).forEach(juntar);
        };
        juntar(JSON.parse(txt));
        return partes.join('\n');
      } catch {
        return txt.replace(/\\[nrtbfuxv]/g, ' ');
      }
    };

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
        if (/\.(json|map|webmanifest)$/.test(f)) txt = decodificarJson(txt);
        const plano = ` ${normalizar(txt)} `;
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
      if (hits.size) {
        fallas.push(`FUGA: ${hits.size} palabra(s) que el preprocesador borró por internas aparecen en el build público`);
        for (const [w, donde] of [...hits].slice(0, 10)) fallas.push(`    "${w}" → ${[...donde].join(', ')}`);
      } else {
        log(`  ✓ sin fuga: ${sondas.length} sonda(s), 0 hits en ${archivos.length} artefactos`);
      }
    }
  }

  return terminar();
}
