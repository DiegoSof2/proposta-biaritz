# Este repositorio NAO e o site da Biaritz

Sao duas coisas separadas, e confundi-las derruba a loja:

| | Site da Biaritz | Este repositorio |
|---|---|---|
| O que e | Loja/catalogo em producao | Proposta comercial |
| Endereco | biaritz.com.br | proposta-biaritz.sirunai.workers.dev |
| Worker | `biaritz` | `proposta-biaritz` |
| Repositorio | biaritz-site | proposta-biaritz |
| Pasta local | ~/Projects/biaritz | ~/Projects/proposta-biaritz |

## Como publicar

    ./deploy.sh

Nao rode `wrangler deploy` direto. O `deploy.sh` confere o nome do Worker e a
ausencia de rotas antes de publicar. Se o nome no `wrangler.toml` voltar a ser
`biaritz`, o deploy sobrescreve o site em producao: por isso a trava existe.

## Historico

Ate setembro de 2026 este repositorio tinha `name = "biaritz"` no wrangler.toml,
o mesmo nome do Worker que serve a loja. Qualquer deploy daqui teria derrubado o
site. O nome foi corrigido e a trava foi adicionada.
