/**
 * Carga y validación de `docs.config.json` — el primer contrato de la
 * plataforma (config ↔ plataforma; el segundo es índice ↔ motor, y vive en
 * `lib/mcp/indice.mjs`).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: "`docs.config.json` tiene tres esquemas
 * distintos y ningún validador — el contrato de la plataforma, sin gobernar.
 * Ahí empezó el fork" (spec de arquitectura). El schema JSON es el contrato
 * publicado (`schema/docs.config.schema.json`); este módulo es el que lo hace
 * cumplir en el build de cada repo.
 *
 * ── POR QUÉ UN VALIDADOR PROPIO Y NO `ajv` ────────────────────────────────
 * Esto corre en el `buildCommand` de sitios públicos, con `--ignore-scripts`,
 * y queremos superficie mínima: el paquete tiene UNA dependencia
 * (`minisearch`, que necesita el motor de búsqueda) y este validador no suma
 * ninguna. Cubre el subconjunto de JSON Schema que el contrato usa —
 * `type`, `enum`, `const`, `pattern`, `minLength`, `minimum`, `minItems`,
 * `uniqueItems`, `required`, `properties`, `additionalProperties`, `items`,
 * `propertyNames`, `$ref`/`$defs`, `allOf`, `anyOf`, `not`, `if`/`then`/`else`
 * — y NADA más: una palabra clave del schema que este validador no conozca es
 * un error de arranque, no una validación que se saltea en silencio.
 *
 * El schema publicado sigue siendo el contrato para cualquier otra
 * herramienta (editores, CI, `ajv` de quien quiera): acá no hay una segunda
 * fuente de verdad, hay un lector chico de la única que hay.
 *
 * REGLA DEL LECTOR (diseno-eje.md §5): si `schemaVersion` es mayor que la que
 * esta plataforma sabe leer, TIRA — el lector no puede adivinar campos que no
 * conoce. Un emisor más viejo del mismo major se acepta. Un config SIN
 * `schemaVersion` es pre-unificación y también falla: las tres formas
 * anteriores son incompatibles entre sí y adivinar cuál es sería exactamente
 * el bug que este campo previene.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Versión del contrato config ↔ plataforma que este paquete sabe leer. */
export const CONFIG_SOPORTADO = 1;

/** El schema publicado, tal como se distribuye en `schema/`. */
export const SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/docs.config.schema.json', import.meta.url)), 'utf8'),
);

// Palabras clave que este validador entiende (las demás son anotaciones).
const ANOTACIONES = new Set([
  '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', '$defs',
]);
const CONOCIDAS = new Set([
  'type', 'enum', 'const', 'pattern', 'minLength', 'minimum', 'minItems', 'uniqueItems',
  'required', 'properties', 'additionalProperties', 'items', 'propertyNames',
  '$ref', 'allOf', 'anyOf', 'not', 'if', 'then', 'else',
]);

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  if (Number.isInteger(valor)) return 'integer';
  if (typeof valor === 'number') return 'number';
  return typeof valor;
}

function coincideTipo(valor, esperado) {
  const real = tipoDe(valor);
  if (esperado === 'number') return real === 'number' || real === 'integer';
  if (esperado === 'object') return real === 'object';
  return real === esperado;
}

function resolverRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`$ref no soportada: ${ref}`);
  let nodo = root;
  for (const parte of ref.slice(2).split('/')) {
    nodo = nodo?.[parte];
    if (!nodo) throw new Error(`$ref no resuelve: ${ref}`);
  }
  return nodo;
}

/** Nombre legible de un campo para los mensajes: `deploy.guardDeFuga.motivo`. */
function unir(path, clave) {
  if (typeof clave === 'number') return `${path}[${clave}]`;
  return path ? `${path}.${clave}` : clave;
}

/** Lo que el `not` de este contrato quiere decir, en castellano. */
function mensajeDeNot(schema, path, valor) {
  if (Array.isArray(schema.enum)) {
    return `${path}: el valor "${valor}" está reservado (choca con una ruta del sitio)`;
  }
  const prohibidas = [];
  if (Array.isArray(schema.required)) prohibidas.push(...schema.required);
  if (Array.isArray(schema.anyOf)) {
    for (const rama of schema.anyOf) if (Array.isArray(rama.required)) prohibidas.push(...rama.required);
  }
  if (prohibidas.length) {
    const presentes = prohibidas.filter((k) => valor && Object.prototype.hasOwnProperty.call(valor, k));
    return `${path}: no puede declarar ${(presentes.length ? presentes : prohibidas)
      .map((k) => `\`${k}\``)
      .join(' ni ')} (ver la descripción del campo en el schema)`;
  }
  return `${path}: no cumple la restricción \`not\` del schema`;
}

function validarNodo(valor, schema, path, root, errores) {
  for (const clave of Object.keys(schema)) {
    if (!CONOCIDAS.has(clave) && !ANOTACIONES.has(clave)) {
      throw new Error(
        `el schema usa la palabra clave "${clave}" (en ${path || '(raíz)'}) y este validador no ` +
          'la conoce: agregala a lib/config.mjs antes de usarla en el contrato.',
      );
    }
  }

  if (schema.$ref) {
    validarNodo(valor, resolverRef(schema.$ref, root), path, root, errores);
    return;
  }

  if (schema.type && !coincideTipo(valor, schema.type)) {
    errores.push(`${path || '(raíz)'}: esperaba ${schema.type} y vino ${tipoDe(valor)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(valor)) {
    errores.push(`${path}: "${valor}" no es un valor válido (esperaba ${schema.enum.join(' | ')})`);
  }
  if ('const' in schema && valor !== schema.const) {
    errores.push(`${path}: esperaba ${JSON.stringify(schema.const)}`);
  }
  if (schema.pattern && typeof valor === 'string' && !new RegExp(schema.pattern, 'u').test(valor)) {
    errores.push(`${path}: "${valor}" no matchea el patrón ${schema.pattern}`);
  }
  if (schema.minLength != null && typeof valor === 'string' && valor.length < schema.minLength) {
    errores.push(`${path}: tiene ${valor.length} caracteres y el mínimo es ${schema.minLength}`);
  }
  if (schema.minimum != null && typeof valor === 'number' && valor < schema.minimum) {
    errores.push(`${path}: ${valor} es menor que el mínimo ${schema.minimum}`);
  }

  if (Array.isArray(valor)) {
    if (schema.minItems != null && valor.length < schema.minItems) {
      errores.push(`${path}: tiene ${valor.length} elemento(s) y el mínimo es ${schema.minItems}`);
    }
    if (schema.uniqueItems) {
      const vistos = new Set(valor.map((v) => JSON.stringify(v)));
      if (vistos.size !== valor.length) errores.push(`${path}: tiene elementos repetidos`);
    }
    if (schema.items) {
      valor.forEach((v, i) => validarNodo(v, schema.items, unir(path, i), root, errores));
    }
  }

  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const req of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(valor, req)) {
        errores.push(`${path ? `${path}.` : ''}${req}: falta el campo obligatorio`);
      }
    }
    const declaradas = new Set(Object.keys(schema.properties ?? {}));
    for (const [clave, sub] of Object.entries(valor)) {
      if (schema.propertyNames) {
        validarNodo(clave, schema.propertyNames, `${path ? `${path}.` : ''}${clave} (nombre)`, root, errores);
      }
      if (declaradas.has(clave)) {
        validarNodo(sub, schema.properties[clave], unir(path, clave), root, errores);
      } else if (schema.additionalProperties === false) {
        errores.push(
          `${unir(path, clave)}: clave desconocida. El contrato no admite campos extra ` +
            '(una clave desconocida es un error, no un campo que se ignora)',
        );
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validarNodo(sub, schema.additionalProperties, unir(path, clave), root, errores);
      }
    }
  }

  for (const rama of schema.allOf ?? []) validarNodo(valor, rama, path, root, errores);

  if (schema.anyOf) {
    const alguna = schema.anyOf.some((rama) => {
      const propios = [];
      validarNodo(valor, rama, path, root, propios);
      return propios.length === 0;
    });
    if (!alguna) errores.push(`${path || '(raíz)'}: no cumple ninguna de las formas admitidas`);
  }

  if (schema.not) {
    const propios = [];
    validarNodo(valor, schema.not, path, root, propios);
    if (propios.length === 0) errores.push(mensajeDeNot(schema.not, path || '(raíz)', valor));
  }

  if (schema.if) {
    const propios = [];
    validarNodo(valor, schema.if, path, root, propios);
    const rama = propios.length === 0 ? schema.then : schema.else;
    if (rama) validarNodo(valor, rama, path, root, errores);
  }
}

/**
 * Valida un objeto contra el schema del contrato. No lee archivos: sirve para
 * validar lo que ya tenés en memoria (el build, un test, un editor).
 *
 * @returns {{ok: boolean, errores: string[]}} cada error nombra el PATH del
 *          campo, para que el mensaje sea accionable sin abrir el schema.
 */
export function validarConfig(config) {
  const errores = [];
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errores: ['(raíz): el config tiene que ser un objeto JSON'] };
  }
  if (!Number.isInteger(config.schemaVersion)) {
    errores.push(
      'schemaVersion: falta o no es un entero. Un config sin `schemaVersion` es ' +
        'pre-unificación: las tres formas anteriores son incompatibles entre sí y adivinar ' +
        'cuál es sería el bug que este campo previene.',
    );
  } else if (config.schemaVersion > CONFIG_SOPORTADO) {
    errores.push(
      `schemaVersion: el config declara ${config.schemaVersion} y esta plataforma lee hasta ` +
        `${CONFIG_SOPORTADO}: actualizá @ingadhoc/docs-platform en este repo.`,
    );
  }
  // Con un `schemaVersion` que no sabemos leer no seguimos: los campos que
  // vendrían después son de un contrato que no conocemos.
  if (errores.length) return { ok: false, errores };

  validarNodo(config, SCHEMA, '', SCHEMA, errores);
  errores.push(...coherencia(config));
  return { ok: errores.length === 0, errores };
}

/**
 * Lo que un JSON Schema no puede expresar y el contrato igual promete: las
 * referencias entre campos. Son las que se rompen sin que nadie las note,
 * porque cada campo por separado es válido.
 */
function coherencia(config) {
  const errores = [];
  const audiencias = Array.isArray(config.audiences) ? config.audiences : [];
  const valores = Array.isArray(config.eje?.valores) ? config.eje.valores : [];
  const ids = valores.map((v) => v?.id).filter(Boolean);

  for (const [proyecto, audiencia] of Object.entries(config.deploy?.proyectos ?? {})) {
    if (!audiencias.includes(audiencia)) {
      errores.push(
        `deploy.proyectos.${proyecto}: "${audiencia}" no está en \`audiences\` ` +
          `(${audiencias.join(', ') || 'vacío'}). El guard de fuga lo chequea recién en runtime.`,
      );
    }
  }
  if (config.eje?.default != null && ids.length && !ids.includes(config.eje.default)) {
    errores.push(
      `eje.default: "${config.eje.default}" no es el id de ningún valor del eje ` +
        `(${ids.join(', ')}).`,
    );
  }
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repetidos.length) {
    errores.push(`eje.valores: ids repetidos (${[...new Set(repetidos)].join(', ')})`);
  }
  return errores;
}

/**
 * Lee y valida el `docs.config.json` de un repo. TIRA con todos los errores
 * juntos: quien corre el build quiere la lista, no el primero de N.
 *
 * @param {{ruta?: string, cwd?: string}} opciones
 * @returns {object} el config validado, tal cual (sin defaults aplicados: el
 *          consumidor de cada campo aplica el suyo, que está en el schema).
 */
export function cargarConfig({ ruta = 'docs.config.json', cwd = process.cwd() } = {}) {
  const absoluta = resolve(cwd, ruta);
  let crudo;
  try {
    crudo = readFileSync(absoluta, 'utf8');
  } catch (error) {
    throw new Error(`no se pudo leer ${ruta}: ${error.code || error.message}`);
  }
  let config;
  try {
    config = JSON.parse(crudo);
  } catch (error) {
    throw new Error(`${ruta} no es JSON válido: ${error.message}`);
  }
  const { ok, errores } = validarConfig(config);
  if (!ok) {
    throw new Error(
      `${ruta} no cumple el contrato de la plataforma (schema/docs.config.schema.json):\n` +
        errores.map((e) => `  · ${e}`).join('\n'),
    );
  }
  return config;
}
