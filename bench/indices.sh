#!/usr/bin/env bash
# Genera los índices del banco desde origin/main de cada sitio, sin tocar los clones.
#   bench/indices.sh <dir-de-trabajo>      (deja los index.json en <dir>/indices)
# Sólo corre el emisor de cada repo (el paso `gen`), nunca el build de Docusaurus.
set -euo pipefail
W=${1:?uso: bench/indices.sh <dir-de-trabajo>}
CLONES=${CLONES:-$HOME/repositorios}
PLATAFORMA=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$W/repos/node_modules/@ingadhoc" "$W/indices"
# Absoluta: los pasos de abajo hacen `cd` a otro directorio antes de usarla.
W=$(cd "$W" && pwd)

# Dependencias de los emisores (gray-matter y compañía) del clon de oba-docs;
# la plataforma es la de este worktree (config.mjs no cambió desde v0.16.0).
for e in "$CLONES"/oba-docs/node_modules/*; do
  n=$(basename "$e"); [ "$n" = "@ingadhoc" ] && continue
  [ -e "$W/repos/node_modules/$n" ] || ln -s "$e" "$W/repos/node_modules/$n"
done
ln -sfn "$PLATAFORMA" "$W/repos/node_modules/@ingadhoc/docs-platform"

extraer() { mkdir -p "$W/repos/$2"; git -C "$CLONES/$1" archive origin/main | tar -x -C "$W/repos/$2"; }
for r in oba-docs odumbo-docs adhoc-docs tuqui-docs; do git -C "$CLONES/$r" fetch -q origin; extraer "$r" "$r"; done

for r in oba-docs odumbo-docs; do
  for a in publico interno; do
    (cd "$W/repos/$r" && node tools/build.mjs --audience=$a --quiet)
    cp "$W/repos/$r/api/_generated/index.json" "$W/indices/$r-$a.json"
  done
done

# adhoc-docs no versiona `content/`: se usa el snapshot del clon local con el
# docs.config.json del clon (el de origin/main pide projects que el snapshot no tiene).
(cd "$W/repos/adhoc-docs" && POC_CONFIG="$CLONES/adhoc-docs/docs.config.json" \
  POC_CONTENT="$CLONES/adhoc-docs/content" POC_OUT="$W/repos/adhoc-snap" \
  node tools/build.mjs --audience=interno --quiet)
cp "$W/repos/adhoc-snap/api/_generated/index.json" "$W/indices/adhoc-docs-interno.json"

(cd "$W/repos/tuqui-docs" && node tools/emitir-indice.mjs && node tools/emitir-indice.mjs --idioma=en --salida=dist/agente-en)
cp "$W/repos/tuqui-docs/dist/agente/index.json" "$W/indices/tuqui-docs-es.json"
cp "$W/repos/tuqui-docs/dist/agente-en/index.json" "$W/indices/tuqui-docs-en.json"

# El índice bilingüe (es + en en un solo archivo, schemaVersion 2), con el emisor
# del propio repo. Si su origin/main todavía no lo trae, esas corridas se saltean.
if [ -f "$W/repos/tuqui-docs/tools/emitir-indice-bilingue.mjs" ]; then
  (cd "$W/repos/tuqui-docs" && node tools/emitir-indice-bilingue.mjs --salida=dist/agente-bilingue)
  cp "$W/repos/tuqui-docs/dist/agente-bilingue/index.json" "$W/indices/tuqui-docs-bilingue.json"
else
  echo "tuqui-docs sin tools/emitir-indice-bilingue.mjs: sin índice bilingüe"
fi

# Variante sin el sidecar de keywords: otra copia, sin tools/keywords-es.json.
extraer tuqui-docs tuqui-docs-sinkw
mv "$W/repos/tuqui-docs-sinkw/tools/keywords-es.json" "$W/repos/keywords-es.apartado.json"
(cd "$W/repos/tuqui-docs-sinkw" && node tools/emitir-indice.mjs)
cp "$W/repos/tuqui-docs-sinkw/dist/agente/index.json" "$W/indices/tuqui-docs-es-sin-keywords.json"
ls -la "$W/indices"
