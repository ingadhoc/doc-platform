#!/usr/bin/env bash
# Genera los índices del banco desde origin/main de cada sitio, sin tocar los clones.
#   bench/indices.sh <dir-de-trabajo>      (deja los index.json en <dir>/indices)
# Sólo corre el emisor de cada repo (el paso `gen`), nunca el build de Docusaurus.
# Un sitio sin clon en $CLONES se saltea y lo dice: sus corridas no tienen índice
# y `correr.mjs` las saltea.
set -euo pipefail
W=${1:?uso: bench/indices.sh <dir-de-trabajo>}
CLONES=${CLONES:-$HOME/repositorios}
PLATAFORMA=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$W/repos/node_modules/@ingadhoc" "$W/indices"
# Absoluta: los pasos de abajo hacen `cd` a otro directorio antes de usarla.
W=$(cd "$W" && pwd)
# Sin índices de otra corrida: uno viejo se mediría como si fuera de hoy.
rm -f "$W"/indices/*.json

# Dependencias de los emisores (gray-matter y compañía) del clon de oba-docs;
# la plataforma es la de este worktree (config.mjs no cambió desde v0.16.0).
for e in "$CLONES"/oba-docs/node_modules/*; do
  n=$(basename "$e"); [ "$n" = "@ingadhoc" ] && continue
  [ -e "$W/repos/node_modules/$n" ] || ln -s "$e" "$W/repos/node_modules/$n"
done
ln -sfn "$PLATAFORMA" "$W/repos/node_modules/@ingadhoc/docs-platform"

hay() { [ -d "$CLONES/$1/.git" ] || { echo "$1: sin clon en $CLONES, se saltea"; return 1; }; }
# El build de los sitios compara la plataforma instalada en SU node_modules con
# su lock y frena si no coincide; el symlink al de arriba la deja como un link,
# que no se compara (tools/instalacion.mjs de cada sitio).
extraer() {
  mkdir -p "$W/repos/$2"
  git -C "$CLONES/$1" archive origin/main | tar -x -C "$W/repos/$2"
  ln -sfn ../node_modules "$W/repos/$2/node_modules"
}
for r in oba-docs odumbo-docs adhoc-docs tuqui-docs; do
  hay "$r" || continue
  git -C "$CLONES/$r" fetch -q origin
  extraer "$r" "$r"
done

# Las audiencias que declara cada sitio, no una lista fija: oba-docs, por
# ejemplo, ya no tiene `interno`.
for r in oba-docs odumbo-docs; do
  [ -d "$W/repos/$r" ] || continue
  for a in $(node -e 'for (const a of require(process.argv[1]).audiences) console.log(a)' "$W/repos/$r/docs.config.json"); do
    (cd "$W/repos/$r" && node tools/build.mjs --audience="$a" --quiet)
    cp "$W/repos/$r/api/_generated/index.json" "$W/indices/$r-$a.json"
  done
done

# adhoc-docs no versiona `content/`: se usa el snapshot del clon local con el
# docs.config.json del clon (el de origin/main pide projects que el snapshot no tiene).
if [ -d "$W/repos/adhoc-docs" ]; then
  (cd "$W/repos/adhoc-docs" && POC_CONFIG="$CLONES/adhoc-docs/docs.config.json" \
    POC_CONTENT="$CLONES/adhoc-docs/content" POC_OUT="$W/repos/adhoc-snap" \
    node tools/build.mjs --audience=interno --quiet)
  cp "$W/repos/adhoc-snap/api/_generated/index.json" "$W/indices/adhoc-docs-interno.json"
fi

# tuqui-docs emite con `--idiomas`: un idioma da el índice de antes
# (`schemaVersion: 1`) y los dos, el bilingüe (`schemaVersion: 2`, el que publica).
if [ -d "$W/repos/tuqui-docs" ]; then
  (cd "$W/repos/tuqui-docs" && node tools/emitir-indice.mjs --idiomas=es --salida=dist/agente-es \
    && node tools/emitir-indice.mjs --idiomas=en --salida=dist/agente-en \
    && node tools/emitir-indice.mjs --idiomas=es,en --salida=dist/agente-bilingue)
  cp "$W/repos/tuqui-docs/dist/agente-es/index.json" "$W/indices/tuqui-docs-es.json"
  cp "$W/repos/tuqui-docs/dist/agente-en/index.json" "$W/indices/tuqui-docs-en.json"
  cp "$W/repos/tuqui-docs/dist/agente-bilingue/index.json" "$W/indices/tuqui-docs-bilingue.json"
fi
ls -la "$W/indices"
