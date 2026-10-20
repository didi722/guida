#!/bin/sh
# Il disco persistente di molti hosting (Render, Fly…) si monta con proprietario root: il sito gira come utente `node` e non potrebbe scriverci.
# Si sistema il proprietario della cartella dei dati all'avvio (solo se serve), poi si lascia l'utente root e si avvia il sito.
set -e
DIR="${DATA_DIR:-/data}"
mkdir -p "$DIR"
if [ "$(stat -c %U "$DIR")" != "node" ]; then chown -R node:node "$DIR"; fi
exec su-exec node "$@"
