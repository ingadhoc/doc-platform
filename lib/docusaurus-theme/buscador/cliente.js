/**
 * The main-thread side of the search worker: one worker per tab, created on
 * first use, with request/response pairs matched by id.
 */

let worker = null;
let siguiente = 0;
const pendientes = new Map();

function elWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, resultado, error } }) => {
      const pendiente = pendientes.get(id);
      if (!pendiente) return;
      pendientes.delete(id);
      if (error) pendiente.reject(new Error(error));
      else pendiente.resolve(resultado);
    };
  }
  return worker;
}

function pedir(mensaje) {
  const id = ++siguiente;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject });
    elWorker().postMessage({ id, ...mensaje });
  });
}

/** Starts downloading and building the index without searching. */
export const cargarIndice = (url) => pedir({ tipo: 'cargar', url });

export const buscar = (url, args) => pedir({ tipo: 'buscar', url, args });

/**
 * Preloads the index when the browser is idle, not while the page loads
 * (decision of 15/10: the raw index weighs ~1 MB with brotli).
 */
export function precargarCuandoEsteLibre(url) {
  const cargar = () => cargarIndice(url).catch(() => {});
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(cargar, { timeout: 10_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(cargar, 3_000);
  return () => clearTimeout(id);
}
