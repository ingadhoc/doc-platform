#!/usr/bin/env node
/**
 * Banco de medición del motor de búsqueda. Corre `buscar()` de un motor
 * (por path, para poder comparar variantes) contra índices reales y los casos
 * normalizados de cada sitio. Ver bench/README.md.
 *
 *   node bench/correr.mjs --indices=<dir> [--perfil=agente|persona|ambos]
 *        [--motor=lib/mcp/indice.mjs] [--suite=bench/suite.json] [--solo=<corrida>]
 *        [--salida=run.json] [--md=reporte.md] [--verboso]
 *   node bench/correr.mjs --indice=<index.json> --casos=<casos.json> [...]
 *   node bench/correr.mjs --comparar=antes.json,despues.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
);
const desdeCwd = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p));
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const num = (x) => (x == null ? '—' : x.toFixed(3));

// ─────────────────────────────────────────────────────────────── comparar

if (args.comparar) {
  const [a, b] = args.comparar.split(',').map((p) => JSON.parse(readFileSync(desdeCwd(p), 'utf8')));
  comparar(a, b);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── corrida

const MOTOR = desdeCwd(args.motor ?? join(AQUI, '..', 'lib', 'mcp', 'indice.mjs'));
const motor = await import(pathToFileURL(MOTOR).href);
if (typeof motor._resetIndice !== 'function') {
  throw new Error(`${MOTOR} no exporta _resetIndice(): el banco lo necesita para cambiar de índice`);
}
const perfiles = args.perfil === 'ambos' ? ['agente', 'persona'] : [args.perfil ?? 'agente'];
// Un motor anterior a `PERFIL` (< v0.14.0) sólo sabe ser `agente`: se le llama sin perfil.
for (const p of perfiles) {
  if (!motor.PERFIL?.[p] && !(p === 'agente' && !motor.PERFIL)) throw new Error(`perfil desconocido para este motor: ${p}`);
}

let corridas;
if (args.indice) {
  corridas = [{ nombre: args.nombre ?? 'ad-hoc', indice: desdeCwd(args.indice), casos: args.casos ? desdeCwd(args.casos) : null }];
} else {
  const suitePath = desdeCwd(args.suite ?? join(AQUI, 'suite.json'));
  const dirIndices = args.indices ?? process.env.BENCH_INDICES;
  if (!dirIndices) throw new Error('falta --indices=<dir> (o BENCH_INDICES) con los index.json de cada sitio');
  const suite = JSON.parse(readFileSync(suitePath, 'utf8'));
  corridas = suite.corridas
    .filter((c) => !args.solo || c.nombre === args.solo || c.nombre.startsWith(`${args.solo}/`))
    .map((c) => ({
      ...c,
      indice: join(desdeCwd(dirIndices), c.indice),
      casos: c.casos ? join(dirname(suitePath), c.casos) : null,
      traducirSlugs: c.traducirSlugs ? join(desdeCwd(dirIndices), c.traducirSlugs) : null,
    }));
}

const salida = { motor: MOTOR, fecha: new Date().toISOString(), perfiles, corridas: [] };

for (const corrida of corridas) {
  if (!existsSync(corrida.indice)) {
    console.log(`\n## ${corrida.nombre}: NO ESTÁ el índice ${corrida.indice} — salteada`);
    salida.corridas.push({ nombre: corrida.nombre, salteada: `falta el índice ${corrida.indice}` });
    continue;
  }
  process.env.DOCS_INDICE_PATH = corrida.indice;
  motor._resetIndice();
  const t0 = performance.now();
  const idx = motor.indice();
  const tCarga = performance.now() - t0;

  if (!corrida.casos) {
    console.log(`\n## ${corrida.nombre}: ${idx.articulos.length} artículos, carga ${tCarga.toFixed(0)} ms — sin casos`);
    salida.corridas.push({ nombre: corrida.nombre, articulos: idx.articulos.length, sinCasos: true });
    continue;
  }

  if (!existsSync(corrida.casos)) {
    console.log(`\n## ${corrida.nombre}: NO ESTÁN los casos ${corrida.casos} (¿corriste normalizar.mjs?) — salteada`);
    salida.corridas.push({ nombre: corrida.nombre, salteada: `faltan los casos ${corrida.casos}` });
    continue;
  }
  const set = JSON.parse(readFileSync(corrida.casos, 'utf8'));
  if (corrida.familias) set.casos = set.casos.filter((c) => corrida.familias.includes(c.familia));
  const traducir = traductorDeSlugs(corrida.traducirSlugs, idx);
  const existentes = new Set(idx.articulos.map((a) => a.slug));
  const deArchivo = resolverArchivos(corrida.archivoASlug, idx, existentes);

  for (const perfil of perfiles) {
    const t1 = performance.now();
    const casos = set.casos.map((c) => evaluar(c, perfil, traducir, existentes, deArchivo));
    const ms = performance.now() - t1;
    const resumen = resumir(casos);
    salida.corridas.push({
      nombre: corrida.nombre,
      perfil,
      origen: set.origen,
      indice: { path: corrida.indice, articulos: idx.articulos.length, buildId: idx.buildId, audiencia: idx.audiencia },
      ms: { carga: Math.round(tCarga), casos: Math.round(ms) },
      resumen,
      casos,
    });
    imprimir(corrida.nombre, perfil, resumen, casos, idx, tCarga, ms);
  }
}

if (args.salida) writeFileSync(desdeCwd(args.salida), JSON.stringify(salida, null, 2) + '\n');
if (args.md) writeFileSync(desdeCwd(args.md), aMarkdown(salida));

// ─────────────────────────────────────────────────────────────── evaluar

function traductorDeSlugs(origen, idx) {
  if (!origen) return (s) => s;
  const clave = (url) => String(url || '').replace(/^\/[^/]+\//, '/');
  const porUrl = new Map(idx.articulos.map((a) => [clave(a.url), a.slug]));
  const fuente = JSON.parse(readFileSync(origen, 'utf8'));
  const mapa = new Map(fuente.articulos.map((a) => [a.slug, porUrl.get(clave(a.url))]));
  return (s) => mapa.get(s) ?? `?${s}`;
}

/**
 * `esperadoArchivo` (casos que nombran el archivo fuente, no el slug) → slug
 * del índice medido, con la misma regla que el `slugOf` del emisor de cada
 * sitio. Sólo cuentan los archivos que resuelven a un slug de ESTE índice:
 * así `en/x.mdx` vale en el índice `en` y su par `es/x.mdx` en el `es`.
 */
function resolverArchivos(regla, idx, existentes) {
  if (!regla) return () => [];
  const sinExt = (a) => a.replace(/\.mdx?$/, '');
  const reglas = {
    // oba-docs / odumbo-docs: `relPath.replace(/\.mdx?$/, '').replace(/\.v\d+$/, '')`
    content: (a) => sinExt(a.replace(/^content\//, '')).replace(/\.v\d+$/, ''),
    // adhoc-docs: además README → index
    'content-readme': (a) => sinExt(a.replace(/^content\//, '')).replace(/(^|\/)README$/, '$1index'),
  };
  if (regla === 'url') {
    // tuqui-docs: el slug sale de la navegación; el archivo `es/x.mdx` se publica en `/es/x`.
    const porUrl = new Map(idx.articulos.map((a) => [a.url, a.slug]));
    return (archivos) => archivos.map((a) => porUrl.get(`/${sinExt(a)}`)).filter(Boolean);
  }
  if (!reglas[regla]) throw new Error(`archivoASlug desconocido: ${regla}`);
  return (archivos) => archivos.map(reglas[regla]).filter((s) => existentes.has(s));
}

function evaluar(caso, perfil, traducir, existentes, deArchivo) {
  const r = motor.buscar({ q: caso.q, ...(caso.filtros ?? {}), ...(motor.PERFIL ? { perfil: motor.PERFIL[perfil] } : {}) });
  const slugs = [...new Set(r.resultados.map((x) => x.slug))];
  const nota = r.nota ? (r.modo === 'or-fallback' ? 'or-fallback' : 'pobreza') : null;
  const out = {
    id: caso.id,
    tipo: caso.tipo,
    familia: caso.familia,
    q: caso.q,
    modo: r.modo,
    total: r.total,
    nota,
    // Señal de "no hay nada bueno" (v0.19.0). Un motor anterior no la tiene: queda en false.
    debil: r.resultadosDebiles === true,
    top3: slugs.slice(0, 3),
  };
  if (caso.brechaConocida) out.brechaConocida = true;

  if (caso.tipo === 'ranking' && caso.esperadoArchivo) {
    caso = { ...caso, esperado: [...new Set(deArchivo(caso.esperadoArchivo))] };
    if (!caso.esperado.length) {
      // Ningún archivo esperado existe en este índice: el caso no se puede medir acá.
      return { ...out, tipo: 'no-medible', esperadoArchivo: caso.esperadoArchivo, ok: null };
    }
  }
  if (caso.tipo === 'ranking') {
    const esperado = caso.esperado.map(traducir);
    const ausentes = esperado.filter((s) => !existentes.has(s));
    const puestos = esperado.map((s) => slugs.indexOf(s) + 1).filter((p) => p > 0);
    const rank = puestos.length ? Math.min(...puestos) : 0;
    Object.assign(out, { esperado, tope: caso.tope, rank, ok: rank > 0 && rank <= caso.tope });
    if (ausentes.length) out.esperadoAusente = ausentes;
  } else if (caso.tipo === 'declinar') {
    const senales = [
      ...(r.total === 0 ? ['cero'] : []),
      ...(r.modo === 'or-fallback' ? ['or-fallback'] : []),
      ...(nota === 'pobreza' ? ['nota-pobreza'] : []),
    ];
    Object.assign(out, { senales, acepta: caso.acepta, ok: senales.some((s) => caso.acepta.includes(s)) });
  }
  return out;
}

function resumir(casos, conFamilias = true) {
  const medibles = casos.filter((c) => c.tipo !== 'no-medible');
  const noMedibles = casos.length - medibles.length;
  casos = medibles;
  const ranking = casos.filter((c) => c.tipo === 'ranking');
  const declinar = casos.filter((c) => c.tipo === 'declinar');
  const tasa = (l, f) => (l.length ? l.filter(f).length / l.length : null);
  return {
    casos: casos.length,
    ranking: ranking.length,
    declinar: declinar.length,
    regresion: casos.length - ranking.length - declinar.length,
    acierto1: tasa(ranking, (c) => c.rank === 1),
    acierto3: tasa(ranking, (c) => c.rank >= 1 && c.rank <= 3),
    mrr: ranking.length ? ranking.reduce((a, c) => a + (c.rank ? 1 / c.rank : 0), 0) / ranking.length : null,
    okTope: tasa(ranking, (c) => c.ok),
    cero: tasa(casos, (c) => c.total === 0),
    orFallback: tasa(casos, (c) => c.modo === 'or-fallback'),
    rescate: tasa(casos, (c) => c.modo === 'rescate-de-tipeo'),
    declara: declinar.length ? `${declinar.filter((c) => c.ok).length}/${declinar.length}` : null,
    // `resultadosDebiles`: cuántos `declinar` marca, y cuántos `ranking` resueltos en el top 3 marca por error.
    debilDeclinar: declinar.length ? `${declinar.filter((c) => c.debil).length}/${declinar.length}` : null,
    debilRanking: tasa(ranking.filter((c) => c.rank >= 1 && c.rank <= 3), (c) => c.debil),
    noMedibles,
    ...(conFamilias ? { familias: porFamilia(casos) } : {}),
  };
}

function porFamilia(casos) {
  const grupos = Object.groupBy(casos, (c) => c.familia ?? '—');
  return Object.fromEntries(
    Object.entries(grupos)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([f, l]) => [f, resumir(l, false)]),
  );
}

// ─────────────────────────────────────────────────────────────── salida

function lineaDeCaso(c) {
  const donde = c.tipo === 'no-medible'
    ? `ningún archivo esperado está en este índice: ${c.esperadoArchivo.join(', ')}`
    : c.tipo === 'ranking'
    ? `puesto ${c.rank || 'ausente'} (tope ${c.tope}) esperado ${c.esperado.join(' | ')}`
    : c.tipo === 'declinar'
      ? `señales [${c.senales.join(', ') || 'ninguna'}] acepta [${c.acepta.join(', ')}]`
      : '';
  const marca = c.brechaConocida ? ' (brecha conocida)' : '';
  const aus = c.esperadoAusente ? ` · ESPERADO AUSENTE DEL ÍNDICE: ${c.esperadoAusente.join(', ')}` : '';
  return `[${c.tipo}] ${c.id}${marca} — modo ${c.modo}, total ${c.total}${c.nota ? `, nota ${c.nota}` : ''} · ${donde}${aus} · top3 ${c.top3.join(', ') || '—'}`;
}

function imprimir(nombre, perfil, s, casos, idx, tCarga, ms) {
  console.log(`\n## ${nombre} · perfil ${perfil} · ${idx.articulos.length} artículos · carga ${tCarga.toFixed(0)} ms · ${casos.length} casos en ${ms.toFixed(0)} ms`);
  console.log(
    `   @1 ${pct(s.acierto1)}  @3 ${pct(s.acierto3)}  MRR ${num(s.mrr)}  ok@tope ${pct(s.okTope)}  ` +
      `cero ${pct(s.cero)}  or ${pct(s.orFallback)}  rescate ${pct(s.rescate)}  declina ${s.declara ?? '—'}  ` +
      `débil decl ${s.debilDeclinar ?? '—'} rank ${pct(s.debilRanking)}` +
      (s.noMedibles ? `  no-medibles ${s.noMedibles}` : ''),
  );
  if (args.familias) {
    for (const [f, x] of Object.entries(s.familias)) {
      console.log(`     ${f.padEnd(22)} n=${x.casos}  @1 ${pct(x.acierto1)}  @3 ${pct(x.acierto3)}  MRR ${num(x.mrr)}  or ${pct(x.orFallback)}  cero ${pct(x.cero)}  declina ${x.declara ?? '—'}`);
    }
  }
  for (const c of casos) {
    if (c.ok === false || c.tipo === 'no-medible' || args.verboso) console.log(`   ${c.ok === false ? '✗' : '·'} ${lineaDeCaso(c)}`);
  }
}

function aMarkdown(run) {
  const filas = run.corridas.filter((c) => c.resumen);
  const out = [];
  out.push(`motor: \`${run.motor}\` · fecha ${run.fecha}`, '');
  for (const perfil of run.perfiles) {
    out.push(`### Perfil \`${perfil}\``, '');
    out.push('| corrida | arts | casos (rank/decl/reg) | @1 | @3 | MRR | ok@tope | cero | or-fallback | rescate | declina | débil decl | débil rank@3 |');
    out.push('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of filas.filter((f) => f.perfil === perfil)) {
      const s = c.resumen;
      out.push(
        `| ${c.nombre} | ${c.indice.articulos} | ${s.casos} (${s.ranking}/${s.declinar}/${s.regresion}) | ${pct(s.acierto1)} | ${pct(s.acierto3)} | ${num(s.mrr)} | ${pct(s.okTope)} | ${pct(s.cero)} | ${pct(s.orFallback)} | ${pct(s.rescate)} | ${s.declara ?? '—'} | ${s.debilDeclinar ?? '—'} | ${pct(s.debilRanking)} |`,
      );
    }
    if (args.familias) {
      out.push('');
      out.push('Por familia:', '');
      out.push('| corrida | familia | n | @1 | @3 | MRR | cero | or-fallback | rescate | declina |');
      out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
      for (const c of filas.filter((f) => f.perfil === perfil)) {
        for (const [fam, x] of Object.entries(c.resumen.familias)) {
          out.push(`| ${c.nombre} | ${fam} | ${x.casos} | ${pct(x.acierto1)} | ${pct(x.acierto3)} | ${num(x.mrr)} | ${pct(x.cero)} | ${pct(x.orFallback)} | ${pct(x.rescate)} | ${x.declara ?? '—'} |`);
        }
      }
    }
    for (const c of run.corridas.filter((f) => f.sinCasos || f.salteada)) {
      out.push(`| ${c.nombre} | ${c.articulos ?? '—'} | ${c.sinCasos ? 'sin casos' : c.salteada} | | | | | | | | | | |`);
    }
    out.push('');
  }
  out.push('### Fallos', '');
  for (const c of filas) {
    const fallos = c.casos.filter((x) => x.ok === false || x.tipo === 'no-medible');
    out.push(`**${c.nombre} · ${c.perfil}** — ${fallos.length} fallo(s)`, '');
    for (const f of fallos) out.push(`- ${lineaDeCaso(f).replace(/\|/g, '/')}`);
    if (fallos.length) out.push('');
  }
  return out.join('\n') + '\n';
}

function comparar(a, b) {
  const clave = (c, x) => `${c.nombre} · ${c.perfil} · ${x.id}`;
  const indexar = (run) => {
    const m = new Map();
    for (const c of run.corridas.filter((f) => f.casos)) for (const x of c.casos) m.set(clave(c, x), x);
    return m;
  };
  const ma = indexar(a);
  const mb = indexar(b);
  console.log(`antes:   ${a.motor} (${a.fecha})\ndespués: ${b.motor} (${b.fecha})\n`);

  const res = (run) => new Map(run.corridas.filter((c) => c.resumen).map((c) => [`${c.nombre} · ${c.perfil}`, c.resumen]));
  const ra = res(a);
  const rb = res(b);
  for (const [k, sb] of rb) {
    const sa = ra.get(k);
    if (!sa) continue;
    const campos = ['acierto1', 'acierto3', 'mrr', 'okTope', 'cero', 'orFallback', 'rescate', 'declara', 'debilDeclinar', 'debilRanking'];
    const cambios = campos.filter((f) => JSON.stringify(sa[f]) === JSON.stringify(sb[f]) ? false : true);
    if (!cambios.length) continue;
    const fmt = (f, v) => (f === 'declara' || f === 'debilDeclinar' ? v : f === 'mrr' ? num(v) : pct(v));
    console.log(`${k}: ${cambios.map((f) => `${f} ${fmt(f, sa[f])}→${fmt(f, sb[f])}`).join('  ')}`);
  }

  let n = 0;
  console.log('');
  for (const [k, xb] of mb) {
    const xa = ma.get(k);
    if (!xa) { console.log(`+ ${k} (nuevo)`); n++; continue; }
    const dif = [];
    if (xa.rank !== xb.rank) dif.push(`puesto ${xa.rank || 'ausente'}→${xb.rank || 'ausente'}`);
    if (xa.ok !== xb.ok) dif.push(`ok ${xa.ok}→${xb.ok}`);
    if (xa.modo !== xb.modo) dif.push(`modo ${xa.modo}→${xb.modo}`);
    if (xa.nota !== xb.nota) dif.push(`nota ${xa.nota}→${xb.nota}`);
    if (Boolean(xa.debil) !== Boolean(xb.debil)) dif.push(`débil ${Boolean(xa.debil)}→${Boolean(xb.debil)}`);
    if ((xa.total === 0) !== (xb.total === 0)) dif.push(`total ${xa.total}→${xb.total}`);
    if (JSON.stringify(xa.top3) !== JSON.stringify(xb.top3)) dif.push(`top3 [${xa.top3.join(', ')}]→[${xb.top3.join(', ')}]`);
    if (!dif.length) continue;
    n++;
    const signo = xa.ok === xb.ok ? '~' : xb.ok ? '▲' : '▼';
    console.log(`${signo} ${k} — ${dif.join(' · ')}`);
  }
  for (const k of ma.keys()) if (!mb.has(k)) { console.log(`- ${k} (ya no está)`); n++; }
  console.log(`\n${n} caso(s) cambian de ${mb.size}`);
}
