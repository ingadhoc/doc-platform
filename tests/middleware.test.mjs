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

const { decidir, RUTAS_DE_PUERTA } = await import(GATE);
const { COOKIE_SESION, firmarSesion } = await import(
  new URL('../lib/mcp/sesion.mjs', import.meta.url),
);

const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

/** `html: true` = alguien navegando; sin eso, una máquina pidiendo un archivo.
 *  La distinción decide entre mandar al login (302) y contestar 401. */
const req = (path, { metodo = 'GET', auth, cookie, html, host = 'docs.adhoc.com.ar' } = {}) =>
  new Request(`https://${host}${path}`, {
    method: metodo,
    headers: {
      ...(auth ? { authorization: auth } : {}),
      ...(cookie ? { cookie } : {}),
      ...(html ? { accept: 'text/html,application/xhtml+xml' } : {}),
    },
  });

const SECRETO = 'secreto-de-firma';
/** La sesión de alguien de Adhoc que ya entró con su usuario de Odoo. */
const SESION = `${COOKIE_SESION}=${await firmarSesion({ sub: 1866, email: 'vib@example.com' }, SECRETO)}`;
/** Firmada de verdad, pero con otro secreto: la del que se la quiso inventar. */
const SESION_AJENA = `${COOKIE_SESION}=${await firmarSesion({ sub: 1 }, 'otro-secreto')}`;

// Un repo con dos audiencias (oba-docs, odumbo-docs).
const DOS = ['publico', 'interno'];
// Un repo con una sola, interna (adhoc-docs).
const UNA = ['interno'];

const INT = {
  DOCS_AUDIENCE: 'interno',
  DOCS_SESION_SECRET: SECRETO,
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
    const r = await decidir(request, env, { audiencias });
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
    ['sin DOCS_SESION_SECRET → 503 (fail-closed): nadie entra, ni siquiera al login', req('/19/manual/x'), { DOCS_AUDIENCE: 'interno' }, DOS, 503],
    ['MCP sin DOCS_MCP_TOKENS → 503 (fail-closed)', req('/api/mcp', { metodo: 'POST' }), { DOCS_AUDIENCE: 'interno', DOCS_SESION_SECRET: SECRETO }, DOS, 503],
  ].forEach(caso);
});

describe('sitio público: pasa sin gate (repo con audiencia publica declarada)', () => {
  [
    ['cualquier path pasa sin gate', req('/19/manual/x'), PUB, DOS, null],
    ['el MCP pasa sin gate', req('/api/mcp', { metodo: 'POST' }), PUB, DOS, null],
  ].forEach(caso);
});

describe('camino humano: la sesión del usuario de Odoo, y nada más', () => {
  [
    ['navegando sin sesión → al login, con el destino a cuestas', req('/19/manual/x', { html: true }), INT, DOS, 302, (r) => {
      assert.equal(r.headers.get('location'), '/api/auth/login?volver=%2F19%2Fmanual%2Fx');
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
    }],
    ['con sesión válida → pasa', req('/19/manual/x', { cookie: SESION, html: true }), INT, DOS, null],
    ['una máquina sin sesión → 401 y NUNCA un challenge Basic', req('/search-index.json'), INT, DOS, 401, (r) => {
      // El prompt del browser pediría una contraseña que ya no existe.
      assert.equal(r.headers.get('www-authenticate'), null);
    }],
    // LA CREDENCIAL COMPARTIDA SE FUE. Estos tres son el test negativo de la
    // v0.6.0: quien todavía tenga la de Bitwarden en el llavero no entra, y los
    // deployments viejos dejan de ser accesibles con el secreto de su época.
    ['la credencial compartida vieja ya no abre nada', req('/19/manual/x', { auth: basic('adhoc', 'clave-secreta'), html: true }), INT, DOS, 302],
    ['ni siquiera con DOCS_AUTH_PASSWORD todavía seteada en el proyecto', req('/19/manual/x', { auth: basic('adhoc', 'clave-secreta'), html: true }), { ...INT, DOCS_AUTH_PASSWORD: 'clave-secreta' }, DOS, 302],
    ['y sin DOCS_SESION_SECRET, tenerla no salva el sitio: 503', req('/19/manual/x', { auth: basic('adhoc', 'clave-secreta') }), { DOCS_AUDIENCE: 'interno', DOCS_AUTH_PASSWORD: 'clave-secreta' }, DOS, 503],
    // Basura en la cookie: no explota, no entra.
    ['cookie con la firma de otro → al login', req('/19/manual/x', { cookie: SESION_AJENA, html: true }), INT, DOS, 302],
    ['cookie que no es ni base64 → al login, sin explotar', req('/19/manual/x', { cookie: `${COOKIE_SESION}=###nada###`, html: true }), INT, DOS, 302],
    ['cookie vacía → al login', req('/19/manual/x', { cookie: `${COOKIE_SESION}=`, html: true }), INT, DOS, 302],
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
    ['GET al MCP con la sesión del browser → 200 cartel, no 401', req('/api/mcp', { cookie: SESION }), INT, DOS, 200],
    ['GET al MCP con Bearer inválido → 200 cartel', req('/api/mcp', { auth: 'Bearer malo' }), INT, DOS, 200],
    ['MCP con sesión de humano → 401 Bearer: la sesión no abre el MCP', req('/api/mcp', { metodo: 'POST', cookie: SESION }), INT, DOS, 401],
    ['prefijo del path del MCP NO cuenta como el MCP', req('/api/mcp-viejo', { metodo: 'POST' }), INT, DOS, 401, (r) => {
      // Cae en el camino humano: 401 pelado, sin challenge de ningún tipo.
      assert.equal(r.headers.get('www-authenticate'), null);
    }],
    ['estático con Bearer válido → pasa (agentes que leen index.json)', req('/agente/index.json', { auth: 'Bearer tok-cc' }), INT, DOS, null],
    ['estático con Bearer inválido → 401 Bearer', req('/agente/index.json', { auth: 'Bearer nope' }), INT, DOS, 401, (r) => {
      assert.match(r.headers.get('www-authenticate'), /^Bearer/);
    }],
    ['estático con Bearer y sin tokens configurados → 401, no pasa', req('/agente/index.json', { auth: 'Bearer tok-cc' }), { DOCS_AUDIENCE: 'interno', DOCS_SESION_SECRET: SECRETO }, DOS, 401],
    // Fail-closed POR CAPA: que el login de humanos no esté configurado —o que
    // Odoo esté caído— no tiene por qué tirar el MCP ni los estáticos de los
    // agentes. Es lo que queda en lugar del break-glass: las máquinas no
    // dependen de Odoo.
    ['sin DOCS_SESION_SECRET: el MCP con Bearer válido sigue andando', req('/api/mcp', { metodo: 'POST', auth: 'Bearer tok-tuqui' }), { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui,claude-code:tok-cc' }, DOS, null],
    ['sin DOCS_SESION_SECRET: estáticos con Bearer válido siguen andando', req('/agente/index.json', { auth: 'Bearer tok-cc' }), { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui,claude-code:tok-cc' }, DOS, null],
    ['tokens duplicados — ambos valen y gana el último nombre', req('/api/mcp', { metodo: 'POST', auth: 'Bearer t1' }), { DOCS_AUDIENCE: 'interno', DOCS_SESION_SECRET: SECRETO, DOCS_MCP_TOKENS: 'a:t1,a:t2' }, DOS, null],
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
    ['preview: con sesión válida → pasa (el preview es usable, no está muerto)', req('/19/manual/x', { cookie: SESION, ...HOST_PREVIEW }), PREVIEW, DOS, null],
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

// ─────────────────────────── login con el usuario de Odoo (task 72391)

describe('la sesión firmada reemplaza a la credencial compartida', () => {
  const SECRETO = 'secreto-de-firma';
  // Un sitio interno ya migrado: sesión sí, credencial compartida no.
  const CON_SESION = {
    DOCS_AUDIENCE: 'interno',
    DOCS_SESION_SECRET: SECRETO,
    DOCS_MCP_TOKENS: 'tuqui:tok-tuqui',
  };

  const navegando = (path, cookie) =>
    new Request(`https://docs-interna.adhoc.inc${path}`, {
      headers: { accept: 'text/html,application/xhtml+xml', ...(cookie ? { cookie } : {}) },
    });
  const buscando = (path, cookie) =>
    new Request(`https://docs-interna.adhoc.inc${path}`, {
      headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
    });

  const cookieViva = async () =>
    `${COOKIE_SESION}=${await firmarSesion({ sub: 1866, email: 'vib@example.com' }, SECRETO)}`;

  it('con sesión válida, la persona pasa', async () => {
    const r = await decidir(navegando('/19/manual/x', await cookieViva()), CON_SESION, {
      audiencias: DOS,
    });
    assert.equal(r, null);
  });

  it('sin sesión, a la persona se la manda a loguearse y vuelve a donde quería ir', async () => {
    const r = await decidir(navegando('/19/manual/facturas?q=arca'), CON_SESION, {
      audiencias: DOS,
    });
    assert.equal(r.status, 302);
    assert.equal(
      r.headers.get('location'),
      '/api/auth/login?volver=%2F19%2Fmanual%2Ffacturas%3Fq%3Darca',
    );
  });

  it('a las máquinas no se las redirige: 401 y sin challenge Basic', async () => {
    // El buscador del sitio pide `/search-index.json` con fetch. Un 302 le
    // devolvería HTML de login donde espera JSON, y un challenge `Basic` le
    // abriría al humano el prompt de una contraseña que ya no existe.
    const r = await decidir(buscando('/search-index.json'), CON_SESION, { audiencias: DOS });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), null);
  });

  it('una cookie con la firma cambiada no entra', async () => {
    const valor = await firmarSesion({ sub: 1866 }, 'otro-secreto');
    const r = await decidir(navegando('/x', `${COOKIE_SESION}=${valor}`), CON_SESION, {
      audiencias: DOS,
    });
    assert.equal(r.status, 302);
  });

  it('fail-closed: sin DOCS_SESION_SECRET, 503', async () => {
    // Ni un sitio abierto ni un sitio que pide algo que nadie puede tener: el
    // build está mal configurado y se dice.
    const r = await decidir(navegando('/x'), { DOCS_AUDIENCE: 'interno' }, { audiencias: DOS });
    assert.equal(r.status, 503);
  });

  it('no queda break-glass: la credencial compartida no vuelve por estar seteada', async () => {
    // El punto de la v0.6.0. Dejar `DOCS_AUTH_PASSWORD` en el proyecto de
    // Vercel no reabre nada: el camino Basic no existe más en el código, así
    // que borrar la variable es prolijidad y no un cambio de seguridad.
    const basicOk = `Basic ${Buffer.from('adhoc:clave-secreta').toString('base64')}`;
    const r = await decidir(
      new Request('https://d/x', { headers: { authorization: basicOk, accept: 'text/html' } }),
      { ...CON_SESION, DOCS_AUTH_PASSWORD: 'clave-secreta' },
      { audiencias: DOS },
    );
    assert.equal(r.status, 302, 'tiene que mandarlo a loguearse con su usuario');
  });

  it('el MCP no cambia: sigue siendo Bearer, la sesión no lo abre', async () => {
    const r = await decidir(
      new Request('https://d/api/mcp', { method: 'POST', headers: { cookie: await cookieViva() } }),
      CON_SESION,
      { audiencias: DOS },
    );
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer/);
  });
});

describe('las rutas de puerta', () => {
  const CON_SESION = { DOCS_AUDIENCE: 'interno', DOCS_SESION_SECRET: 'secreto-de-firma' };

  for (const ruta of RUTAS_DE_PUERTA) {
    it(`${ruta} pasa sin credencial (si no, no hay forma de llegar al login)`, async () => {
      assert.equal(await decidir(req(ruta), CON_SESION, { audiencias: DOS }), null);
    });
  }

  it('la lista es exacta, no un prefijo: /api/auth/otra-cosa NO pasa', async () => {
    // Con un prefijo, agregar un archivo en esa carpeta publicaría cualquier
    // cosa sin gate y nadie lo vería en el diff.
    const r = await decidir(req('/api/auth/otra-cosa'), CON_SESION, { audiencias: DOS });
    assert.notEqual(r, null);
  });

  it('un build mal configurado devuelve 503 hasta en la puerta', async () => {
    const r = await decidir(req('/api/auth/login'), {}, { audiencias: DOS });
    assert.equal(r.status, 503);
  });

  it('lo que la puerta reparte sin credencial NO abre el gate', async () => {
    // El agujero, de punta a punta y con las dos piezas de verdad: la puerta
    // pasa sin credencial y contesta con una cookie firmada. Un anónimo la
    // pide, le cambia el nombre a `docs_sesion` y la manda de vuelta. Si el
    // gate la acepta, entró a toda la documentación interna sin pasar nunca
    // por Odoo, sin ser nadie, y renovable para siempre.
    const env = {
      DOCS_AUDIENCE: 'interno',
      DOCS_SESION_SECRET: 'secreto-de-firma',
      DOCS_ODOO_URL: 'https://test-adhoc.example.com',
      DOCS_ODOO_CLIENT_ID: 'un-client-id',
      DOCS_ODOO_CLIENT_SECRET: 'un-secreto',
      DOCS_SITIO_URL: 'https://docs-interna.adhoc.inc',
      DOCS_ODOO_SCOPE: 'docs_interna',
    };
    const { manejarLogin } = await import(new URL('../lib/login-odoo.mjs', import.meta.url));

    const puerta = await manejarLogin(req('/api/auth/login?volver=%2F'), env);
    const cookie = puerta.headers.get('set-cookie');
    const robada = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));

    const r = await decidir(
      new Request('https://docs-interna.adhoc.inc/19/manual/x', {
        headers: { accept: 'text/html', cookie: `${COOKIE_SESION}=${robada}` },
      }),
      env,
      { audiencias: DOS },
    );
    assert.notEqual(r, null, 'el gate dejó pasar la cookie del intento');
    assert.equal(r.status, 302, 'y tiene que mandarla a loguearse');
  });
});
