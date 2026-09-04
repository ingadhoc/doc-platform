/**
 * El centinela de producción: ¿el sitio publicado está en el commit que dice
 * la rama? El CLI es `bin/centinela-produccion.mjs`
 * (`docs-centinela-produccion`); acá está la lógica, sin `process.exit` y con
 * la lectura del deployment inyectable, para poder testear la decisión sin
 * depender de Vercel.
 *
 * POR QUÉ EXISTE. El 04/09/2026 `docs.adhoc.inc` estuvo cinco horas atrás de
 * `main` con todo el CI en verde. Vercel había dejado el deploy en `BLOCKED`
 * —el autor del commit no tenía seat en el team—, un deployment bloqueado
 * nunca arranca, así que `vercel deploy` no volvió nunca, y como el job de
 * producción es un `concurrency` de a uno los once merges siguientes se
 * encolaron detrás y se cancelaron entre sí. Nadie se enteró hasta que alguien
 * preguntó por qué su PR no se veía publicado.
 *
 * Lo que faltaba no era un check más del build: era alguien que mirara el
 * resultado. **Un CI verde no significa publicado**, y hasta este check nada
 * en el repo sabía la diferencia.
 *
 * DOS COSAS MIRA, Y LAS DOS IMPORTAN
 *
 * 1. Que el deployment de producción sea el commit esperado. Con tolerancia,
 *    porque un deploy tarda unos minutos y un merge recién hecho todavía no
 *    está publicado sin que eso sea un problema.
 *
 * 2. Que el deployment NO traiga metas `githubCommit*`. Vercel las arma
 *    resolviendo el autor del commit contra GitHub, y ahí es donde aplica el
 *    bloqueo por seats. Si volvieron a aparecer, el próximo merge de alguien
 *    de afuera del team queda BLOCKED y la cola se traba otra vez. Se avisa
 *    ANTES de que pase, con producción todavía publicada.
 */

/** Cuánto puede tardar un deploy legítimo antes de que el atraso sea un problema. */
export const TOLERANCIA_MIN = 45;

/** 0 = al día; 1 = hay que actuar; 2 = no se pudo averiguar. */
export const OK = 0;
export const ATRASADA = 1;
export const NO_SE_PUDO = 2;

const API = 'https://api.vercel.com';

/**
 * El sha que Vercel dice para un deployment. `commitSha` es la meta que ponen
 * los workflows; `githubCommitSha` es la que Vercel arma sola cuando puede
 * resolver el commit — se lee para poder comparar igual contra un deployment
 * viejo, no porque se quiera.
 */
export const shaDe = (deployment) =>
  deployment?.meta?.commitSha || deployment?.meta?.githubCommitSha || null;

/** Las metas que Vercel arma resolviendo el commit contra GitHub. */
export const metasDeGitHub = (deployment) =>
  Object.keys(deployment?.meta || {}).filter((k) => k.startsWith('githubCommit'));

/**
 * La decisión, sin red y sin efectos.
 *
 * @param {object} entrada
 * @param {object|null} entrada.deployment  el último deployment de producción READY.
 * @param {string}      entrada.esperado    commit en el que debería estar.
 * @param {number}      entrada.edadMin     hace cuántos minutos existe ese commit.
 *                                          Con 0 no hay margen: es el chequeo de
 *                                          después de deployar, donde el deploy
 *                                          ya terminó y no hay nada que esperar.
 * @param {number}      entrada.toleranciaMin
 * @returns {{codigo: number, motivo: string, sha: string|null, inferidas: string[]}}
 */
export function evaluar({ deployment, esperado, edadMin = 0, toleranciaMin = TOLERANCIA_MIN }) {
  const sha = shaDe(deployment);
  const inferidas = metasDeGitHub(deployment);

  if (!deployment) {
    return { codigo: NO_SE_PUDO, motivo: 'Vercel no reporta ningún deployment de producción READY.', sha, inferidas };
  }
  if (!sha) {
    // Sin sha no hay comparación posible. Es "no se pudo averiguar", no "al
    // día": un estado raro tiene que quedar rojo, no pasar por bueno.
    return { codigo: NO_SE_PUDO, motivo: 'El deployment de producción no declara ningún commit.', sha, inferidas };
  }

  if (sha !== esperado) {
    const atraso = `producción está en ${sha.slice(0, 8)} y se esperaba ${esperado.slice(0, 8)}`;
    // `>=` y no `>`: con `--tolerancia=0` —el chequeo de después de deployar—
    // no hay nada que esperar, así que cualquier diferencia es un fallo. Con
    // `>` ese caso pasaba por bueno, que es justo el que verifica que el
    // dominio quedó en el commit que se acaba de publicar.
    return edadMin >= toleranciaMin
      ? { codigo: ATRASADA, motivo: `${atraso} — ese commit existe hace ${Math.round(edadMin)} min.`, sha, inferidas }
      : { codigo: OK, motivo: `${atraso}, pero hace ${Math.round(edadMin)} min: dentro de la tolerancia de ${toleranciaMin}.`, sha, inferidas };
  }

  if (inferidas.length) {
    // Publicado, pero el bloqueo por seats volvió a estar armado.
    return {
      codigo: ATRASADA,
      motivo:
        `producción sirve ${sha.slice(0, 8)}, pero el deployment volvió a traer metas de GitHub ` +
        `(${inferidas.join(', ')}; autor: ${deployment.meta.githubCommitAuthorName || 'sin nombre'}). ` +
        'Vercel volvió a resolver el autor del commit: el próximo merge de alguien sin seat en el team ' +
        'va a quedar BLOCKED y a trabar la cola de deploys. Revisar que el workflow siga pasando metas ' +
        'propias (`commitSha`) y borrando `.git` antes de deployar.',
      sha,
      inferidas,
    };
  }

  return { codigo: OK, motivo: `producción sirve ${sha.slice(0, 8)}.`, sha, inferidas };
}

/** El último deployment de producción READY del proyecto. */
async function leerDeploymentReal({ proyecto, team, token }) {
  const url = `${API}/v6/deployments?projectId=${proyecto}&teamId=${team}&target=production&state=READY&limit=1`;
  const respuesta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} ${respuesta.statusText}`);
  const { deployments } = await respuesta.json();
  return deployments?.[0] ?? null;
}

/**
 * Corre el centinela sobre un proyecto de Vercel.
 *
 * @param {object} opciones
 * @param {string} opciones.proyecto  projectId de Vercel.
 * @param {string} opciones.team      teamId de Vercel.
 * @param {string} opciones.token     token con lectura de deployments.
 * @param {string} opciones.esperado  commit en el que debería estar producción.
 * @param {number} opciones.edadMin   antigüedad de ese commit, en minutos.
 * @param {number} opciones.toleranciaMin
 * @param {Function} opciones.leerDeployment  inyectable para los tests.
 * @returns {Promise<number>} 0 al día, 1 hay que actuar, 2 no se pudo averiguar.
 */
export async function correrCentinela({
  proyecto,
  team,
  token,
  esperado,
  edadMin = 0,
  toleranciaMin = TOLERANCIA_MIN,
  etiqueta = 'producción',
  log = console.log,
  error = console.error,
  leerDeployment = leerDeploymentReal,
} = {}) {
  if (!proyecto || !team || !token) {
    error('✗ Faltan proyecto, team o token de Vercel.');
    return NO_SE_PUDO;
  }
  if (!esperado) {
    error('✗ Falta el commit esperado.');
    return NO_SE_PUDO;
  }

  let deployment;
  try {
    deployment = await leerDeployment({ proyecto, team, token });
  } catch (e) {
    // Vercel caído no es producción atrasada, y decirlo importa: el workflow
    // abre un issue con el 1 y no con el 2.
    error(`? ${etiqueta}: no se pudo consultar Vercel (${e.message}).`);
    return NO_SE_PUDO;
  }

  const { codigo, motivo } = evaluar({ deployment, esperado, edadMin, toleranciaMin });
  const marca = codigo === OK ? '✓' : codigo === ATRASADA ? '✗' : '?';
  (codigo === OK ? log : error)(`${marca} ${etiqueta}: ${motivo}`);
  return codigo;
}
