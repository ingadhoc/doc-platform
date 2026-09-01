# El login con el usuario de Odoo

Cómo se entra a un sitio de documentación **interna** y qué hay que configurar
—en Vercel y en nuestro Odoo— para que funcione. Task 72391.

## Qué reemplaza

Antes había una credencial compartida (usuario `adhoc`) en Bitwarden. No decía
quién entraba, no se daba de baja sola, y rotarla no invalidaba los deployments
viejos: cada uno seguía accesible por su URL con el secreto de su época. Desde
la v0.6.0 esa credencial no existe: se entra con el usuario de Odoo y no hay
otra forma.

**No hay break-glass.** Si Odoo no responde, la documentación interna no se
sirve a humanos. Las máquinas no dependen de eso: el MCP y los estáticos con
Bearer siguen andando con `DOCS_MCP_TOKENS`.

## Cómo funciona

```
persona sin sesión → gate (edge) → 302 /api/auth/login
                                        ↓
                          Odoo /oauth2/authorize → la persona se loguea
                                        ↓
                     /api/auth/callback ← vuelve con un `code`
                                        ↓
                       /oauth2/token    → el token, con `odoo_user_id`
                       /oauth2/userinfo → ¿es interno? ← ACÁ SE DECIDE
                                        ↓
                             cookie de sesión firmada (12 h)
                                        ↓
                    el gate solo verifica la firma: no habla con Odoo
```

Se llama `login-odoo` y no `oidc` porque el `oauth_provider` de OCA es OAuth2
pelado: sin discovery, sin JWKS y sin `id_token`. Con los tres endpoints
alcanza. Si algún día hay OIDC de verdad, se reemplaza `lib/login-odoo.mjs` y el
resto del sitio no se entera.

## Lo que hay que configurar en Odoo

**Sin esto, entra cualquiera que tenga un usuario en nuestro Odoo — incluidos
los miles de usuarios portal de los clientes.** `oauth.provider.client` no tiene
ningún campo para restringir quién puede autorizar un cliente, así que el filtro
tiene que vivir en el scope.

1. Un `ir.filters` sobre `res.users` con dominio `[('share', '=', False)]`.
2. Un `oauth.provider.scope` con:
   - `code`: el que va en `DOCS_ODOO_SCOPE` (p. ej. `docs_interna`);
   - `model_id`: `res.users`;
   - `filter_id`: el filtro del punto 1;
   - `field_ids`: `name` y `email` — lo que se muestra. El `id` no hace falta:
     la identidad sale de `odoo_user_id`, que ya viene con el token.
3. Un `oauth.provider.client` de tipo *Web Application* con ese scope en
   `scope_ids` y un `redirect_uri` por sitio: `https://<sitio>/api/auth/callback`.

El efecto es que `/oauth2/userinfo` devuelve `{}` con HTTP 200 para todo el que
el filtro excluye —un usuario portal, o uno archivado—, y el callback lee esa
respuesta vacía como un **no**.

> `userinfo` arma su respuesta con un `search`, que también excluye a los
> usuarios archivados. Es el comportamiento correcto acá: quien se fue de Adhoc
> no tiene que poder entrar.

## Variables del proyecto de Vercel

Van en **todos** los environments (Production, Preview y Development): las env
vars se hornean en el build, y un deployment buildeado sin ellas queda roto para
siempre.

| Variable | Qué es |
|---|---|
| `DOCS_SESION_SECRET` | Secreto de firma de la cookie. Sin esta, el sitio interno devuelve 503. Rotarla cierra todas las sesiones. |
| `DOCS_ODOO_URL` | La base de nuestro Odoo. |
| `DOCS_ODOO_CLIENT_ID` | El `identifier` del client. |
| `DOCS_ODOO_CLIENT_SECRET` | Su secreto. Nunca sale de la función. |
| `DOCS_ODOO_SCOPE` | El `code` del scope filtrado. **Sin default a propósito**: un valor por descarte sería una regla de acceso inventada por el paquete. |

No hay variable con la URL del sitio: el `redirect_uri` sale del host del
request. Ver más abajo.

`DOCS_AUTH_PASSWORD` y `DOCS_AUTH_USER` ya no las lee nadie: se pueden borrar.

## Las tres rutas de la puerta

`/api/auth/login`, `/api/auth/callback` y `/api/auth/logout` son lo único que el
gate deja pasar sin credencial, y ninguna sirve documentación. Es una **lista
exacta y no un prefijo**: con `/api/auth/*` alcanzaría agregar un archivo en esa
carpeta para publicar cualquier cosa sin gate, y nadie lo vería en el diff.

Como lo que ahí se reparte llega a cualquiera, **nada de lo que devuelvan puede
valer como sesión**. Por eso el propósito de cada cookie firmada va adentro de
la firma (`typ`): sin eso, la cookie del intento que emite `/api/auth/login`
servía de sesión con solo cambiarle el nombre.

## Qué dura y qué corta

La sesión vale **12 horas** y no se revalida contra Odoo en cada request: esa es
la razón por la que el gate es barato. Cuando vence, la vuelta al login es
invisible para quien tenga Odoo abierto — dos redirects, ninguna pantalla.

- **Alguien se fue de Adhoc:** se archiva el usuario en Odoo. El próximo login
  no pasa (el filtro del scope lo excluye) y la sesión viva se cae sola en menos
  de 12 h.
- **Cortar todo ya:** rotar `DOCS_SESION_SECRET`. Cierra todas las sesiones de
  todos.
- **`/api/auth/logout`** es para la máquina prestada o para probar con otro
  usuario. Borra la cookie y nada más; no cierra la sesión de Odoo.

No hay revocación individual instantánea: pedirla obligaría a hablar con Odoo en
cada request o a mantener una lista de revocación, y ninguna de las dos se paga
sola para este caso.

## El pegamento de cada repo

Un archivo por ruta en `api/auth/`, y **una línea cada uno**:

```js
// api/auth/login.mjs
export { puertaLogin as default } from '@ingadhoc/docs-platform/login-odoo';
```

Idem `puertaCallback` y `puertaLogout`. Son **objetos con `fetch`**, no
funciones, y eso no es estilo: exportar una función pelada hace que Vercel la
invoque al estilo Node con `(req, res)`, y las tres rutas contestan 500 con el
sitio sin acceso humano. Pasó.

## Los previews de PR

El `redirect_uri` sale del **host del request**, así que cada deployment pide
volver a sí mismo. En producción eso es el dominio canónico; en un preview, el
host del preview.

Como la lista de `redirect_uri` la valida Odoo, un preview cuyo host no esté
registrado **falla con un error de Odoo a la vista**. Es la dirección correcta:
la alternativa —un valor fijo— hacía que quien abriera un preview se logueara y
terminara en producción sin enterarse de que nunca lo vio.

Para revisar un preview interno autenticado, agregá su **branch alias** —el que
Vercel deja estable por rama, `<proyecto>-git-<rama>-<team>.vercel.app`— como un
`redirect_uri` más del client, y borralo cuando la rama se mergea. Una fila.
`oauth_provider` valida la lista exacta y no soporta comodines, así que no hay
forma de habilitarlos todos de una: es a demanda, y está bien que se vea quién
puede autenticar.

Ojo con el `Host`: quien llame puede mandar el que quiera, pero lo único que
consigue es que Odoo le rechace el login. Nosotros no validamos ese header —
para eso está la lista del client.
