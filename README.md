<h1 align="center">Detro CLI</h1>

<p align="center">
  Uma tela local para conversar com o agente do <strong>Claude Code</strong> dentro do seu projeto.<br>
  O agente pode ser o <strong>Claude</strong> ou um modelo do <strong>Ollama</strong>, e os comandos do ambiente ficam a um <code>/</code> de distância.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vitortrack777/detro"><img src="https://img.shields.io/npm/v/@vitortrack777/detro.svg" alt="versão no npm"></a>
  <img src="https://img.shields.io/node/v/@vitortrack777/detro.svg" alt="node">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@vitortrack777/detro.svg" alt="licença MIT"></a>
</p>

```bash
npm install -g @vitortrack777/detro
cd meu-projeto
detro              # abre a tela no navegador
detro restart api  # os comandos do ambiente continuam funcionando direto no terminal
```

---

## Como funciona

`detro` sobe um servidor em `127.0.0.1`, numa porta livre, e abre a tela no navegador. Cada pedido
que você escreve vira uma chamada `claude -p` na raiz do projeto, e a tela mostra ao vivo o que o
agente faz: raciocínio, ferramentas, respostas, tempo e tokens. A conversa continua de um pedido para
o próximo (`--resume`) até você digitar `/novo`.

Quem decide o que fazer é o agente. O detro não tem templates nem validadores próprios: ele só repassa
o pedido, o modelo, o esforço e o modo de permissão, mais o contexto do projeto descrito abaixo.

## Requisitos

| Requisito | Para quê |
|---|---|
| [Node.js](https://nodejs.org) 20+ | Executar o detro |
| [Claude Code](https://docs.anthropic.com/claude-code) instalado e logado (`claude`) | O agente |
| [Ollama](https://ollama.com) 0.14+ (opcional) | Usar modelos do Ollama como agente |
| Script `appDev` ou `app` na raiz (opcional) | Os comandos do ambiente (`/start`, `/logs`…) |

## A tela

| Parte | O que faz |
|---|---|
| Caixa de pedido | Enter envia, Shift+Enter quebra a linha. Durante uma tarefa, o botão vira **parar** |
| `/` | Lista os comandos: `/novo` (conversa nova) e os do ambiente (`/start`, `/restart api`, `/logs --tail=100 api`, `/status`…). A saída aparece na tela, e o botão de parar encerra o comando (útil no `logs -f`) |
| Seletor de modelo | Claude (padrão, Fable, Opus, Sonnet, Haiku) ou qualquer modelo instalado no Ollama. O modelo do Ollama roda **dentro do Claude Code**, com as mesmas ferramentas e os mesmos `CLAUDE.md` |
| Esforço | Baixo a Máximo, repassado como `--effort` |
| Modo, no topo | **Planejar** (só planeja), **Só leitura** (lê; edição e comando são bloqueados), **Editar** (edita arquivos; comandos só os liberados nas configurações do projeto), **Automático** (o Claude Code decide o que é seguro) |

Quando o modo bloqueia uma ferramenta, a tela mostra o que foi bloqueado. Troque o modo e peça de novo.

Os comandos destrutivos do ambiente (`execute`, que recria o banco, e `auto-remove`, que apaga
volumes) não aparecem na tela. Use pelo terminal: `detro execute <banco> arquivo.sql`.

## Contexto que o agente recebe

O Claude Code já carrega os `CLAUDE.md`, as configurações do projeto (`.claude/`), as skills e o git
status. O detro acrescenta ao system prompt (`--append-system-prompt`):

- as pastas versionadas do projeto, até 4 níveis e no máximo 150, para o agente não gastar passos procurando;
- o conteúdo de `.detro/contexto.md`, se existir, como instrução.

Use o `.detro/contexto.md` para o que vale só para você e não pertence ao repositório: vocabulário do
domínio, armadilhas conhecidas, onde fica cada coisa, o card em andamento. Ele é lido no começo de
cada conversa: depois de editar, digite `/novo`.

## Configuração

O modelo, o esforço e o modo escolhidos na tela ficam salvos em `.detro/config.json`:

```json
{
  "model": "claude:opus",
  "effort": "high",
  "mode": "acceptEdits",
  "ollamaUrl": "http://127.0.0.1:11434"
}
```

O retorno bruto da última resposta do agente fica em `.detro/last-turn.ndjson`, para diagnóstico.

| Variável de ambiente | Descrição |
|---|---|
| `DETRO_PORT` | Porta fixa no lugar de uma porta livre |
| `DETRO_APP_SCRIPT` | Script de ambiente no lugar de `appDev`/`app` |

O detro remove `ANTHROPIC_API_KEY` do ambiente do agente: o uso conta na sua assinatura do Claude Code,
não na API paga. Com modelo de nuvem do Ollama (`:cloud`), o código lido pelo agente sai da máquina.

## Segurança

- O servidor só escuta em `127.0.0.1`.
- Toda chamada à API exige o token aleatório que vai na URL (`?t=…`), gerado a cada execução. Outro
  site aberto no navegador não consegue disparar o agente.
- Uma tarefa por vez: enquanto uma roda, as outras são recusadas.
- A resposta do modelo aparece como Markdown, sem HTML, sem imagens e sem links que não sejam http(s).

## Instalação a partir do código

```bash
git clone git@github.com:vitortrack/detro-cli.git
cd detro-cli
bash ./detro.sh install     # npm ci + build da tela + npm link + autocompletar do bash
```

| Comando | O que faz |
|---|---|
| `bash ./detro.sh update` | O mesmo que `install`, depois de um `git pull` |
| `bash ./detro.sh uninstall` | Remove o link global e o autocompletar |
| `npm run build` | Gera `web/dist`, que é o que o pacote publica |
| `npm test` | Checa se o Markdown da resposta continua sem HTML nem links perigosos |

A tela é React + Vite e usa componentes do [React Bits](https://reactbits.dev) (PromptBar,
ThoughtLine, LatticeLoader, StatusMark, RubberSegment), copiados para `web/src/components/`. O
servidor (`server.js`) usa só a biblioteca padrão do Node, então o pacote publicado não tem dependências.
