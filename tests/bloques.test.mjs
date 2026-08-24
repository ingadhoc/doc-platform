/**
 * Suite de regresión del parseo de bloques marcados (`:::interno`) y del
 * manifiesto de sondas que el preprocesador le deja al guard.
 *
 *   DOCS_REPO=~/repositorios/oba-docs node --test tests/bloques.test.mjs
 *
 * NECESITA UN REPO CONSUMIDOR: corre el `tools/build.mjs` de verdad sobre los
 * fixtures. El paquete no tiene contenido ni preprocesador, así que sin
 * `DOCS_REPO` (o sin un `docs.config.json` + `tools/build.mjs` en el cwd) la
 * suite se SKIPEA con motivo, en vez de correr degradada o dar verde midiendo
 * nada. Es la contracara del ADR: el preprocesador todavía vive en cada repo.
 *
 * Corre el `tools/build.mjs` REAL del repo consumidor sobre los fixtures de
 * `fixtures/` y mira lo que emitió — el patrón de `tests/build.test.mjs` de
 * adhoc-docs: se protege el COMPORTAMIENTO del build, no su forma.
 *
 * FIXTURES PORTABLES. Los `.md` no viven en el repo consumidor: se copian a un
 * temporal DENTRO del repo (el build resuelve el contenido relativo a su propia
 * raíz) y se borran al terminar. Dos cosas se resuelven así:
 *   - el CRLF deja de depender de `.gitattributes`: `crlf.md` se materializa
 *     convirtiendo a `\r\n` en runtime, y el test VERIFICA los bytes antes de
 *     buildear (si algo lo normaliza, el test lo dice en vez de probar LF);
 *   - el eje del repo deja de estar hardcodeado: el frontmatter recibe
 *     `versions:` sólo si el `docs.config.json` del consumidor es versionado.
 *
 * OJO: el build escribe en `<repo>/site/docs` (no es configurable en los forks
 * actuales). Después de correr esta suite, `site/` tiene el árbol de fixtures:
 * regenerá con `npm run gen` antes de mirar el sitio local.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const REPO = path.resolve(process.env.DOCS_REPO || process.cwd());
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const GUARD = process.env.DOCS_GUARD_PATH
  ? path.resolve(process.cwd(), process.env.DOCS_GUARD_PATH)
  : fileURLToPath(new URL('../bin/guard-fuga.mjs', import.meta.url));

const CFG_PATH = path.join(REPO, 'docs.config.json');
const BUILD_PATH = path.join(REPO, 'tools', 'build.mjs');
const SIN_CONSUMIDOR = !fs.existsSync(CFG_PATH)
  ? `${REPO} no tiene docs.config.json: esta suite corre el preprocesador de un repo de contenido. Pasá DOCS_REPO=<repo de contenido>.`
  : !fs.existsSync(BUILD_PATH)
    ? `${REPO} no tiene tools/build.mjs: el preprocesador todavía vive en cada repo de contenido, no en el paquete. Pasá DOCS_REPO=<repo de contenido>.`
    : null;

const CFG = SIN_CONSUMIDOR ? {} : JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
// El eje del consumidor, en las DOS formas: la unificada (`eje: {tipo,
// default, valores}`) y la de hoy (`versionado`/`versions`/`latest`), porque
// esta suite corre contra repos que todavía no migraron su config.
const VALORES = Array.isArray(CFG.eje?.valores)
  ? CFG.eje.valores.map((v) => String(v.id))
  : (CFG.versions ?? []).map(String);
const VERSIONADO = CFG.eje
  ? CFG.eje.tipo === 'version'
  : CFG.versionado !== false && VALORES.length > 0;
const VERSION = VERSIONADO ? String(CFG.eje?.default || CFG.latest || VALORES[0]) : null;

// Cada centinela vive SOLO dentro de contenido interno de su fixture.
const CENTINELAS = {
  zanahoriacuatropuntos: '::::interno — cuatro puntos, anidado válido en Docusaurus',
  zanahoriafence: ':::interno con un code fence adentro',
  zanahoriadespuesdelfence: 'contenido interno después de un `:::` dentro de un fence',
  zanahoriacrlf: ':::interno en un archivo con finales de línea CRLF',
  zanahoriaarchivocompleto: 'archivo entero con `audience: interno` en el frontmatter',
  zanahoriasubstring: 'trigrama interno que es substring de un trigrama público',
};

const REL = `.tmp-fixtures-bloques-${process.pid}`;
const DIR = path.join(REPO, REL);
const SITE_DOCS = path.join(REPO, 'site', 'docs');
const MANIFIESTO = path.join(REPO, '.guard', 'removido.json');

/** Los dos dialectos de env var del mismo eje: se setean los dos, sin daño. */
const ENV = (extra = {}) => ({
  ...process.env,
  POC_CONTENT: REL,
  DOCS_CONTENT: REL,
  ...(VERSION ? { POC_VERSIONS: VERSION, DOCS_VERSIONS: VERSION } : {}),
  ...extra,
});

function inyectarFrontmatter(txt, eol = '\n') {
  if (!VERSION) return txt;
  const marca = `---${eol}`;
  const i = txt.indexOf(marca);
  if (i !== 0) return txt;
  return `---${eol}versions: ["${VERSION}"]${eol}${txt.slice(marca.length)}`;
}

function materializar() {
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const rel of fs.readdirSync(path.join(FIXTURES, 'manual'))) {
    const origen = path.join(FIXTURES, 'manual', rel);
    const crudo = fs.readFileSync(origen, 'utf8');
    let destino = path.join(DIR, 'manual', rel);
    let contenido = crudo;
    if (rel.endsWith('.md')) {
      contenido = inyectarFrontmatter(crudo);
    } else if (rel.endsWith('.md.tpl')) {
      // CRLF explícito en runtime: ninguna herramienta de git lo puede tocar.
      destino = destino.replace(/\.md\.tpl$/, '.md');
      contenido = inyectarFrontmatter(crudo.replace(/\r?\n/g, '\r\n'), '\r\n');
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
}

function build(audiencia, { permitirFalla = false } = {}) {
  const r = spawnSync(process.execPath, ['tools/build.mjs', `--audience=${audiencia}`, '--quiet'], {
    cwd: REPO, env: ENV(), encoding: 'utf8',
  });
  if (!permitirFalla && r.status !== 0) {
    assert.fail(`el build ${audiencia} falló:\n${r.stdout}${r.stderr}`);
  }
  return r;
}

/** Todo lo que quedó emitido en site/docs, en minúsculas. */
function emitido() {
  const partes = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else partes.push(fs.readFileSync(p, 'utf8'));
    }
  })(SITE_DOCS);
  return partes.join('\n').toLowerCase();
}

const publicable = Array.isArray(CFG.audiences) && CFG.audiences.includes('publico');
const MOTIVO_SKIP =
  SIN_CONSUMIDOR ??
  (publicable
    ? false
    : `${REPO} no declara la audiencia "publico" en docs.config.json: no hay build público que pueda fugar contenido interno. El día que lo tenga, esta suite es criterio de aceptación (ADR 0007).`);

describe('bloques internos y manifiesto de sondas', { skip: MOTIVO_SKIP }, () => {
  before(() => {
    materializar();
    fs.rmSync(SITE_DOCS, { recursive: true, force: true });
  });
  after(() => fs.rmSync(DIR, { recursive: true, force: true }));

  it('el fixture de CRLF tiene CRLF de verdad (si no, el test no prueba nada)', () => {
    const bytes = fs.readFileSync(path.join(DIR, 'manual', 'crlf.md'));
    assert.ok(bytes.includes(Buffer.from('\r\n')), 'crlf.md quedó con finales de línea LF');
  });

  describe('build INTERNO: el contenido interno sí se emite', () => {
    before(() => build('interno'));
    // Control negativo que ninguno de los tres repos tenía: sin esto, el test
    // de abajo pasaría igual con fixtures vacíos o con un build que no emite
    // nada. Prueba que los centinelas existen y que el pipeline los ve.
    for (const [c, desc] of Object.entries(CENTINELAS)) {
      it(`presente en el build interno: ${desc}`, () => {
        assert.ok(emitido().includes(c), `el centinela ${c} no aparece ni en el build interno`);
      });
    }
  });

  describe('build PÚBLICO: nada de eso se publica', () => {
    let texto;
    let manifiesto;
    before(() => {
      fs.rmSync(SITE_DOCS, { recursive: true, force: true });
      build('publico');
      texto = emitido();
      manifiesto = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
    });

    for (const [c, desc] of Object.entries(CENTINELAS)) {
      it(`NO se publica: ${desc}`, () => {
        assert.ok(!texto.includes(c), `FUGA: ${c} apareció en el build público`);
      });
    }

    for (const c of Object.keys(CENTINELAS)) {
      it(`el guard puede detectarlo: hay una sonda que contiene ${c}`, () => {
        // Las sondas son trigramas de palabras contiguas: el centinela aparece
        // DENTRO de una sonda, no como sonda suelta.
        assert.ok(
          (manifiesto.sondas || []).some((g) => g.split(' ').includes(c)),
          `sin sonda que contenga ${c}: el guard no podría verificar esa fuga`,
        );
      });
    }

    it('el manifiesto declara el build público y contó bloques', () => {
      assert.equal(manifiesto.audience, 'publico');
      assert.ok(manifiesto.bloques > 0, 'el manifiesto dice que no se removió nada');
    });
  });

  describe('directivas mal escritas: el build FALLA (fail-closed del preprocesador)', () => {
    // Una línea que se parece a la directiva pero no matchea el patrón
    // publicaría como texto el contenido que había que borrar. Antes de este
    // fix pasaba en silencio.
    const MALAS = [':::interno_', '::: interno', ':::internos', ':::interno-viejo', ':::INTERNO'];
    const conMala = (d, fn) => {
      const tmp = path.join(DIR, 'manual', '_tmp-mal.md');
      const fm = VERSION ? `---\ntitle: T\nversions: ["${VERSION}"]\n---\n` : '---\ntitle: T\n---\n';
      fs.writeFileSync(tmp, `${fm}\nPublico.\n\n${d}\nzanahoriamaldirectiva\n:::\n`);
      try {
        fn(build('publico', { permitirFalla: true }));
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    };

    for (const d of MALAS) {
      it(`\`${d}\` no se deja pasar`, () => {
        conMala(d, (r) => {
          assert.notEqual(r.status, 0, `el build aceptó \`${d}\``);
          assert.match(`${r.stdout}${r.stderr}`, /directiva no reconocida/);
        });
      });
    }

    // MEDIDO, NO ASUMIDO (oba-docs, 23/08): cuando el fail-closed dispara, el
    // preprocesador ya escribió `site/docs/**` y `site/static/agente/md/**` con
    // la línea interna adentro; recién después junta los errores y sale con 1.
    // Hoy no fuga porque el buildCommand encadena con `&&` y el deploy se
    // aborta: la protección está en el operador, no en el programa. Queda como
    // `todo` para que el rojo se vea cuando la unificación de build.mjs lo
    // arregle (o para que se caiga solo si alguien cambia el `&&` por un `;`).
    it('un build fallado no deja el contenido interno escrito en site/', { todo: 'lo arregla la unificación de build.mjs: hoy emite y después falla' }, () => {
      conMala('::: interno', () => {
        assert.ok(!emitido().includes('zanahoriamaldirectiva'), 'el contenido de la directiva mal escrita quedó escrito en site/');
      });
    });
  });

  describe('falsos positivos del guard: no bloquean un deploy limpio', () => {
    it('bundle del framework + trigrama-substring pasan', () => {
      // Cada uno bloqueó (o habría bloqueado) un deploy real sin que hubiera
      // fuga: palabras sueltas del bundle de React, y el trigrama público que
      // contiene al interno como substring ("dias corridos sin rechazo").
      fs.rmSync(SITE_DOCS, { recursive: true, force: true });
      build('publico');
      const manifiesto = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
      const FP = path.join(REPO, `.tmp-fp-${process.pid}`);
      fs.rmSync(FP, { recursive: true, force: true });
      fs.mkdirSync(FP, { recursive: true });
      fs.writeFileSync(path.join(FP, 'main.js'),
        'var d={database:1,responder:2,timeout:3,internals:4};function responder(){}\n');
      const sondaSub = (manifiesto.sondas || []).find((g) => g.endsWith(' si'));
      assert.ok(sondaSub, 'el fixture substring.md no dejó la sonda esperada');
      fs.writeFileSync(path.join(FP, 'pag.html'), `<p>a los 30 ${sondaSub}n rechazo</p>`);
      try {
        const r = spawnSync(process.execPath, [GUARD, '--esperada=publico', `--salida=${FP}`, `--contenido=${REL}`], {
          cwd: REPO, env: ENV(), encoding: 'utf8',
        });
        assert.equal(r.status, 0, `el guard bloqueó un deploy limpio:\n${r.stdout}${r.stderr}`);
      } finally {
        fs.rmSync(FP, { recursive: true, force: true });
      }
    });
  });
});
