/**
 * The `/changes` page of a PR preview: what the PR changes, page by page.
 *
 * It compares the agent index of the PR's base commit against the one of this
 * build (`api/_generated/index.json`, the same file the MCP reads). Both carry
 * each page per value of the axis, with the body already processed, so the
 * diff is about what gets published and needs no git and no knowledge of each
 * repo's preprocessor.
 */

import { createHash } from 'node:crypto';
import { diffLines, diffWordsWithSpace } from 'diff';

/** Unchanged lines kept before and after each change. */
export const CONTEXTO = 2;

const ORDEN_DEL_ESTADO = { modificada: 0, nueva: 1, borrada: 2 };

function articulosPorId(indice) {
  return new Map((indice?.articulos ?? []).map((a) => [a.id ?? `${a.eje ?? '*'}::${a.slug}`, a]));
}

/** Word diff of two short texts (a title, a description). */
export function partesDe(antes, despues) {
  return diffWordsWithSpace(antes ?? '', despues ?? '').map((c) => ({
    tipo: c.added ? 'agregado' : c.removed ? 'quitado' : 'igual',
    texto: c.value,
  }));
}

const lineas = (texto) => texto.replace(/\n$/, '').split('\n');

/**
 * The body diff as blocks: `contexto` (unchanged lines), `omitido` (how many
 * unchanged lines are not shown) and `cambio` (a word diff of the lines that
 * left and entered).
 */
export function bloquesDe(antes, despues, contexto = CONTEXTO) {
  const tramos = diffLines(antes ?? '', despues ?? '');
  const bloques = [];
  for (let i = 0; i < tramos.length; i++) {
    const t = tramos[i];
    if (t.added || t.removed) {
      let quitado = '';
      let agregado = '';
      while (i < tramos.length && (tramos[i].added || tramos[i].removed)) {
        if (tramos[i].removed) quitado += tramos[i].value;
        else agregado += tramos[i].value;
        i++;
      }
      i--;
      bloques.push({ tipo: 'cambio', partes: partesDe(quitado, agregado) });
      continue;
    }
    const todas = lineas(t.value);
    const n = todas.length;
    if (i === 0) {
      if (n > contexto) bloques.push({ tipo: 'omitido', lineas: n - contexto });
      bloques.push({ tipo: 'contexto', lineas: todas.slice(Math.max(0, n - contexto)) });
    } else if (i === tramos.length - 1) {
      bloques.push({ tipo: 'contexto', lineas: todas.slice(0, contexto) });
      if (n > contexto) bloques.push({ tipo: 'omitido', lineas: n - contexto });
    } else if (n <= 2 * contexto) {
      bloques.push({ tipo: 'contexto', lineas: todas });
    } else {
      bloques.push({ tipo: 'contexto', lineas: todas.slice(0, contexto) });
      bloques.push({ tipo: 'omitido', lineas: n - 2 * contexto });
      bloques.push({ tipo: 'contexto', lineas: todas.slice(n - contexto) });
    }
  }
  return bloques.filter((b) => b.tipo !== 'contexto' || b.lineas.length);
}

function huella(...partes) {
  const h = createHash('sha1');
  for (const p of partes) h.update(String(p ?? '')).update('\0');
  return h.digest('hex');
}

/**
 * What changes between two agent indexes. A page that changes the same way
 * in several values of the axis (the 19 and the 18, say) is listed once, with
 * one link per value.
 */
export function cambiosEntreIndices(base, actual) {
  const antes = articulosPorId(base);
  const despues = articulosPorId(actual);
  const valores = [...(actual?.build?.eje?.valores ?? []), ...(base?.build?.eje?.valores ?? [])];
  const etiqueta = new Map(valores.map((v) => [v.id, v.label ?? v.id]));
  const orden = new Map([...new Set(valores.map((v) => v.id))].map((id, i) => [id, i]));

  const grupos = new Map();
  for (const id of new Set([...antes.keys(), ...despues.keys()])) {
    const a = antes.get(id);
    const d = despues.get(id);
    if (a && d && a.title === d.title && (a.description ?? '') === (d.description ?? '') && a.body === d.body) continue;
    const estado = !a ? 'nueva' : !d ? 'borrada' : 'modificada';
    const art = d ?? a;
    const clave = huella(estado, art.slug, a?.title, a?.description, a?.body, d?.title, d?.description, d?.body);
    if (!grupos.has(clave)) grupos.set(clave, { estado, a, d, versiones: [] });
    grupos.get(clave).versiones.push({
      eje: art.eje ?? null,
      ...(art.eje != null ? { label: etiqueta.get(art.eje) ?? art.eje } : {}),
      url: art.url,
    });
  }

  const paginas = [...grupos.values()].map(({ estado, a, d, versiones }) => {
    versiones.sort((x, y) => (orden.get(x.eje) ?? Infinity) - (orden.get(y.eje) ?? Infinity));
    const pagina = { estado, titulo: (d ?? a).title, versiones };
    if (estado === 'modificada') {
      const campos = [];
      if (a.title !== d.title) campos.push({ campo: 'titulo', partes: partesDe(a.title, d.title) });
      if ((a.description ?? '') !== (d.description ?? '')) {
        campos.push({ campo: 'descripcion', partes: partesDe(a.description, d.description) });
      }
      if (campos.length) pagina.campos = campos;
      pagina.bloques = a.body === d.body ? [] : bloquesDe(a.body, d.body);
    }
    return pagina;
  });
  paginas.sort(
    (x, y) =>
      ORDEN_DEL_ESTADO[x.estado] - ORDEN_DEL_ESTADO[y.estado] || x.versiones[0].url.localeCompare(y.versiones[0].url),
  );

  const resumen = { modificadas: 0, nuevas: 0, borradas: 0 };
  for (const p of paginas) resumen[{ modificada: 'modificadas', nueva: 'nuevas', borrada: 'borradas' }[p.estado]]++;
  return { resumen, paginas };
}
