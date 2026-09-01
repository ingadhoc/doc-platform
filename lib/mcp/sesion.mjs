/**
 * La sesión del humano: una cookie firmada que dice quién entró. Reemplaza a la
 * credencial compartida (task 72391).
 *
 * El ida y vuelta con Odoo pasa una vez, en `login-odoo.mjs`, y termina acá: los
 * datos de la persona se firman y viajan en la cookie. El gate del edge no habla
 * con Odoo en cada request, solo verifica la firma. Está en un archivo aparte
 * porque el gate lo importa y el edge no puede cargar el `fetch` del login.
 *
 * Firma con WebCrypto porque `node:crypto` no existe en el edge. La contracara
 * es que firmar y verificar son ASÍNCRONOS: no hay HMAC sincrónico sin traer una
 * librería al bundle.
 *
 * La expiración va ADENTRO de la firma, no en el `Max-Age` de la cookie: el
 * `Max-Age` lo decide el browser y se puede editar; `exp` no.
 *
 * Y el PROPÓSITO también va adentro de la firma. Con el mismo secreto se firman
 * dos cosas distintas —el intento de login y la sesión— y una firma válida no
 * dice para qué se emitió. Sin esto, la cookie del intento, que la reparte
 * `/api/auth/login` a cualquiera que la pida sin credencial, sirve de sesión con
 * solo cambiarle el nombre: gate abierto sin haber pasado nunca por Odoo.
 */

/**
 * Para qué se emitió cada cookie firmada. No son intercambiables y por eso van
 * adentro de la firma: ver el encabezado.
 */
export const PROPOSITO_SESION = 'sesion';
export const PROPOSITO_INTENTO = 'intento';

/** Lo que dura una sesión sin volver a pasar por Odoo: un día laboral. */
export const TTL_POR_DEFECTO = 12 * 60 * 60;

/** Sin prefijo `__Host-`: ataría la cookie a un dominio exacto y los previews
 *  de PR viven en otro host. */
export const COOKIE_SESION = 'docs_sesion';

const encoder = new TextEncoder();

/** Compara dos MAC sin cortar antes cuando difieren (no filtra por timing). */
function igualBytes(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** bytes → base64url. Sin `Buffer`: no existe en el edge. */
function aBase64Url(bytes) {
  let crudo = '';
  for (const b of bytes) crudo += String.fromCharCode(b);
  return btoa(crudo).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes, o null si el texto no es base64url. */
function deBase64Url(texto) {
  try {
    const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
    const crudo = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function firmar(cuerpo, secreto) {
  const clave = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', clave, encoder.encode(cuerpo)));
}

/**
 * Firma los datos de la persona y devuelve el valor de la cookie, con formato
 * `<payload>.<firma>` en base64url. El payload va a la vista y está bien: no
 * lleva nada secreto, y lo que la firma protege es que nadie se lo invente.
 */
export async function firmarSesion(
  datos,
  secreto,
  { ttlSegundos = TTL_POR_DEFECTO, ahora, proposito = PROPOSITO_SESION } = {},
) {
  if (!secreto) throw new Error('firmarSesion: falta el secreto de firma');
  const emitido = Math.floor((ahora ?? Date.now()) / 1000);
  const cuerpo = aBase64Url(
    encoder.encode(JSON.stringify({ ...datos, typ: proposito, exp: emitido + ttlSegundos })),
  );
  return `${cuerpo}.${aBase64Url(await firmar(cuerpo, secreto))}`;
}

/**
 * Devuelve los datos de la persona, o `null` si la cookie no sirve — firma mal,
 * formato roto, expirada, sin `exp`, emitida para otro propósito, o secreto
 * ausente (fail-closed).
 *
 * Todos los casos devuelven `null`: al gate solo le importa si entra o no, y
 * distinguir "firma inválida" de "expirada" le cuenta cosas a un atacante.
 */
export async function verificarSesion(
  valor,
  secreto,
  { ahora, proposito = PROPOSITO_SESION } = {},
) {
  if (!valor || !secreto) return null;

  const corte = valor.indexOf('.');
  if (corte < 1) return null;
  const cuerpo = valor.slice(0, corte);
  const recibida = deBase64Url(valor.slice(corte + 1));
  if (!recibida || !igualBytes(await firmar(cuerpo, secreto), recibida)) return null;

  const bytes = deBase64Url(cuerpo);
  if (!bytes) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  // Sin `exp` la sesión sería eterna: no se acepta.
  if (typeof payload?.exp !== 'number') return null;
  if (payload.exp <= Math.floor((ahora ?? Date.now()) / 1000)) return null;

  // Firmada por nosotros, sí, pero ¿para esto? Una cookie sin `typ` es de antes
  // de que el propósito existiera: tampoco vale.
  if (payload.typ !== proposito) return null;

  return payload;
}

/**
 * Saca una cookie del header `Cookie`. Se queda con la última si viene
 * repetida: cuando conviven una cookie vieja de otro path y la nueva, el browser
 * manda las dos y quedarse con la primera deja afuera a quien tiene sesión.
 */
export function leerCookie(header, nombre = COOKIE_SESION) {
  if (!header) return null;
  let valor = null;
  for (const parte of header.split(';')) {
    const igual = parte.indexOf('=');
    if (igual > 0 && parte.slice(0, igual).trim() === nombre) valor = parte.slice(igual + 1).trim();
  }
  return valor;
}

/**
 * El `Set-Cookie` de la sesión. `SameSite=Lax` y no `Strict` porque la persona
 * llega navegando DESDE Odoo: con `Strict` el browser no manda la cookie en ese
 * primer request y el login parece no haber funcionado.
 */
export function cookieDeSesion(valor, { ttlSegundos = TTL_POR_DEFECTO } = {}) {
  return `${COOKIE_SESION}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlSegundos}`;
}
