#!/usr/bin/env bash
# Deploy da PROPOSTA. Nunca do site da Biaritz.
#
# O site biaritz.com.br e servido pelo Worker chamado "biaritz", que mora no
# repositorio biaritz-site. Este repositorio e outra coisa: a proposta comercial.
# Se o nome do Worker daqui virar "biaritz", este deploy SOBRESCREVE o site em
# producao. A trava abaixo existe para que isso nunca aconteca.
set -euo pipefail
cd "$(dirname "$0")"

NOME=$(grep -m1 '^name' wrangler.toml | cut -d'"' -f2)

if [ "$NOME" != "proposta-biaritz" ]; then
  echo "ABORTADO: o Worker deste repositorio deveria se chamar 'proposta-biaritz',"
  echo "mas o wrangler.toml diz '$NOME'."
  echo "Publicar assim sobrescreveria o site da Biaritz. Corrija o nome antes."
  exit 1
fi

if grep -qiE '^\s*(routes?|route)\s*=' wrangler.toml; then
  echo "ABORTADO: existe uma rota no wrangler.toml."
  echo "A proposta nao deve responder em nenhum dominio da Biaritz."
  exit 1
fi

echo "Worker: $NOME (o site da Biaritz nao e tocado)"
npx wrangler deploy
