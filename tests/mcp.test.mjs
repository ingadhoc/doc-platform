/**
 * Tests del NÚCLEO unificado del MCP de documentación. `node --test`.
 *
 * Adaptado de `tests/mcp.test.mjs` de adhoc-docs (la convención que está
 * adelante, según la spec de arquitectura). Dos diferencias con el original:
 *
 *   1. El original probaba el núcleo Y el motor de búsqueda del repo contra un
 *      `index.json` de fixture. Acá el motor NO está en el alcance
 *      (`indice.mjs` se unifica aparte y tiene sus propios tests): el índice
 *      entra inyectado (`fixtures/indice-fake.mjs`) y lo que se prueba es el
 *      cableado — el eje que llega con el nombre correcto, el gate, el Bearer,
 *      el transporte, el payload de feedback.
 *   2. Todo caso corre para los TRES dialectos medidos (`fixtures/configs.mjs`).
 *      Un test que solo pasa con una config no prueba que el núcleo unifique.
 *
 * Cero red: el `fetch` de feedback se stubea.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { consumidorDe, igual, parsearTokens } from '../lib/mcp/auth.mjs';
import { crearFeedback } from '../lib/mcp/feedback.mjs';
import { crearGate } from '../lib/mcp/gate.mjs';
import { paresDeTokens } from '../lib/mcp/tokens.mjs';
import { CONFIG_ADHOC, CONFIG_OBA, CONFIG_ODUMBO } from './fixtures/configs.mjs';
import { crearIndiceFake } from './fixtures/indice-fake.mjs';

const TOKENS = 'tuqui:tok-tuqui,claude-code:tok-claude';

// ───────────────────────────────────────────────────────── tokens y auth

describe('tokens', () => {
  it('parsea la gramática de DOCS_MCP_TOKENS y tolera basura', async () => {
    assert.deepEqual(paresDeTokens(' tuqui:tok1 , claude-code:tok2 ,, sin-token: , :sin-nombre'), [
      { nombre: 'tuqui', token: 'tok1' },
      { nombre: 'claude-code', token: 'tok2' },
    ]);
    assert.deepEqual(paresDeTokens(''), []);
    assert.deepEqual(paresDeTokens(undefined), []);
  });

  it('duplicados: los devuelve todos, en orden (la semántica es del comparador)', async () => {
    assert.deepEqual(paresDeTokens('a:t1,a:t2'), [
      { nombre: 'a', token: 't1' },
      { nombre: 'a', token: 't2' },
    ]);
  });

  it('resuelve el consumidor dueño del token', async () => {
    const tokens = parsearTokens(TOKENS);
    assert.equal(consumidorDe(tokens, 'tok-claude'), 'claude-code');
    assert.equal(consumidorDe(tokens, 'tok-inventado'), null);
    assert.equal(consumidorDe(tokens, ''), null);
    assert.equal(igual('a', 'aa'), false);
    assert.equal(igual('abc', 'abc'), true);
  });
});

// ────────────────────────────────────────────────────────────────── gate

/**
 * El gate tiene además el test del dueño de `middleware.js`
 * (`scripts/test-middleware.mjs`). Lo que se verifica acá es el contrato que
 * el MCP necesita del gate, más el fix de fail-closed sobre `DOCS_AUDIENCE`,
 * que es la diferencia medida entre los tres repos.
 */
describe('gate', () => {
  const req = (url, init) => new Request(url, init);
  const ENV = { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui', DOCS_SESION_SECRET: 'secreto-de-firma' };

  const dosAudiencias = crearGate({ audiencias: ['publico', 'interno'] }); // oba / odumbo
  const soloInterno = crearGate({ audiencias: ['interno'] }); // adhoc-docs

  for (const [nombre, decidir] of [
    ['dos audiencias', dosAudiencias],
    ['una audiencia interna', soloInterno],
  ]) {
    describe(nombre, () => {
      it('POST al MCP con Bearer válido pasa', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'POST', headers: { authorization: 'Bearer tok-tuqui' } }), ENV);
        assert.equal(r, null);
      });

      it('POST al MCP sin token es 401 con challenge Bearer (nunca Basic)', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'POST' }), ENV);
        assert.equal(r.status, 401);
        assert.equal(r.headers.get('WWW-Authenticate'), 'Bearer error="invalid_token"');
      });

      it('POST al MCP con token inválido es 401', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'POST', headers: { authorization: 'Bearer nope' } }), ENV);
        assert.equal(r.status, 401);
      });

      it('GET al MCP devuelve el cartel, no un 401 fatal, y sin challenge', async () => {
        const r = await decidir(req('https://d/api/mcp'), ENV);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('WWW-Authenticate'), null);
        assert.match(await r.text(), /configurá tu token/);
      });

      it('HEAD al MCP no trae cuerpo', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'HEAD' }), ENV);
        assert.equal(r.status, 200);
        assert.equal(r.body, null);
      });

      it('MCP sin DOCS_MCP_TOKENS: no atiende a nadie (fail-closed)', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'POST' }), {
          DOCS_AUDIENCE: 'interno',
          DOCS_SESION_SECRET: 'secreto-de-firma',
        });
        assert.equal(r.status, 503);
      });

      it('sin DOCS_SESION_SECRET el sitio no sirve, pero el MCP con Bearer sigue andando', async () => {
        const env = { DOCS_AUDIENCE: 'interno', DOCS_MCP_TOKENS: 'tuqui:tok-tuqui' };
        assert.equal((await decidir(req('https://d/x/'), env)).status, 503);
        assert.equal(
          await decidir(req('https://d/api/mcp', { method: 'POST', headers: { authorization: 'Bearer tok-tuqui' } }), env),
          null,
        );
        // Y los estáticos del agente también: que el login de humanos esté sin
        // configurar —o Odoo caído— no puede tirar a las máquinas.
        assert.equal(await decidir(req('https://d/agente/index.json', { headers: { authorization: 'Bearer tok-tuqui' } }), env), null);
      });

      it('el sitio manda a los humanos al login y acepta Bearer a las máquinas', async () => {
        const r = await decidir(req('https://d/x/'), ENV);
        assert.equal(r.status, 401);
        assert.equal(r.headers.get('WWW-Authenticate'), null, 'nunca un challenge Basic');
        assert.equal(await decidir(req('https://d/x/', { headers: { authorization: 'Bearer tok-tuqui' } }), ENV), null);
        // La credencial compartida se fue con la v0.6.0: no abre ni con el
        // usuario y la clave que valían ayer.
        const basic = 'Basic ' + Buffer.from('adhoc:clave').toString('base64');
        assert.equal((await decidir(req('https://d/x/', { headers: { authorization: basic } }), ENV)).status, 401);
      });

      it('un Authorization raro no explota: 401', async () => {
        // Ya no se parsea nada del header en el camino humano, pero el gate
        // igual tiene que contestar y no tirar.
        for (const raro of ['Basic ' + Buffer.from('adhocsindospuntos').toString('base64'), 'Basic ###', 'Bananas']) {
          assert.equal((await decidir(req('https://d/x/', { headers: { authorization: raro } }), ENV)).status, 401);
        }
      });

      it('tokens duplicados: los dos valen', async () => {
        const env = { ...ENV, DOCS_MCP_TOKENS: 'a:t1,a:t2' };
        for (const t of ['t1', 't2']) {
          assert.equal(await decidir(req('https://d/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${t}` } }), env), null);
        }
      });

      // ── EL FIX: fail-closed sobre la variable, no solo sobre su valor.
      // Estaba en odumbo-docs y (en su variante de una audiencia) en
      // adhoc-docs; oba-docs devolvía "pasa" en los tres casos.
      it('sin DOCS_AUDIENCE: 503, no se asume público', async () => {
        const r = await decidir(req('https://d/x/'), { DOCS_SESION_SECRET: 's', DOCS_MCP_TOKENS: 'a:t' });
        assert.equal(r.status, 503);
        assert.match(r.headers.get('X-Robots-Tag'), /noindex/);
      });

      it('sin DOCS_AUDIENCE: el MCP con Bearer válido tampoco pasa', async () => {
        const r = await decidir(req('https://d/api/mcp', { method: 'POST', headers: { authorization: 'Bearer tok-tuqui' } }), {
          DOCS_MCP_TOKENS: 'tuqui:tok-tuqui',
        });
        assert.equal(r.status, 503);
      });

      it('DOCS_AUDIENCE con un valor desconocido: 503', async () => {
        const r = await decidir(req('https://d/x/'), { ...ENV, DOCS_AUDIENCE: 'publicoo' });
        assert.equal(r.status, 503);
      });
    });
  }

  it('con audiencia pública declarada, el sitio y el MCP pasan de largo', async () => {
    const env = { DOCS_AUDIENCE: 'publico' };
    assert.equal(await dosAudiencias(req('https://d/19/manual/x'), env), null);
    assert.equal(await dosAudiencias(req('https://d/api/mcp', { method: 'POST' }), env), null);
  });

  it('un repo de una sola audiencia interna NO tiene apagado: `publico` corta en 503', async () => {
    // adhoc-docs no tiene guard de fuga: el día que alguien ponga `publico`,
    // mejor 503 que una fuga silenciosa.
    for (const audiencia of ['publico', undefined]) {
      const r = await soloInterno(req('https://d/api/mcp', { method: 'POST', headers: { authorization: 'Bearer tok-tuqui' } }), {
        ...ENV,
        DOCS_AUDIENCE: audiencia,
      });
      assert.equal(r.status, 503, `DOCS_AUDIENCE=${audiencia}`);
    }
  });

  it('el mensaje del 503 distingue "falta" de "no servible"', async () => {
    const falta = await (await soloInterno(new Request('https://d/x/'), {})).text();
    assert.match(falta, /falta DOCS_AUDIENCE/);
    const rara = await (await soloInterno(new Request('https://d/x/'), { DOCS_AUDIENCE: 'publico' })).text();
    assert.match(rara, /no es una audiencia servible \(esperaba interno\)/);
  });

  it('el cartel del MCP sale de la config, compartido con el handler', async () => {
    const gate = crearGate({ audiencias: ['interno'], cartelMcp: { interno: 'CARTEL PROPIO\n' } });
    const r = await gate(new Request('https://d/api/mcp'), ENV);
    assert.equal(await r.text(), 'CARTEL PROPIO\n');
  });

  it('la ruta del MCP es configurable y solo esa ruta es MCP', async () => {
    const gate = crearGate({ audiencias: ['interno'], rutaMcp: '/api/otro' });
    // `/api/mcp` deja de ser MCP: cae al camino humano.
    assert.equal((await gate(new Request('https://d/api/mcp'), ENV)).status, 401);
    assert.equal((await gate(new Request('https://d/api/otro'), ENV)).status, 200);
  });

  it('el gate ya no sabe qué es un usuario y una contraseña', async () => {
    // La v0.6.0 sacó el camino Basic entero: `DOCS_AUTH_USER` y
    // `DOCS_AUTH_PASSWORD` no las lee nadie, y setearlas no cambia nada.
    const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    const env = { ...ENV, DOCS_AUTH_USER: 'otro', DOCS_AUTH_PASSWORD: 'clave' };
    for (const cred of [basic('adhoc', 'clave'), basic('otro', 'clave')]) {
      const r = await soloInterno(new Request('https://d/x/', { headers: { authorization: cred } }), env);
      assert.equal(r.status, 401);
    }
  });
});

// ────────────────────────────────────────────────────────────── feedback

describe('feedback', () => {
  function conFetch(respuesta) {
    const capturado = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      capturado.push({ url, init, body: JSON.parse(init.body) });
      return respuesta();
    };
    return { capturado, restaurar: () => (globalThis.fetch = original) };
  }

  const okGitHub = () => new Response(JSON.stringify({ number: 7, html_url: 'https://gh/7' }), { status: 201 });

  // OJO: `await fn()` DENTRO del try. Con `return fn()` el `finally` corre
  // antes de que el cuerpo async termine y el segundo `crearIssue` de un
  // mismo caso ve el entorno ya restaurado (falso 'no-configurado').
  async function conEnv(fn) {
    const antes = { repo: process.env.GITHUB_REPO, tok: process.env.DOCS_FEEDBACK_GITHUB_TOKEN };
    process.env.GITHUB_REPO = 'ingadhoc/x-docs';
    process.env.DOCS_FEEDBACK_GITHUB_TOKEN = 'ghp_x';
    try {
      return await fn();
    } finally {
      if (antes.repo === undefined) delete process.env.GITHUB_REPO;
      else process.env.GITHUB_REPO = antes.repo;
      if (antes.tok === undefined) delete process.env.DOCS_FEEDBACK_GITHUB_TOKEN;
      else process.env.DOCS_FEEDBACK_GITHUB_TOKEN = antes.tok;
    }
  }

  it('sin GITHUB_REPO ni token la tool RESPONDE, no rompe', async () => {
    const antes = process.env.GITHUB_REPO;
    delete process.env.GITHUB_REPO;
    const r = await crearFeedback(CONFIG_OBA.feedback)({ slug: 'x', problema: 'y', buildId: 'b' });
    if (antes !== undefined) process.env.GITHUB_REPO = antes;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'no-configurado');
    assert.match(r.mensaje, /seguí respondiendo normalmente/);
  });

  it('eje versión: el issue lleva la línea del eje y NO prefija el título', async () => {
    await conEnv(async () => {
      const { capturado, restaurar } = conFetch(okGitHub);
      const r = await crearFeedback(CONFIG_OBA.feedback)({
        slug: 'manual/facturas',
        problema: 'Falta el paso 3',
        eje: '19',
        clientId: 'tuqui',
        buildId: 'b1',
      });
      restaurar();
      assert.deepEqual(r, { ok: true, numero: 7, url: 'https://gh/7', label: 'docs-feedback' });
      const { body } = capturado[0];
      assert.equal(body.title, '[docs-feedback] manual/facturas');
      assert.match(body.body, /\*\*Versión\*\*: 19/);
      assert.match(body.body, /\*\*Consumidor\*\*: tuqui/);
      assert.match(body.body, /\*\*Build del índice\*\*: b1/);
      assert.deepEqual(body.labels, ['docs-feedback']);
      assert.equal(capturado[0].url, 'https://api.github.com/repos/ingadhoc/x-docs/issues');
    });
  });

  it('eje project: prefija el título (el eje decide a qué repo se rutea) y suma la nota', async () => {
    await conEnv(async () => {
      const { capturado, restaurar } = conFetch(okGitHub);
      await crearFeedback(CONFIG_ADHOC.feedback)({ slug: 'index', problema: 'p', eje: 'oba', buildId: 'b' });
      restaurar();
      const { body } = capturado[0];
      assert.equal(body.title, '[docs-feedback] oba: index');
      assert.match(body.body, /\*\*Project\*\*: oba/);
      assert.match(body.body, /el arreglo va en el repo del project/);
    });
  });

  it('sin valor de eje lo dice, no lo inventa', async () => {
    await conEnv(async () => {
      const { capturado, restaurar } = conFetch(okGitHub);
      await crearFeedback(CONFIG_ADHOC.feedback)({ slug: 'index', problema: 'p', buildId: 'b' });
      restaurar();
      assert.equal(capturado[0].body.title, '[docs-feedback] index');
      assert.match(capturado[0].body.body, /\*\*Project\*\*: \(no declarado\)/);
      assert.match(capturado[0].body.body, /\*\*Consumidor\*\*: \(anónimo\)/);
    });
  });

  it('corpus sin eje: el issue no menciona ningún eje', async () => {
    await conEnv(async () => {
      const { capturado, restaurar } = conFetch(okGitHub);
      await crearFeedback({ eje: { tipo: 'none' } })({ slug: 'x', problema: 'p', buildId: 'b' });
      restaurar();
      const lineas = capturado[0].body.body.split('\n');
      assert.equal(lineas[1], '**Consumidor**: (anónimo)');
    });
  });

  it('GitHub que rechaza y red caída se reportan, no tiran', async () => {
    await conEnv(async () => {
      let { restaurar } = conFetch(() => new Response('sin permisos', { status: 403 }));
      const r403 = await crearFeedback(CONFIG_OBA.feedback)({ slug: 'x', problema: 'p', buildId: 'b' });
      restaurar();
      assert.equal(r403.ok, false);
      assert.equal(r403.motivo, 'http-403');
      assert.match(r403.mensaje, /sin permisos/);

      const original = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('ECONNRESET');
      };
      const rRed = await crearFeedback(CONFIG_OBA.feedback)({ slug: 'x', problema: 'p', buildId: 'b' });
      globalThis.fetch = original;
      assert.equal(rRed.motivo, 'red');
      assert.match(rRed.mensaje, /ECONNRESET/);
    });
  });
});

// ──────────────────────────────────────────────────── handler HTTP del MCP

/**
 * `mcp-handler` y `zod` son dependencias del repo consumidor. Si el checkout
 * no las tiene instaladas, esta franja se SKIPEA explícitamente en vez de
 * correr degradada: un test verde que no probó el transporte es peor que uno
 * ausente.
 */
let crearMcp = null;
try {
  ({ crearMcp } = await import('../lib/mcp/mcp-handler.mjs'));
} catch (error) {
  console.error(`[test] handler HTTP no testeable: ${error.message}`);
}

describe('handler HTTP', { skip: crearMcp ? false : 'faltan mcp-handler / zod' }, () => {
  // `audiencia`/`tokens` en null = "la variable NO está seteada". No se usa
  // `undefined`: el default del destructuring lo pisaría con el valor normal.
  function montar(config, { audiencia = 'interno', tokens = TOKENS, indice } = {}) {
    const antes = { a: process.env.DOCS_AUDIENCE, t: process.env.DOCS_MCP_TOKENS };
    if (!audiencia) delete process.env.DOCS_AUDIENCE;
    else process.env.DOCS_AUDIENCE = audiencia;
    if (!tokens) delete process.env.DOCS_MCP_TOKENS;
    else process.env.DOCS_MCP_TOKENS = tokens;
    const fake = indice ?? crearIndiceFake({ tipo: config.eje?.tipo ?? 'version' });
    const mcp = crearMcp({
      config,
      indice: fake,
      crearIssue: config.feedback ? crearFeedback(config.feedback) : null,
    });
    if (antes.a === undefined) delete process.env.DOCS_AUDIENCE;
    else process.env.DOCS_AUDIENCE = antes.a;
    if (antes.t === undefined) delete process.env.DOCS_MCP_TOKENS;
    else process.env.DOCS_MCP_TOKENS = antes.t;
    return { ...mcp, fake };
  }

  const rpc = (metodo, params, token) =>
    new Request('https://d/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }),
    });

  const props = (tools, nombre) => Object.keys(tools.find((t) => t.name === nombre).inputSchema.properties).sort();

  it('oba (eje version, audiencia interna): cuatro tools y el filtro se llama `version`', async () => {
    const { handler } = montar(CONFIG_OBA);
    const r = await handler(rpc('tools/list', {}, 'tok-tuqui'));
    assert.equal(r.status, 200);
    const { result } = await leerRpc(r);
    assert.deepEqual(result.tools.map((t) => t.name).sort(), ['buscar', 'feedback', 'leer', 'mapa']);
    assert.deepEqual(props(result.tools, 'buscar'), ['modules', 'page', 'q', 'seccion', 'version']);
    assert.deepEqual(props(result.tools, 'leer'), ['page', 'slug', 'version']);
    assert.deepEqual(props(result.tools, 'feedback'), ['problema', 'slug', 'version']);
    // La prosa del or-fallback solo sale si el corpus la tiene.
    assert.match(result.tools.find((t) => t.name === 'buscar').description, /or-fallback/);
    assert.match(result.tools.find((t) => t.name === 'buscar').description, /CROSS-VERSION/);
  });

  it('adhoc (eje project): el filtro se llama `project`, no hay `modules`', async () => {
    const { handler } = montar(CONFIG_ADHOC);
    const { result } = await leerRpc(await handler(rpc('tools/list', {}, 'tok-tuqui')));
    assert.deepEqual(props(result.tools, 'buscar'), ['page', 'project', 'q', 'seccion']);
    assert.deepEqual(props(result.tools, 'leer'), ['page', 'project', 'slug']);
    const buscar = result.tools.find((t) => t.name === 'buscar');
    // El motor ahora es UNO: la prosa del or-fallback (la mejor descripción de
    // tool de los tres, que sólo tenía oba) vale para los tres corpus. Era
    // `capacidades.orFallback` en la config y dejó de ser un flag por repo.
    assert.match(buscar.description, /or-fallback/);
    // Lo que sí sigue apagado con eje `project`: el comodín / cross-eje, que
    // es una propiedad del eje versión.
    assert.doesNotMatch(buscar.description, /CROSS/);
    assert.match(buscar.description, /`project` manda/);
    assert.match(result.tools.find((t) => t.name === 'leer').description, /tampoco elige por su cuenta/);
    assert.equal(result.tools.find((t) => t.name === 'mapa').title, 'Mapa de la documentación interna');
  });

  it('odumbo (corpus sin eje): el parámetro del eje NO se expone, ni el filtro sin contenido', async () => {
    const { handler } = montar(CONFIG_ODUMBO);
    const { result } = await leerRpc(await handler(rpc('tools/list', {}, 'tok-tuqui')));
    // Y sin `modules`: cero archivos de ese corpus lo declaran. Ofrecer un
    // filtro que devolvería siempre cero es el bug que su propio comentario
    // condenaba para el eje.
    assert.deepEqual(props(result.tools, 'buscar'), ['page', 'q', 'seccion']);
    assert.deepEqual(props(result.tools, 'leer'), ['page', 'slug']);
    assert.doesNotMatch(result.tools.find((t) => t.name === 'mapa').description, /valores de/);
  });

  it('la faceta `paises` la enciende el ÍNDICE, no el config del repo', async () => {
    // Mismo criterio que el eje: el config declara prosa, el índice declara qué
    // hay. Un repo que todavía no taguea países no puede quedar ofreciendo un
    // filtro que devolvería siempre lo mismo. Y al revés: cuando el build
    // empieza a emitir `metadata.paises`, la tool lo ofrece sin tocar el config.
    const base = crearIndiceFake({ tipo: 'version' });
    const conPaises = { ...base, mapa: () => ({ ...base.mapa(), metadata: { modules: true, paises: ['AR', 'CL', 'UY'] } }) };

    const sin = montar(CONFIG_OBA);
    const { result: r1 } = await leerRpc(await sin.handler(rpc('tools/list', {}, 'tok-tuqui')));
    assert.equal(props(r1.tools, 'buscar').includes('paises'), false);

    const con = montar(CONFIG_OBA, { indice: conPaises });
    const { result: r2 } = await leerRpc(await con.handler(rpc('tools/list', {}, 'tok-tuqui')));
    assert.deepEqual(props(r2.tools, 'buscar'), ['modules', 'page', 'paises', 'q', 'seccion', 'version']);
    // Las tres cosas que el LLM no puede deducir del nombre del parámetro:
    // que es duro, que EXCLUYE, y que la ausencia significa "todos".
    const desc = r2.tools.find((t) => t.name === 'buscar').description;
    assert.match(desc, /El filtro es duro y excluye/);
    assert.match(desc, /Un artículo sin país aplica a todos y se devuelve siempre/);
    // El país NO es un eje: no aparece en `leer()` ni en `feedback()`, que son
    // las tools cuyo parámetro identifica UN artículo.
    assert.deepEqual(props(r2.tools, 'leer'), ['page', 'slug', 'version']);
  });

  it('el eje declarado se APAGA si el índice dice que el corpus no lo tiene', async () => {
    // La config dice QUÉ eje; el índice dice SI hay, y su palabra manda: un
    // build emitido con `eje.tipo: "none"` no puede dejar la tool ofreciendo
    // un filtro contra una pared.
    const { handler } = montar(CONFIG_OBA, { indice: crearIndiceFake({ tipo: 'none' }) });
    const { result } = await leerRpc(await handler(rpc('tools/list', {}, 'tok-tuqui')));
    assert.equal(props(result.tools, 'buscar').includes('version'), false);
  });

  it('audiencia pública: sin auth, y SIN la tool feedback', async () => {
    const { handler } = montar(CONFIG_OBA, { audiencia: 'publico', tokens: null });
    const r = await handler(rpc('tools/list', {}));
    assert.equal(r.status, 200);
    const { result } = await leerRpc(r);
    assert.deepEqual(result.tools.map((t) => t.name).sort(), ['buscar', 'leer', 'mapa']);
  });

  it('audiencia con gate: POST sin token y con token falso son 401 con challenge Bearer', async () => {
    const { handler } = montar(CONFIG_OBA);
    for (const token of [undefined, 'tok-falso']) {
      const r = await handler(rpc('tools/list', {}, token));
      assert.equal(r.status, 401, `token=${token}`);
      assert.equal(r.headers.get('WWW-Authenticate'), 'Bearer error="invalid_token"');
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
  });

  it('audiencia con gate y sin DOCS_MCP_TOKENS: no se sirve NADA (fail-closed)', async () => {
    const { handler } = montar(CONFIG_ADHOC, { tokens: null });
    const r = await handler(rpc('tools/list', {}, 'cualquiera'));
    assert.equal(r.status, 401);
    assert.match(await r.text(), /mcp-mal-configurado/);
  });

  // Fail-closed en la capa función, no solo en el edge: si el matcher del
  // middleware deja de cubrir /api/mcp, esta es la última red.
  it('sin DOCS_AUDIENCE la función no sirve NADA, ni siquiera el cartel del GET', async () => {
    const { handler } = montar(CONFIG_OBA, { audiencia: null });
    for (const request of [rpc('tools/list', {}, 'tok-tuqui'), new Request('https://d/api/mcp')]) {
      const r = await handler(request);
      assert.equal(r.status, 503);
      assert.match(await r.text(), /falta DOCS_AUDIENCE/);
    }
  });

  it('una audiencia que el repo no declara tampoco se sirve', async () => {
    const { handler } = montar(CONFIG_ADHOC, { audiencia: 'publico' });
    const r = await handler(rpc('tools/list', {}, 'tok-tuqui'));
    assert.equal(r.status, 503);
    assert.match(await r.text(), /no es una audiencia servible \(esperaba interno\)/);
  });

  it('GET responde el cartel de SU audiencia, sin datos del índice', async () => {
    const interno = montar(CONFIG_OBA);
    const cartelInterno = await (await interno.handler(new Request('https://d/api/mcp'))).text();
    assert.match(cartelInterno, /configurá tu token/);

    const publico = montar(CONFIG_OBA, { audiencia: 'publico', tokens: null });
    const cartelPublico = await (await publico.handler(new Request('https://d/api/mcp'))).text();
    assert.match(cartelPublico, /NO requiere autenticación/);
    assert.doesNotMatch(cartelPublico, /configurá tu token/);
    for (const cuerpo of [cartelInterno, cartelPublico]) assert.match(cuerpo, /Streamable HTTP/);
  });

  it('HEAD responde 200 sin cuerpo', async () => {
    const { handler } = montar(CONFIG_OBA);
    const r = await handler(new Request('https://d/api/mcp', { method: 'HEAD' }));
    assert.equal(r.status, 200);
    assert.equal(r.body, null);
  });

  it('tools/call buscar pasa el eje con SU nombre al índice y devuelve el payload', async () => {
    const { handler, fake } = montar(CONFIG_ADHOC);
    const r = await handler(rpc('tools/call', { name: 'buscar', arguments: { q: 'entorno', project: 'a' } }, 'tok-tuqui'));
    assert.equal(r.status, 200);
    const { result } = await leerRpc(r);
    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(payload.filtros.project, ['a']);
    assert.deepEqual(
      fake.llamadas.filter((l) => l[0] === 'buscar').at(-1)[1].project,
      'a',
    );
  });

  it('tools/call leer devuelve el markdown del artículo', async () => {
    const { handler } = montar(CONFIG_OBA);
    const { result } = await leerRpc(
      await handler(rpc('tools/call', { name: 'leer', arguments: { slug: 'index', version: 'b' } }, 'tok-tuqui')),
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.encontrado, true);
    assert.match(payload.body, /produccion/);
  });

  it('tools/call feedback manda el eje al issue y devuelve el buildId', async () => {
    const original = globalThis.fetch;
    const vistos = [];
    globalThis.fetch = async (url, init) => {
      vistos.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ number: 3, html_url: 'https://gh/3' }), { status: 201 });
    };
    process.env.GITHUB_REPO = 'ingadhoc/x-docs';
    process.env.DOCS_FEEDBACK_GITHUB_TOKEN = 'ghp_x';
    try {
      const { handler } = montar(CONFIG_ADHOC);
      const { result } = await leerRpc(
        await handler(
          rpc('tools/call', { name: 'feedback', arguments: { slug: 'index', problema: 'falta X', project: 'oba' } }, 'tok-tuqui'),
        ),
      );
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.ok, true);
      assert.equal(payload.numero, 3);
      assert.equal(payload.buildId, '2026-08-20T00:00:00.000Z');
      assert.equal(vistos[0].title, '[docs-feedback] oba: index');
      // El clientId es la única trazabilidad que hay: tiene que llegar.
      assert.match(vistos[0].body, /\*\*Consumidor\*\*: tuqui/);
    } finally {
      globalThis.fetch = original;
      delete process.env.GITHUB_REPO;
      delete process.env.DOCS_FEEDBACK_GITHUB_TOKEN;
    }
  });

  it('índice roto: las tools lo dicen y no inventan (la función no queda muerta)', async () => {
    const { handler } = montar(CONFIG_OBA, {
      indice: (() => {
        const f = crearIndiceFake({ tirar: new Error('ENOENT index.json') });
        return f;
      })(),
    });
    const { result } = await leerRpc(await handler(rpc('tools/call', { name: 'mapa', arguments: {} }, 'tok-tuqui')));
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error, 'indice-no-disponible');
    assert.match(payload.mensaje, /no inventes la respuesta/);
    assert.match(payload.detalle, /ENOENT/);
  });

  it('las instructions del server son las del corpus', async () => {
    const { handler } = montar(CONFIG_ADHOC);
    const { result } = await leerRpc(
      await handler(
        rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }, 'tok-tuqui'),
      ),
    );
    assert.equal(result.serverInfo.name, 'adhoc-docs');
    assert.match(result.instructions, /el project es el eje que discrimina/);
  });
});

/**
 * El transporte Streamable HTTP contesta SSE o JSON según lo que negocie.
 * Esto acepta las dos formas: el test es sobre el MCP, no sobre el framing.
 */
async function leerRpc(respuesta) {
  const cuerpo = await respuesta.text();
  const tipo = respuesta.headers.get('content-type') || '';
  if (!tipo.includes('text/event-stream')) return JSON.parse(cuerpo);
  const linea = cuerpo.split('\n').find((l) => l.startsWith('data:'));
  assert.ok(linea, `no vino ningún evento SSE: ${cuerpo}`);
  return JSON.parse(linea.slice(5).trim());
}
