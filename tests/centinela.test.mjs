/**
 * Suite del centinela de producción. `node --test tests/centinela.test.mjs`
 *
 * Sin red: `leerDeployment` entra inyectado. Lo que se prueba es la DECISIÓN,
 * que es lo único propio de este check: si "producción cinco horas atrás de
 * main" no se distingue de "deploy en curso", el centinela o no avisa nunca o
 * avisa siempre — y las dos formas de fallar terminan igual, con alguien
 * ignorando el aviso el día que importa.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATRASADA,
  NO_SE_PUDO,
  OK,
  correrCentinela,
  evaluar,
  metasDeGitHub,
  shaDe,
} from '../lib/centinela-produccion.mjs';

const SHA = 'de08db0cb3644616dac688cb7ccc326222980f93';
const VIEJO = '3038176d6cc370f7ee14cd8f5854fe849b4b5137';

const deployment = (meta) => ({ url: 'sitio-abc.vercel.app', meta });
const limpio = (sha) => deployment({ commitSha: sha, commitRef: 'main' });

// La forma exacta que tenía el deployment BLOCKED del 04/09: Vercel resolvió
// el autor del commit y lo bloqueó por no tener seat.
const conMetasDeGitHub = (sha) =>
  deployment({
    commitSha: sha,
    githubCommitSha: sha,
    githubCommitAuthorName: 'quien no tiene seat',
    githubCommitRepo: 'oba-docs',
  });

describe('de dónde sale el commit publicado', () => {
  it('prefiere la meta propia', () => {
    assert.equal(shaDe(deployment({ commitSha: SHA, githubCommitSha: VIEJO })), SHA);
  });

  it('cae a la meta vieja para poder comparar contra un deployment anterior al cambio', () => {
    assert.equal(shaDe(deployment({ githubCommitSha: VIEJO })), VIEJO);
  });

  it('sin metas, no hay sha', () => {
    assert.equal(shaDe(deployment({})), null);
    assert.equal(shaDe(null), null);
  });

  it('lista las metas que Vercel armó resolviendo el commit', () => {
    assert.deepEqual(metasDeGitHub(conMetasDeGitHub(SHA)).sort(), [
      'githubCommitAuthorName',
      'githubCommitRepo',
      'githubCommitSha',
    ]);
    assert.deepEqual(metasDeGitHub(limpio(SHA)), []);
  });
});

describe('la decisión', () => {
  it('al día', () => {
    const { codigo } = evaluar({ deployment: limpio(SHA), esperado: SHA });
    assert.equal(codigo, OK);
  });

  it('atrasada: el commit lleva más que la tolerancia sin publicarse', () => {
    const { codigo, motivo } = evaluar({
      deployment: limpio(VIEJO),
      esperado: SHA,
      edadMin: 332, // el atraso real del 04/09
      toleranciaMin: 45,
    });
    assert.equal(codigo, ATRASADA);
    assert.match(motivo, /332 min/);
  });

  it('no alarma cuando el deploy todavía puede estar en curso', () => {
    const { codigo } = evaluar({
      deployment: limpio(VIEJO),
      esperado: SHA,
      edadMin: 3,
      toleranciaMin: 45,
    });
    assert.equal(codigo, OK);
  });

  it('después de deployar no hay tolerancia: o quedó en ese commit o no', () => {
    const { codigo } = evaluar({
      deployment: limpio(VIEJO),
      esperado: SHA,
      edadMin: 0,
      toleranciaMin: 0,
    });
    assert.equal(codigo, ATRASADA);
  });

  it('publicada, pero con el bloqueo por seats rearmado', () => {
    const { codigo, motivo } = evaluar({ deployment: conMetasDeGitHub(SHA), esperado: SHA });
    assert.equal(codigo, ATRASADA);
    assert.match(motivo, /githubCommitAuthorName/);
    assert.match(motivo, /BLOCKED/);
  });

  it('sin deployment de producción no se puede comparar, y eso no es estar al día', () => {
    assert.equal(evaluar({ deployment: null, esperado: SHA }).codigo, NO_SE_PUDO);
  });

  it('un deployment sin commit tampoco pasa por bueno', () => {
    assert.equal(evaluar({ deployment: deployment({}), esperado: SHA }).codigo, NO_SE_PUDO);
  });
});

describe('la corrida', () => {
  const silencio = { log: () => {}, error: () => {} };
  const credenciales = { proyecto: 'prj_x', team: 'team_x', token: 't' };

  it('devuelve 0 cuando producción está en el commit esperado', async () => {
    const codigo = await correrCentinela({
      ...credenciales,
      ...silencio,
      esperado: SHA,
      leerDeployment: async () => limpio(SHA),
    });
    assert.equal(codigo, OK);
  });

  it('devuelve 1 cuando está atrasada', async () => {
    const codigo = await correrCentinela({
      ...credenciales,
      ...silencio,
      esperado: SHA,
      edadMin: 300,
      leerDeployment: async () => limpio(VIEJO),
    });
    assert.equal(codigo, ATRASADA);
  });

  it('Vercel caído es 2 y no 1: un 500 no puede abrir un issue de producción atrasada', async () => {
    const codigo = await correrCentinela({
      ...credenciales,
      ...silencio,
      esperado: SHA,
      leerDeployment: async () => {
        throw new Error('HTTP 500 Internal Server Error');
      },
    });
    assert.equal(codigo, NO_SE_PUDO);
  });

  it('sin credenciales no finge que midió', async () => {
    assert.equal(await correrCentinela({ ...silencio, esperado: SHA }), NO_SE_PUDO);
  });

  it('sin commit esperado tampoco', async () => {
    assert.equal(
      await correrCentinela({ ...credenciales, ...silencio, leerDeployment: async () => limpio(SHA) }),
      NO_SE_PUDO,
    );
  });
});
