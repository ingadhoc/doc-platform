/**
 * Suite del gate del middleware. `node --test middleware.test.mjs`
 *
 * El edge runtime no se puede correr acá, así que se prueba la función pura
 * `decidir(request, env, opciones)` — que es toda la decisión del middleware;
 * lo único que queda afuera es el `next()`.
 *
 * UNIFICADA desde los tres `scripts/test-middleware.mjs`. Rescata:
 *   - de odumbo-docs: los casos de audiencia ausente/desconocida → 503;
 *   - de adhoc-docs: el test negativo de PREVIEWS, el invariante de que el gate
 *     no mire variables de deployment de Vercel, los casos de índice de
 *     búsqueda / asset JS, y usuario distinto / DOCS_AUTH_USER custom;
 *   - de oba-docs: los casos del cartel del MCP, el prefijo de ruta, y que los
 *     estáticos con Bearer sigan andando sin DOCS_AUTH_PASSWORD.
 *
 * Portable: no depende del layout de ningún repo. Los archivos a auditar por
 * los invariantes de código se resuelven por env var, con default al lado del
 * test (`DOCS_GATE_PATH`, `DOCS_MIDDLEWARE_PATH`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const GATE = process.env.DOCS_GATE_PATH
  ? new URL(process.env.DOCS_GATE_PATH, `file://${process.cwd()}/`)
  : new URL('../lib/mcp/gate.mjs', import.meta.url);
const MIDDLEWARE = process.env.DOCS_MIDDLEWARE_PATH
  ? new URL(process.env.DOCS_MIDDLEWARE_PATH, `file://${process.cwd()}/`)
  : new URL('../lib/middleware.js', import.meta.url);

const { decidir } = await import(GATE);

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const req = (path, { metodo = 'GET', auth, host = 'docs.adhoc.com.ar' } = {}) =>
  new Request(`https://${host}${path}`, {
    method: metodo,
    headers: auth ? { authorization: auth } : {},
  });

// Un repo con dos audiencias (oba-docs, odumbo-docs).
const DOS = ['publico', 'interno'];
// Un repo con una sola, interna (adhoc-docs).
const UNA = ['interno'];

const INT = {
  DOCS_AUDIENCE: 'interno',
  DOCS_AUTH_PASSWORD: 'clave-secreta',
  DOCS_MCP_TOKENS: 'tuqui:tok-tuqui,claude-code:tok-cc',
};
const PUB = { DOCS_AUDIENCE: 'publico' };

// Mismo proyecto, deployment de preview: Vercel inyecta estas variables en
// TODOS los deployments. Si el gate las mirara, acá se abriría.
const PREVIEW = { ...INT, VERCEL_ENV: 'preview', VERCEL_URL: 'docs-git-mi-rama.vercel.app' };
const PREVIEW_SIN_VARS = { VERCEL_ENV: 'preview', VERCEL_URL: 'docs-git-mi-rama.vercel.app' };
const HOST_PREVIEW = { host: 'docs-git-mi-rama.vercel.app' };

/** Corre un caso de tabla: `esperado === null` significa "pasa". */
function caso([desc, request, env, audiencias, esperado, extra]) {
  // `async` + `await extra(r)`: hay chequeos que leen el body (una promesa) y
  // con un callback sincrónico su assert se perdía en silencio.
  it(desc, async () => {
    const r = decidir(request, env, { audiencias });
    const obtenido = r === null ? null : r.status;
    assert.equal(obtenido, esperado, `esperaba ${esperado ?? 'pasa'} y dio ${obtenido ?? 'pasa'}`);
    if (extra) await extra(r);
  });
}

describe('configuración del build: fail-closed sobre la variable', () => {
  // El fix que oba-docs NO tenía. Allá la línea era
  // `if (env.DOCS_AUDIENCE !== 'interno') return null`: sin la variable, el
  // sitio quedaba público POR DESCARTE.
  [
    ['sin DOCS_AUDIENCE → 503, no se asume público', req('/19/manual/x'), {}, DOS, 503],
    ['sin DOCS_AUDIENCE: el MCP tampoco atiende', req('/api/mcp', { metodo: 'POST' }), {}, DOS, 503],
    ['sin DOCS_AUDIENCE: el MCP con Bearer VÁLIDO tampoco pasa', req('/api/mcp', { metodo: 'POST', auth: 'Bearer tok-tuqui' }), { DOCS_MCP_TOKENS: 'tuqui:tok-tuqui' }, DOS, 503],
    ['DOCS_AUDIENCE con un valor desconocido → 503', req('/'), { DOCS_AUDIENCE: 'publicoo' }, DOS, 503],
    ['DOCS_AUDIENCE vacía → 503', req('/'), { DOCS_AUDIENCE: '' }, DOS, 503],
    ['el 503 no se indexa ni se cachea', req('/'), {}, DOS, 503, (r) => {
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }],
    ['el 503 no delata que detrás hay un sitio interno', req('/'), {}, DOS, 503, async (r) => {
      assert.ok(!/interno/i.test(await r.clone().text()));
    }],
    ['sin audiencias declaradas el default es el estricto: publico → 503', req('/'), PUB, undefined, 503],
    ['sin audiencias declaradas: interno sigue gateado, no abierto', req('/'), INT, undefined, 401],
    ['repo de una sola audiencia: publico → 503 (no hay build público acá)', req('/adhoc-way/'), { ...INT, DOCS_AUDIENCE: 'publico' }, UNA, 503],
    ['sin DOCS_AUTH_PASSWORD → 503 (fail-closed)', req('/19/manual/x'), { DOCS_AUDIENCE: 'interno' }, DOS, 503],
    ['MCP sin DOCS_MCP_TOKENS → 503 (fail-closed)', req('/api/mcp', { metodo: 'POST' }), { DOCS_AUDIENCE: 'interno', DOCS_AUTH_PASSWORD: 'x' }, DOS, 503],
  ].forEach(caso);
});

describe('sitio público: pasa sin gate (repo con audiencia publica declarada)', () => {
  [
    ['cualquier path pasa sin gate', req('/19/manual/x'), PUB, DOS, null],
    ['el MCP pasa sin gate', req('/api/mcp', { metodo: 'POST' }), PUB, DOS, null],
  ].forEach(caso);
});

describe('camino humano (Basic)', () => {
  [
    ['HTML sin auth → 401 con challenge Basic', req('/19/manual/x'), INT, DOS, 401, (r) => {
      assert.match(r.headers.get('www-authenticate'), /^Basic /);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
    }],
    ['HTML con Basic correcto → pasa', req('/19/manual/x', { auth: basic('adhoc', 'clave-secreta') }), INT, DOS, null],
    ['HTML con Basic incorrecto → 401', req('/19/manual/x', { auth: basic('adhoc', 'mala') }), INT, DOS, 401],
    ['usuario distinto con la clave correcta → 401', req('/19/manual/x', { auth: basic('otro', 'clave-secreta') }), INT, DOS, 401],
    ['DOCS_AUTH_USER custom → pasa con ese usuario', req('/19/manual/x', { auth: basic('equipo', 'clave-secreta') }), { ...INT, DOCS_AUTH_USER: 'equipo' }, DOS, null],
    ['Basic sin `:` → 401, no explota', req('/19/manual/x', { auth: `Basic ${Buffer.from('sinseparador').toString('base64')}` }), INT, DOS, 401],
    ['Basic con base64 roto → 401, no explota', req('/19/manual/x', { auth: 'Basic ###no-es-base64###' }), INT, DOS, 401],
  ].forEach(caso);
});

describe('el gate cubre TODO el output, no sólo el HTML', () => {
  [
    ['el índice de búsqueda del sitio sin auth → 401', req('/search-index.json'), INT, DOS, 401],
    ['el índice del MCP sin auth → 401', req('/agente/index.json'), INT, DOS, 401],
    ['un asset JS sin auth → 401 (el contenido también viaja en el bundle)', req('/assets/js/main.abc123.js'), INT, DOS, 401],
  ].forEach(caso);
});

describe('MCP (máquinas, Bearer)', () => {
  [
    ['GET al MCP sin auth → 200 informativo, SIN challenge', req('/api/mcp'), INT, DOS, 200, (r) => {
      assert.equal(r.headers.get('www-authenticate'), null, 'no debe haber challenge');
    }],
    ['HEAD al MCP sin auth → 200 sin body', req('/api/mcp', { metodo: 'HEAD' }), INT, DOS, 200],
    ['POST al MCP sin auth → 401 SIN challenge Basic', req('/api/mcp', { metodo: 'POST' }), INT, DOS, 401, (r) => {
      const wa = r.headers.get('www-authenticate') || '';
      assert.ok(!/Basic/i.test(wa), `el challenge no puede ser Basic: ${wa}`);
      assert.match(wa, /^Bearer/);
    }],
    ['POST al MCP con Bearer inválido → 401 sin challenge Basic', req('/api/mcp', { metodo: 'POST', auth: 'Bearer inventado' }), INT, DOS, 401, (r) => {
      assert.ok(!/Basic/i.test(r.headers.get('www-authenticate') || ''));
    }],
    ['POST al MCP con Bearer válido (tuqui) → pasa', req('/api/mcp', { metodo: 'POST', auth: 'Bearer tok-tuqui' }), INT, DOS, null],
    ['POST al MCP con Bearer válido (claude-code) → pasa', req('/api/mcp', { metodo: 'POST', auth: 'Bearer tok-cc' }), INT, DOS, null],
    ['GET al MCP con Bearer válido → pasa (no se come el cartel)', req('/api/mcp', { auth: 'Bearer tok-cc' }), INT, DOS, null],
    ['GET al MCP con Basic (browser autenticado) → 200 cartel, no 401', req('/api/mcp', { auth: basic('adhoc', 'clave-secreta') }), INT, DOS, 200],
    ['GET al MCP con Bearer inválido → 200 cartel', req('/api/mcp', { auth: 'Bearer malo' }), INT, DOS, 200],
    ['MCP con Basic (aunque sea el correcto) → 401 Bearer, no pasa', req('/api/mcp', { metodo: 'POST', auth: basic('adhoc', 'clave-secreta') }), INT, DOS, 401],
    ['prefijo del path del MCP NO cuenta como el MCP', req('/api/mcp-viejo', { metodo: 'POST' }), INT, DOS, 401, (r) => {
      assert.match(r.headers.get('www-authenticate'), /^Basic /);
    }],
    ['estático con Bearer válido → pasa (agentes que leen index.json)', req('/agente/index.json', { auth: 'Bearer tok-cc' }), INT, DOS, null],
    ['estático con Bearer inválido → 401 Bearer', req('/agente/index.json', { auth: 'Bearer nope' }), INT, DOS, 401, (r) => {
      assert.match(r.headers.get('www-authenticate'), /^Bearer/);
    }],
    ['estático con Bearer y sin tokens configurados → 401, no pasa', req('/agente/index.json', { auth: 'Bearer tok-cc' }), { DOCS_AUDIENCE: 'interno', DOCS_AUTH_PASSWORD: 'x' }, DOS, 401],
    // Fail-closed POR CAPA: rotar la contraseña de humanos no tira el MCP.
    ['sin DOCS_AUTH_PASSWORD: el MCP con Bearer válido sigue andando', req('/api/mcp', { metodo: 'POST', auth: 'Bearer tok-tuqui' }), { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui,claude-code:tok-cc' }, DOS, null],
    ['sin DOCS_AUTH_PASSWORD: estáticos con Bearer válido siguen andando', req('/agente/index.json', { auth: 'Bearer tok-cc' }), { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui,claude-code:tok-cc' }, DOS, null],
    ['tokens duplicados — ambos valen y gana el último nombre', req('/api/mcp', { metodo: 'POST', auth: 'Bearer t1' }), { DOCS_AUDIENCE: 'interno', DOCS_AUTH_PASSWORD: 'x', DOCS_MCP_TOKENS: 'a:t1,a:t2' }, DOS, null],
    ['Bearer vacío → 401', req('/api/mcp', { metodo: 'POST', auth: 'Bearer ' }), INT, DOS, 401],
  ].forEach(caso);
});

describe('test negativo de los PREVIEWS (criterio "Auth" de la spec de hosting)', () => {
  // La spec midió que Vercel protege los previews y deja producción abierta:
  // exactamente al revés de lo que necesitamos. Nuestra defensa es que el
  // middleware no distingue deployments — y esto lo fija por escrito.
  [
    ['preview: HTML sin auth → 401 igual que producción', req('/19/manual/x', HOST_PREVIEW), PREVIEW, DOS, 401],
    ['preview: el índice de búsqueda sin auth → 401', req('/search-index.json', HOST_PREVIEW), PREVIEW, DOS, 401],
    ['preview: el MCP por POST sin auth → 401', req('/api/mcp', { metodo: 'POST', ...HOST_PREVIEW }), PREVIEW, DOS, 401],
    ['preview: con Basic correcto → pasa (el preview es usable, no está muerto)', req('/19/manual/x', { auth: basic('adhoc', 'clave-secreta'), ...HOST_PREVIEW }), PREVIEW, DOS, null],
    ['preview horneado antes de las env vars → 503, no contenido abierto', req('/19/manual/x', HOST_PREVIEW), PREVIEW_SIN_VARS, DOS, 503],
  ].forEach(caso);
});

describe('invariantes sobre el CÓDIGO (no sobre el comportamiento)', () => {
  const fuente = fs.readFileSync(MIDDLEWARE, 'utf8') + fs.readFileSync(GATE, 'utf8');
  const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('el middleware sigue sin declarar config.matcher', () => {
    // Un matcher es el único modo de que una ruta saltee el gate, y el default
    // de Next excluye `api` primero: dejaría el MCP sin gate y en silencio.
    assert.ok(
      !/export\s+const\s+config|config\.matcher\s*=|matcher\s*:/.test(sinComentarios),
      'NO puede haber config.matcher',
    );
  });

  it('el gate no mira VERCEL_ENV/VERCEL_URL: previews y producción, la misma decisión', () => {
    // Complemento del test negativo de previews: que no haya forma de que el
    // gate mire en qué deployment está corriendo. Un `if (VERCEL_ENV ===
    // 'preview')` pasaría todos los casos de arriba si alguien lo agregara con
    // otra condición.
    assert.ok(
      !/VERCEL_ENV|VERCEL_URL|VERCEL_BRANCH_URL|VERCEL_GIT_/.test(sinComentarios),
      'el gate no puede mirar variables de deployment de Vercel',
    );
  });

  it('el gate no importa node:crypto ni otros builtins (tiene que bundlear en el edge)', () => {
    assert.ok(!/from\s+'node:/.test(sinComentarios), 'sin builtins de Node en la capa edge');
  });

  it('la decisión de audiencia no se toma por presencia de la credencial', () => {
    // El anti-patrón explícito: `if (!env.DOCS_AUTH_PASSWORD) return null`.
    assert.ok(
      !/if\s*\(\s*!\s*env\.DOCS_AUTH_PASSWORD\s*\)\s*return\s+null/.test(sinComentarios),
      'sin contraseña se responde 503, nunca se deja pasar',
    );
  });
});
