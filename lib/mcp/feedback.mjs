/**
 * `feedback()`: el agente reporta docu incorrecta o faltante creando un issue
 * en el repo de la documentación. Va donde se arregla, con el triage que ya
 * existe.
 *
 * Alcance: SOLO en las audiencias con auth (ver `mcp-handler.mjs`, que
 * registra la tool únicamente si la audiencia lleva gate). En un MCP público
 * sería un endpoint anónimo de creación de issues — spameable con un `curl`,
 * o vía prompt injection en un agente de cliente. En un repo cuya única
 * audiencia es interna la condición se cumple sola, no hace falta declararla.
 *
 * Sin dependencia nueva: fetch directo a la REST API de GitHub.
 *
 * Env:
 *   GITHUB_REPO                 = "ingadhoc/<repo de la documentación>"
 *   DOCS_FEEDBACK_GITHUB_TOKEN  = token fine-grained con permiso de ISSUES
 *                                 solamente (nada de contents ni workflows).
 */

export const LABEL = 'docs-feedback';

/**
 * EL EJE en el issue. `config.eje` es el MISMO objeto de `docs.config.json`
 * (`{ tipo, default?, valores }`): el issue lleva UN campo de eje —la versión
 * de Odoo (oba-docs) o el project dueño del archivo (adhoc-docs)— y la
 * etiqueta sale del `tipo`, no de una config de strings.
 *
 *   eje: { tipo: 'version' }   → "**Versión**: 19"
 *   eje: { tipo: 'project' }   → "**Project**: oba", y el título se prefija
 *   eje: { tipo: 'none' } | null → el issue no menciona ningún eje
 *
 * El prefijo del título se DERIVA del tipo: sirve cuando el eje decide a QUÉ
 * REPO se rutea el arreglo (el caso de `project`, donde el contenido se trae
 * por pull y el issue es sólo el buzón). Con eje de versión no aporta: el
 * arreglo va al mismo repo igual. `label` y `enTitulo` se pueden pisar desde
 * la config, pero ningún corpus necesita hacerlo hoy.
 */
const ETIQUETA = { version: 'Versión', project: 'Project' };

function camposDeEje(eje, valor) {
  if (!eje || eje.tipo === 'none' || !ETIQUETA[eje.tipo]) return { linea: null, prefijo: '' };
  const label = eje.label ?? ETIQUETA[eje.tipo];
  const enTitulo = eje.enTitulo ?? eje.tipo === 'project';
  return {
    linea: `**${label}**: ${valor || '(no declarado)'}`,
    prefijo: enTitulo && valor ? `${valor}: ` : '',
  };
}

/**
 * Fabrica el `crearIssue()` del repo.
 *
 * Config:
 *   eje    el objeto `eje` de `docs.config.json`. Ver `camposDeEje()`.
 *   notas  líneas extra al pie del issue (dominio del corpus). P. ej.
 *          adhoc-docs aclara que el arreglo va en el repo del project.
 */
export function crearFeedback(config = {}) {
  const eje = config.eje ?? null;
  const notas = config.notas ?? [];

  return async function crearIssue({ slug, problema, eje: valorEje, clientId, buildId }) {
    const repo = process.env.GITHUB_REPO;
    const token = process.env.DOCS_FEEDBACK_GITHUB_TOKEN;

    // Falta config → la tool responde, no rompe. Un agente que no puede
    // reportar tiene que poder seguir contestando la pregunta del usuario.
    if (!token || !repo) {
      return {
        ok: false,
        motivo: 'no-configurado',
        mensaje:
          'feedback no configurado: faltan GITHUB_REPO y/o DOCS_FEEDBACK_GITHUB_TOKEN ' +
          'en el proyecto. No se creó ningún issue; seguí respondiendo normalmente.',
      };
    }

    const { linea, prefijo } = camposDeEje(eje, valorEje);

    const cuerpo = [
      `**Slug**: \`${slug}\``,
      ...(linea ? [linea] : []),
      `**Consumidor**: ${clientId || '(anónimo)'}`,
      `**Build del índice**: ${buildId}`,
      '',
      '**Problema reportado por el agente**',
      '',
      problema,
      '',
      '---',
      '_Creado automáticamente por la tool `feedback()` del MCP de documentación._',
      ...notas,
    ].join('\n');

    let respuesta;
    try {
      respuesta = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `[docs-feedback] ${prefijo}${slug}`,
          body: cuerpo,
          labels: [LABEL],
        }),
      });
    } catch (error) {
      return { ok: false, motivo: 'red', mensaje: `No se pudo contactar a GitHub: ${error.message}` };
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      return {
        ok: false,
        motivo: `http-${respuesta.status}`,
        mensaje: `GitHub rechazó el issue (${respuesta.status}). ${detalle.slice(0, 300)}`,
      };
    }

    const issue = await respuesta.json();
    return { ok: true, numero: issue.number, url: issue.html_url, label: LABEL };
  };
}
