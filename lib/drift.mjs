/**
 * El drift-check: cuánto atrás está el pin de un repo consumidor respecto del
 * último tag publicado del paquete, y si en ese rezago hay seguridad del guard
 * o del gate sin adoptar. El CLI es `bin/drift-check.mjs`
 * (`docs-drift-check`); acá está la lógica, sin `process.exit` y con la red
 * inyectable, para poder testear la decisión sin depender de GitHub.
 *
 * POR QUÉ EXISTE: el paquete se consume PINEADO por tag (ADR 0006/0007), que
 * es lo que evita que un fix de la plataforma rompa tres sitios a la vez. La
 * contracara es que un fix de seguridad puede quedarse esperando en un repo sin
 * que nadie lo note: un pin es un "no ahora" que se vuelve "nunca" solo. Este
 * check convierte ese silencio en un check rojo.
 *
 * TRES DECISIONES
 *
 * 1. FALLA (exit 1) sólo por seguridad que toque **guard** o **gate**. El resto
 *    del rezago se reporta y no bloquea: un check que se pone rojo por
 *    cualquier bump enseña a ignorarlo, y entonces tampoco avisa del que
 *    importa. La fuente es la convención del `CHANGELOG.md` del paquete: los
 *    ítems de seguridad arrancan con `[seguridad]`, y bloquean los que además
 *    nombran `guard` o `gate`.
 *
 * 2. SIEMPRE reporta el lag en días entre el tag vigente y el pineado. Es el
 *    instrumento de la alarma de la Etapa B del spec: **≥3 bumps de seguridad
 *    con mediana de adopción > 3 días hábiles en un mes reabre la discusión**
 *    de si el pin manual sigue siendo la forma correcta. Sin este número esa
 *    alarma no se puede evaluar — por eso el reporte sale igual cuando todo
 *    está al día, y por eso hay `--json` (una línea por corrida, agregable).
 *
 * 3. SIN RED, exit 0 con warning. GitHub caído no puede volverse un build
 *    caído de tres sitios de documentación: esto mide un riesgo diferido, no
 *    sirve contenido. Lo que NO hace es fingir que midió.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMOTO = 'https://github.com/ingadhoc/doc-platform';
export const CRUDO = 'https://raw.githubusercontent.com/ingadhoc/doc-platform';

const DIA = 86_400_000;

/** Compara dos tags semver (`v1.2.3` o `1.2.3`). */
export function comparar(a, b) {
  const n = (v) => String(v).replace(/^v/, '').split('.').map(Number);
  const [A, B] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
  return 0;
}

/**
 * El tag pineado sale del spec de la dependencia (`github:org/repo#v1.2.3`).
 * `null` cuando el spec no es un tag exacto: un rango o una rama no es un pin,
 * y sin pin no hay contra qué comparar ni rollback posible.
 */
export function tagDelSpec(spec) {
  const hash = String(spec ?? '').lastIndexOf('#');
  if (hash < 0) return null;
  const ref = String(spec).slice(hash + 1);
  return /^v?\d+\.\d+\.\d+$/.test(ref) ? ref : null;
}

/**
 * Parsea la convención del CHANGELOG del paquete:
 *
 *   ## v0.2.0 — 2026-09-01
 *   - [seguridad] gate: …        ← seguridad; bloquea porque nombra el gate
 *   - indice: …                  ← ítem normal
 *
 * Los `###` de subsección no cortan la versión: sus ítems siguen siendo de
 * ella (así el CHANGELOG puede agrupar por módulo sin engañar al parser).
 */
export function versionesDelChangelog(texto) {
  const bloques = [];
  let actual = null;
  for (const linea of String(texto).split('\n')) {
    const cabecera = linea.match(/^##\s+(v?\d+\.\d+\.\d+)\s*(?:[—-]\s*(\d{4}-\d{2}-\d{2}))?/);
    if (cabecera) {
      actual = { version: cabecera[1], fecha: cabecera[2] ?? null, items: [] };
      bloques.push(actual);
      continue;
    }
    if (actual && /^\s*[-*]\s+/.test(linea)) actual.items.push(linea.replace(/^\s*[-*]\s+/, '').trim());
  }
  return bloques;
}

/** Días hábiles (lunes a viernes) entre dos fechas UTC. */
export function diasHabiles(desde, hasta) {
  let n = 0;
  for (let t = desde.getTime() + DIA; t <= hasta.getTime(); t += DIA) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/**
 * La decisión, sin red ni filesystem: qué hay en el rezago, cuánto lag, y qué
 * bloquea.
 */
export function evaluar({ pineado, vigente, changelog = [] }) {
  const alDia = comparar(pineado, vigente) >= 0;
  const rezago = changelog.filter(
    (v) => comparar(v.version, pineado) > 0 && comparar(v.version, vigente) <= 0,
  );
  const fechaDe = (version) => {
    const bloque = changelog.find((v) => comparar(v.version, version) === 0);
    return bloque?.fecha ? new Date(`${bloque.fecha}T00:00:00Z`) : null;
  };
  const fechaPineado = fechaDe(pineado);
  const fechaVigente = fechaDe(vigente);

  // La etiqueta se busca sobre el ítem SIN su énfasis de markdown: desde la
  // v0.5.0 el CHANGELOG escribe los ítems en negrita, y `**[seguridad] gate: …`
  // no empieza con `[`. El `^` no matcheaba y el mecanismo entero de bloqueo
  // quedó apagado en silencio durante siete ítems de seguridad, dos de ellos
  // bloqueantes. Un check que no puede fallar es peor que no tenerlo.
  const sinEnfasis = (i) => i.replace(/^[*_\s]+/, '');
  const deSeguridad = rezago.flatMap((v) =>
    v.items
      .filter((i) => /^\[seguridad\]/i.test(sinEnfasis(i)))
      .map((i) => ({ version: v.version, fecha: v.fecha, item: i })),
  );
  // Bloquean las dos piezas que impiden servir contenido interno a quien no
  // debe: el gate del edge y el guard de fuga del build.
  const bloqueantes = deSeguridad.filter((s) => /\b(guard|gate)\b/i.test(s.item));

  return {
    alDia,
    rezago: rezago.map((v) => v.version),
    lagDias: fechaPineado && fechaVigente ? Math.round((fechaVigente - fechaPineado) / DIA) : null,
    lagDiasHabiles: fechaPineado && fechaVigente ? diasHabiles(fechaPineado, fechaVigente) : null,
    bumpsDeSeguridad: deSeguridad.length,
    deSeguridad,
    bloqueantes,
  };
}

/** Los tags de versión del remoto, ordenados. Sin auth y sin clonar. */
function leerTagsReal() {
  const crudo = execFileSync('git', ['ls-remote', '--tags', REMOTO], {
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return [...crudo.matchAll(/refs\/tags\/(v?\d+\.\d+\.\d+)(?!\^)/g)]
    .map((m) => m[1])
    .filter((v, i, todos) => todos.indexOf(v) === i)
    .sort(comparar);
}

/**
 * El CHANGELOG del TAG VIGENTE: es el único que conoce todas las versiones del
 * rezago (el del paquete instalado se quedó en la pineada).
 */
async function leerChangelogReal(tag) {
  const respuesta = await fetch(`${CRUDO}/${tag}/CHANGELOG.md`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  return await respuesta.text();
}

/**
 * Corre el drift-check sobre un repo consumidor.
 *
 * @param {object} opciones
 * @param {string}   opciones.repo    raíz del repo consumidor.
 * @param {boolean}  opciones.json    salida de una línea, agregable en CI.
 * @param {Function} opciones.leerTags        inyectable para los tests.
 * @param {Function} opciones.leerChangelog   inyectable para los tests.
 * @returns {Promise<number>} 0 = seguí; 1 = el CI del consumidor se pone rojo.
 */
export async function correrDriftCheck({
  repo = process.cwd(),
  json = false,
  log = console.log,
  error = console.error,
  leerTags = leerTagsReal,
  leerChangelog = leerChangelogReal,
} = {}) {
  const propio = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  );
  const PAQUETE = propio.name;
  const avisos = [];
  const salida = { paquete: PAQUETE, pineado: null, vigente: null, lagDias: null, bumpsDeSeguridad: 0, bloqueantes: [] };
  const decir = (...partes) => {
    if (!json) log(...partes);
  };
  const terminar = (codigo) => {
    if (json) log(JSON.stringify({ ...salida, avisos, exit: codigo }));
    else for (const a of avisos) log(`  ⚠ ${a}`);
    return codigo;
  };

  // ── 1. Qué versión pinea este consumidor ──────────────────────────────────
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'));
  } catch (e) {
    error(`✗ no se pudo leer el package.json de ${repo}: ${e.message}`);
    return 1;
  }

  const spec = pkg.dependencies?.[PAQUETE] ?? pkg.devDependencies?.[PAQUETE] ?? null;
  if (!spec) {
    decir(`· ${repo} no pinea ${PAQUETE}: no hay drift que medir.`);
    return terminar(0);
  }
  const pineado = tagDelSpec(spec);
  salida.pineado = pineado;
  if (!pineado) {
    error(
      `✗ ${PAQUETE} está declarado como "${spec}": el consumo es por TAG EXACTO ` +
        `(p. ej. "${PAQUETE}": "github:ingadhoc/doc-platform#v0.1.0"). Sin tag, ` +
        'ni este check ni un rollback tienen contra qué comparar.',
    );
    return 1;
  }

  // El lockfile es la otra mitad del pin: `npm ci` instala lo que dice ahí.
  //
  // ESTO BLOQUEA, a diferencia del rezago. Un pin atrasado es un riesgo
  // diferido —el sitio sirve una versión vieja pero coherente con lo que el
  // repo declara—; un lockfile desalineado es otra cosa: lo que se deploya NO
  // es lo que el PR dice que se deploya, y el CI lo bendice igual.
  //
  // Pasó el 01/09/2026: el `package.json` de los tres repos subió a v0.6.0
  // editando el lock a mano, el lock siguió resolviendo v0.4.1, y producción se
  // deployó con la versión vieja. El check ya detectaba el desalineado, pero
  // como aviso: verde en el CI, tres PRs mergeados y el sitio corriendo otro
  // código. Media tarde para notar que el pin no había subido nunca.
  try {
    const lock = JSON.parse(readFileSync(resolve(repo, 'package-lock.json'), 'utf8'));
    const entrada = lock.packages?.[`node_modules/${PAQUETE}`] ?? lock.dependencies?.[PAQUETE] ?? null;
    const resuelto = entrada?.resolved ?? '';
    salida.lockfile = resuelto || null;
    if (
      resuelto &&
      !resuelto.includes(pineado) &&
      !String(entrada?.version ?? '').includes(pineado.replace(/^v/, ''))
    ) {
      salida.lockDesalineado = true;
      error(
        `✗ el package.json pinea ${pineado} y el lockfile resolvió "${resuelto}"` +
          `${entrada?.version ? ` (versión ${entrada.version})` : ''}: ` +
          '`npm ci` va a instalar eso, no el pin. Corré ' +
          `\`npm install @ingadhoc/docs-platform@github:ingadhoc/doc-platform#${pineado}\` ` +
          'y commiteá el lockfile — editar la línea a mano no re-resuelve el paquete.',
      );
      return terminar(1);
    }
  } catch {
    avisos.push('sin package-lock.json: `npm ci` no puede reproducir el pin.');
  }

  // ── 2. Cuál es el último tag publicado ────────────────────────────────────
  let tags;
  try {
    tags = await leerTags();
  } catch (e) {
    // Sin red (o GitHub caído): no bloqueamos builds. Ver decisión 3.
    log(
      `⚠ drift-check: no se pudo consultar ${REMOTO} (${String(e.message || e).split('\n')[0]}). ` +
        'No se bloquea el build: el drift-check mide un riesgo diferido, no sirve contenido. ' +
        `Pin declarado: ${pineado}.`,
    );
    return terminar(0);
  }

  if (!tags.length) {
    log(`⚠ drift-check: el remoto no tiene tags de versión todavía. Pin declarado: ${pineado}.`);
    return terminar(0);
  }

  const vigente = tags[tags.length - 1];
  salida.vigente = vigente;

  // ── 3. Qué hay en el rezago (y desde cuándo) ──────────────────────────────
  let changelog = [];
  try {
    changelog = versionesDelChangelog(await leerChangelog(vigente));
  } catch (e) {
    avisos.push(`no se pudo leer el CHANGELOG de ${vigente}: ${String(e.message || e).split('\n')[0]}`);
  }

  const r = evaluar({ pineado, vigente, changelog });
  Object.assign(salida, {
    lagDias: r.lagDias,
    lagDiasHabiles: r.lagDiasHabiles,
    bumpsDeSeguridad: r.bumpsDeSeguridad,
    bloqueantes: r.bloqueantes.map((b) => `${b.version}: ${b.item}`),
    versionesDeRezago: r.rezago,
  });

  // ── 4. Reporte (siempre) ──────────────────────────────────────────────────
  decir(`drift-check de ${PAQUETE}`);
  decir(`  pineado: ${pineado}    vigente: ${vigente}`);
  if (r.alDia) {
    decir('  · al día: el pin es el último tag publicado.');
  } else {
    decir(
      `  · rezago: ${r.rezago.length || '?'} versión(es) — ` +
        `${r.rezago.join(', ') || 'sin changelog para detallar'}`,
    );
    decir(
      r.lagDias == null
        ? '  · lag: no se pudo calcular (el CHANGELOG no trae fecha de una de las dos versiones)'
        : `  · lag: ${r.lagDias} día(s) corridos / ${r.lagDiasHabiles} hábil(es) entre ${pineado} y ${vigente}`,
    );
    decir(`  · bumps de seguridad en el rezago: ${r.bumpsDeSeguridad}`);
    for (const s of r.deSeguridad) decir(`      ${s.version}  ${s.item}`);
    decir(
      '  · alarma de la Etapa B: ≥3 bumps de seguridad con mediana de adopción > 3 días ' +
        'hábiles en un mes reabre la discusión del pin manual. Este número es el insumo.',
    );
  }

  if (r.bloqueantes.length) {
    error('\n✗ drift-check: hay seguridad del guard o del gate sin adoptar\n');
    for (const b of r.bloqueantes) error(`  ${b.version}  ${b.item}`);
    error(
      `\n  Subí el pin a ${vigente} (package.json + lockfile) y volvé a correr el CI. ` +
        'El rezago de seguridad del gate o del guard no espera al próximo sprint: son las dos ' +
        'piezas que impiden servir contenido interno a quien no debe.\n',
    );
    return terminar(1);
  }

  return terminar(0);
}
