/**
 * El motor del MCP: lee el índice del agente del disco y expone `buscar`,
 * `leer` y `mapa` sobre él. El motor en sí está en `motor.mjs`, que no sabe
 * de node; acá vive sólo la carga, y se reexporta todo lo demás.
 *
 * TODO ESTE MÓDULO CORRE UNA SOLA VEZ POR INSTANCIA. Vercel corre las
 * funciones con Fluid Compute (default en proyectos nuevos — hay que
 * verificar el toggle en cada proyecto): el scope de módulo persiste entre
 * invocaciones, así que leer el JSON y construir el índice de MiniSearch acá
 * se paga una vez por instancia, no por request.
 *
 * De dónde sale el archivo: lo emite el preprocesador (`tools/build.mjs`,
 * target `agente`) en `api/_generated/index.json`, por audiencia, en cada
 * build. Vive adentro de `api/` a propósito para que quede al lado de la
 * función; como es `.json`, Vercel no lo convierte en un endpoint.
 *
 * Cómo entra al bundle de la función: `fs.readFileSync` con una ruta armada
 * en runtime NO la puede trazar `@vercel/nft`, así que el archivo se declara
 * a mano en `vercel.json`:
 *
 *   "functions": { "api/mcp.mjs": { "includeFiles": "api/_generated/**" } }
 *
 * (La alternativa —`import ... with { type: 'json' }`— sí se trazaría sola,
 * pero deja el índice entero en el grafo de módulos ESM y no permite el
 * fallback de rutas de abajo, que es lo que hace testeable esto en local.)
 *
 * El entorno se lee al construir: DOCS_URL es el origin de las URLs (la MISMA
 * variable que consume Docusaurus para su `url` y el preprocesador para
 * `siteUrl`; no inventamos otra porque dos vars con el mismo valor se
 * desincronizan) y DOCS_AUDIENCE el respaldo de un índice sin audiencia.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crearMotor } from './motor.mjs';

export * from './motor.mjs';

function rutasCandidatas() {
  const rutas = [];
  if (process.env.DOCS_INDICE_PATH) rutas.push(process.env.DOCS_INDICE_PATH);
  // El consumidor: el índice vive en `api/_generated/` del repo que buildea.
  rutas.push(join(process.cwd(), 'api', '_generated', 'index.json'));
  // Layout viejo (el módulo dentro del repo, en lib/mcp/). Se conserva para
  // que el paquete siga funcionando vendorizado.
  rutas.push(fileURLToPath(new URL('../../api/_generated/index.json', import.meta.url)));
  return rutas;
}

function leerIndiceCrudo() {
  const errores = [];
  for (const ruta of rutasCandidatas()) {
    try {
      return JSON.parse(readFileSync(ruta, 'utf8'));
    } catch (error) {
      errores.push(`${ruta}: ${error.code || error.message}`);
    }
  }
  throw new Error(
    `No se pudo leer el índice del agente. Rutas probadas — ${errores.join(' | ')}`,
  );
}

let cache = null;
let errorDeCarga = null;

/** Singleton de scope de módulo: una carga y un motor por instancia. */
function motor() {
  if (cache) return cache;
  if (errorDeCarga) throw errorDeCarga;
  try {
    cache = crearMotor(leerIndiceCrudo(), {
      origin: process.env.DOCS_URL || '',
      audiencia: process.env.DOCS_AUDIENCE,
    });
    return cache;
  } catch (error) {
    errorDeCarga = error;
    throw error;
  }
}

export function indice() {
  return motor().indice;
}

/** Solo para tests: fuerza recargar. */
export function _resetIndice() {
  cache = null;
  errorDeCarga = null;
}

export const buscar = (args) => motor().buscar(args);
export const leer = (args) => motor().leer(args);
export const mapa = (args) => motor().mapa(args);
export const seccionesConComodin = () => motor().seccionesConComodin();
