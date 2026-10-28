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

`detro` sobe um servidor em `127.0.0.1`, numa porta livre, e abre a tela no navegador. A conversa é
uma sessão do Claude Code aberta na raiz do projeto, no mesmo protocolo que o Agent SDK usa
(`stream-json` de entrada e saída). Por isso a tela tem o que o Claude Code tem:

- o texto aparece enquanto o agente escreve, com raciocínio, ferramentas, tempo e tokens;
- o agente **pede permissão** na tela antes de editar ou rodar comando, mostrando o comando ou o diff;
- o agente **faz perguntas** com opções e **apresenta o plano** para você aprovar no modo Planejar;
- dá para **mandar mensagem com o agente trabalhando**: ela entra na fila e o agente lê assim que puder;
- **prints colados** (Ctrl+V) ou arrastados para a tela vão junto com a mensagem;
- o `/` lista as skills e comandos do Claude Code do projeto, além dos comandos do ambiente;
- recarregar a página não perde a conversa, que continua até você digitar `/novo` ou fechar o detro.

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
| Caixa de pedido | Enter envia, Shift+Enter quebra a linha. Com o agente trabalhando, Enter põe a mensagem na fila e o botão vira **parar** |
| `/` | Lista `/novo` (conversa nova), os comandos do ambiente (`/start`, `/restart api`, `/logs --tail=100 api`, `/status`…) e as skills do Claude Code. A saída do ambiente aparece na tela, e o botão de parar encerra o comando (útil no `logs -f`) |
| Seletor de modelo | Os modelos que a sua conta do Claude Code oferece ou qualquer modelo instalado no Ollama. O modelo do Ollama roda **dentro do Claude Code**, com as mesmas ferramentas e os mesmos `CLAUDE.md` |
| Esforço | Baixo a Máximo, repassado como `--effort` (vale a partir da próxima mensagem com o agente parado) |
| Modo, no topo | **Planejar** (planeja e pede aprovação do plano; aprovar passa para Editar), **Perguntar** (pede permissão para cada edição e comando), **Editar** (edita sem perguntar; comandos fora das regras do projeto pedem permissão), **Automático** (o Claude Code decide o que é seguro). Muda na hora, mesmo no meio de uma resposta |

No cartão de permissão, **Permitir e não perguntar de novo** grava a regra sugerida pelo Claude Code, como no terminal.

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

O retorno bruto da última mensagem ao agente fica em `.detro/last-turn.ndjson`, para diagnóstico.

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
- Um comando do ambiente por vez: enquanto um roda, os outros são recusados.
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
| `npm test` | Checa o Markdown (sem HTML nem links perigosos) e como a tela monta a conversa a partir dos eventos |

A tela é React + Vite e usa componentes do [React Bits](https://reactbits.dev) (PromptBar,
ThoughtLine, LatticeLoader, StatusMark, RubberSegment), copiados para `web/src/components/`. O
servidor (`server.js`) usa só a biblioteca padrão do Node, então o pacote publicado não tem dependências.
