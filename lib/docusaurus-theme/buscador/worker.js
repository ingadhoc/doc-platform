/**
 * The search worker: downloads the index once, builds the same engine the MCP
 * runs (`crearMotor`) and answers the box with the reader's profile.
 */

import { crearMotor } from '../../mcp/motor.mjs';
import { respuestaDelBuscador } from './respuesta.mjs';

const motores = new Map();

function motorDe(url) {
  if (!motores.has(url)) {
    const promesa = fetch(url, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.json();
      })
      .then((crudo) => crearMotor(crudo));
    // a failed download can be retried on the next search
    promesa.catch(() => motores.delete(url));
    motores.set(url, promesa);
  }
  return motores.get(url);
}

async function buscar(url, args) {
  return respuestaDelBuscador(await motorDe(url), args);
}

self.onmessage = async ({ data: { id, tipo, url, args } }) => {
  try {
    const resultado = tipo === 'cargar' ? (await motorDe(url), true) : await buscar(url, args);
    self.postMessage({ id, resultado });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
