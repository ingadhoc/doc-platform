#!/usr/bin/env node
/**
 * Arma `bench/casos/` (no se versiona) con los casos de búsqueda de cada repo
 * de contenido, en el formato único del banco (ver README). Lee de `--ref` de
 * cada clon con `git show`, sin cambiar de rama ni tocar el árbol de trabajo.
 *
 *   node bench/normalizar.mjs [--clones=~/repositorios] [--ref=origin/main] [--evals=<dir>]
 *
 * Dos fuentes por repo:
 *
 * - Los golden sets que cada repo ya tenía, cada uno en su formato: se
 *   traducen a `bench/casos/<sitio>.json`.
 * - Los sets a ciegas, ya en el formato del banco: `evals/busqueda/ciegos.json`
 *   (el set de ajuste) y `evals/busqueda/validacion.json`. Se copian a
 *   `bench/casos/{ciegos,validacion}/<sitio>.json`. Con `--evals=<dir>` se leen
 *   de `<dir>/<sitio>/evals/busqueda/` en disco en vez del clon, para medir un
 *   set antes de que llegue al repo.
 *
 * No inventa casos: sólo traduce o copia los que ya existen. Un repo sin un set
 * no genera el archivo, y la corrida que lo usa queda salteada.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const CLONES = (args.clones ?? '~/repositorios').replace(/^~/, homedir());
const REF = args.ref ?? 'origin/main';

// stderr callado: un set que el repo no tiene es un caso esperado, y se avisa abajo.
const git = (repo, ...a) =>
  execFileSync('git', ['-C', join(CLONES, repo), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const leer = (repo, ruta) => git(repo, 'show', `${REF}:${ruta}`);
const sha = (repo) => git(repo, 'rev-parse', '--short', REF).trim();

// Declarar = cero resultados, relleno OR o nota de pobreza. Cada repo acepta
// un subconjunto distinto; se conserva el de su runner.
const ACEPTA_OBA = ['cero', 'or-fallback', 'nota-pobreza']; // oba: `!!r.nota || r.total === 0`
const ACEPTA_TUQUI = ['cero', 'or-fallback']; // tuqui: `total === 0 || modo === 'or-fallback'`

function oba() {
  const ruta = 'scripts/golden/consultas.json';
  const set = JSON.parse(leer('oba-docs', ruta));
  // El runner (`scripts/busqueda-ranking.mjs`) filtra todo por la 19.
  const filtros = { version: '19' };
  const casos = [
    ...set.casos.map((c, i) => ({
      id: `r${String(i + 1).padStart(2, '0')}-${c.q}`,
      familia: c.tipo,
      tipo: 'ranking',
      q: c.q,
      filtros,
      esperado: [c.esperado],
      tope: c.tope,
      ...(c.esperadoFalla ? { brechaConocida: true } : {}),
    })),
    ...set.sinRespuesta.casos.map((c, i) => ({
      id: `d${String(i + 1).padStart(2, '0')}-${c.q}`,
      familia: 'sinRespuesta',
      tipo: 'declinar',
      q: c.q,
      filtros,
      acepta: ACEPTA_OBA,
      ...(c.esperadoFalla ? { brechaConocida: true } : {}),
    })),
  ];
  return { sitio: 'oba-docs', origen: `oba-docs@${sha('oba-docs')}:${ruta}`, casos };
}

async function adhoc() {
  const ruta = 'golden/consultas.mjs';
  const src = leer('adhoc-docs', ruta);
  const { CONSULTAS } = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  // El golden set de adhoc-docs es de regresión: no afirma qué slug es el
  // correcto, afirma que la respuesta no cambió. Sólo dos casos tienen un
  // resultado esperado escrito en golden/README.md: 06 (todo palabras vacías:
  // cero con hint) y 11 (inexistente: or-fallback con nota). Los de `fixture`
  // miden otro índice y quedan afuera.
  const declinan = new Set(['06-buscar-solo-vacias', '11-buscar-cero-resultados']);
  const casos = CONSULTAS.filter((c) => c.corpus === 'corpus' && c.tool === 'buscar').map((c) => {
    const { q, ...filtros } = c.args;
    const base = { id: c.nombre, familia: 'golden', q, ...(Object.keys(filtros).length ? { filtros } : {}) };
    return declinan.has(c.nombre)
      ? { ...base, tipo: 'declinar', acepta: ACEPTA_OBA }
      : { ...base, tipo: 'regresion' };
  });
  return { sitio: 'adhoc-docs', origen: `adhoc-docs@${sha('adhoc-docs')}:${ruta}`, casos };
}

function tuqui() {
  const ruta = 'evals/casos.json';
  const set = JSON.parse(leer('tuqui-docs', ruta));
  const tope = { top1: 1, top3: 3, alguno: 3 };
  const casos = set.map((c) => {
    const base = { id: c.id, familia: c.familia, q: c.pregunta };
    const e = c.espera;
    if (e.tipo === 'declina') return { ...base, tipo: 'declinar', acepta: ACEPTA_TUQUI };
    if (!(e.tipo in tope)) throw new Error(`${c.id}: tipo de espera desconocido ${e.tipo}`);
    return { ...base, tipo: 'ranking', esperado: e.slugs ?? [e.slug], tope: tope[e.tipo] };
  });
  return { sitio: 'tuqui-docs', origen: `tuqui-docs@${sha('tuqui-docs')}:${ruta}`, casos };
}

mkdirSync(join(AQUI, 'casos'), { recursive: true });
for (const set of [oba(), await adhoc(), tuqui()]) {
  const destino = join(AQUI, 'casos', `${set.sitio}.json`);
  writeFileSync(destino, JSON.stringify(set, null, 2) + '\n');
  const porTipo = Object.groupBy(set.casos, (c) => c.tipo);
  const detalle = Object.entries(porTipo).map(([t, l]) => `${t} ${l.length}`).join(', ');
  console.log(`${set.sitio}: ${set.casos.length} casos (${detalle}) <- ${set.origen}`);
}
console.log(`odumbo-docs: sin casos de búsqueda en ${REF} (no se genera archivo)`);

// ──────────────────────────────────────────────────────────── sets a ciegas

const TIPOS = new Set(['ranking', 'declinar', 'regresion']);

/** Un set a ciegas del repo: `null` si el repo no lo tiene. */
function leerSet(sitio, set) {
  const ruta = `evals/busqueda/${set}.json`;
  if (args.evals) {
    const archivo = join(args.evals.replace(/^~/, homedir()), sitio, ruta);
    if (!existsSync(archivo)) return null;
    return { crudo: readFileSync(archivo, 'utf8'), origen: `${archivo} (en disco)` };
  }
  try {
    return { crudo: leer(sitio, ruta), origen: `${sitio}@${sha(sitio)}:${ruta}` };
  } catch {
    return null;
  }
}

/** El set ya viene en el formato del banco: sólo se verifica que lo sea. */
function validar(sitio, set, casos) {
  const ids = new Set();
  for (const c of casos) {
    const donde = `${sitio}/${set} ${c.id ?? '(sin id)'}`;
    if (!c.id || typeof c.q !== 'string') throw new Error(`${donde}: falta \`id\` o \`q\``);
    if (ids.has(c.id)) throw new Error(`${donde}: id repetido`);
    ids.add(c.id);
    if (!TIPOS.has(c.tipo)) throw new Error(`${donde}: tipo desconocido ${c.tipo}`);
    if (c.tipo === 'ranking' && !(c.esperado?.length || c.esperadoArchivo?.length)) throw new Error(`${donde}: ranking sin \`esperado\` ni \`esperadoArchivo\``);
    if (c.tipo === 'ranking' && !Number.isInteger(c.tope)) throw new Error(`${donde}: ranking sin \`tope\``);
    if (c.tipo === 'declinar' && !c.acepta?.length) throw new Error(`${donde}: declinar sin \`acepta\``);
  }
}

for (const set of ['ciegos', 'validacion']) {
  mkdirSync(join(AQUI, 'casos', set), { recursive: true });
  for (const sitio of ['oba-docs', 'odumbo-docs', 'adhoc-docs', 'tuqui-docs']) {
    const destino = join(AQUI, 'casos', set, `${sitio}.json`);
    const leido = leerSet(sitio, set);
    if (!leido) {
      // Sin set no queda uno viejo: la corrida se saltea en vez de medir otra cosa.
      rmSync(destino, { force: true });
      console.log(`${set}/${sitio}: sin evals/busqueda/${set}.json (no se genera archivo)`);
      continue;
    }
    const { casos } = JSON.parse(leido.crudo);
    validar(sitio, set, casos);
    writeFileSync(destino, JSON.stringify({ sitio, origen: leido.origen, casos }, null, 2) + '\n');
    console.log(`${set}/${sitio}: ${casos.length} casos <- ${leido.origen}`);
  }
}
