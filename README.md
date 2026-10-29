<h1 align="center">DjinnAI</h1>

<p align="center">
  Uma tela local para conversar com o agente do <strong>Claude Code</strong> dentro do seu projeto.<br>
  O agente pode ser o <strong>Claude</strong> ou um modelo do <strong>Ollama</strong>, e os comandos do ambiente ficam a um <code>/</code> de distância.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vitortrack777/djinnai"><img src="https://img.shields.io/npm/v/@vitortrack777/djinnai.svg" alt="versão no npm"></a>
  <img src="https://img.shields.io/node/v/@vitortrack777/djinnai.svg" alt="node">
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@vitortrack777/djinnai.svg" alt="licença MIT"></a>
</p>

```bash
npm install -g @vitortrack777/djinnai
cd meu-projeto
djinn              # abre o aplicativo (djinn --navegador abre no navegador)
djinn restart api  # os comandos do ambiente continuam funcionando direto no terminal
```

---

## Como funciona

`djinn` sobe um servidor em `127.0.0.1`, numa porta livre, e abre a tela num **aplicativo de desktop**
(Electron, que vem com o pacote), no Linux, no Windows e no macOS, sem depender de navegador.
**Fechar a janela encerra o DjinnAI.** O endereço também aparece no terminal: dá para abrir no
navegador ao mesmo tempo, e as duas telas mostram a mesma conversa.

| Comando | Abre |
|---|---|
| `djinn` (ou `djinnai`) | A janela do aplicativo. Se ela não abrir (sem ambiente gráfico, por exemplo), cai no navegador padrão |
| `djinn --navegador` | Só o navegador padrão, como numa aba comum |

A conversa é
uma sessão do Claude Code aberta na raiz do projeto, no mesmo protocolo que o Agent SDK usa
(`stream-json` de entrada e saída). Por isso a tela tem o que o Claude Code tem:

- o texto aparece enquanto o agente escreve, com raciocínio, ferramentas, tempo e tokens;
- o agente **pede permissão** na tela antes de editar ou rodar comando, mostrando o comando ou o diff;
- o agente **faz perguntas** com opções e **apresenta o plano** para você aprovar no modo Planejar;
- dá para **mandar mensagem com o agente trabalhando**: ela entra na fila e o agente lê assim que puder;
- **prints colados** (Ctrl+V) ou arrastados para a tela vão junto com a mensagem;
- o `/` lista as skills e comandos do Claude Code do projeto, além dos comandos do ambiente;
- recarregar a página não perde a conversa, que continua até você digitar `/novo` ou fechar o DjinnAI.

Quem decide o que fazer é o agente. O DjinnAI não tem templates nem validadores próprios: ele só repassa
o pedido, o modelo, o esforço e o modo de permissão, mais o contexto do projeto descrito abaixo.

## Requisitos

| Requisito | Para quê |
|---|---|
| [Node.js](https://nodejs.org) 22.12+ (recomendado: 24 LTS) | Executar o DjinnAI e o Electron |
| [Claude Code](https://docs.anthropic.com/claude-code) instalado e logado (`claude`) | O agente |
| [Ollama](https://ollama.com) 0.14+ (opcional) | Usar modelos do Ollama como agente |
| Script `appDev` ou `app` na raiz (opcional) | Os comandos do ambiente (`/start`, `/logs`…) |

## A tela

| Parte | O que faz |
|---|---|
| Conversas, na lateral | Todas as conversas do Claude Code neste projeto, inclusive as abertas no VS Code ou no terminal, com quando foram usadas e quantos tokens de contexto carregam (em amarelo acima de 100k). Clicar retoma a conversa com o histórico na tela. Uma conversa mexida nos últimos 5 minutos em outro lugar é retomada numa cópia, para não disputar o mesmo arquivo. **+ Nova conversa** (ou `/novo`) começa uma sessão limpa, e cada `djinn` também começa numa sessão nova |
| Contexto, no topo | Quantos tokens a conversa atual já carrega; o agente relê tudo a cada passo. Acima de 100k a tela sugere uma conversa nova |
| Caixa de pedido | Enter envia, Shift+Enter quebra a linha. Com o agente trabalhando, Enter põe a mensagem na fila e o botão vira **parar** |
| `/` | Lista `/novo` (conversa nova), os comandos do ambiente (`/start`, `/restart api`, `/logs --tail=100 api`, `/status`…) e as skills do Claude Code. A saída do ambiente aparece na tela, e o botão de parar encerra o comando (útil no `logs -f`) |
| Uso do plano, no topo, e `/usage` | O topo mostra quanto já foi usado da sessão de 5h, da semana e do limite do modelo escolhido, quando o plano tem um. Passe o mouse para ver quando renova. Acima de 80%, um aviso aparece sobre a caixa de pedido. Clicar no topo ou digitar `/usage` abre o detalhe, com tokens e custo equivalente por modelo desde que o DjinnAI abriu. Os números são os mesmos do `/usage` do Claude Code e a consulta não gasta tokens |
| Seletor de modelo | Os modelos que a sua conta do Claude Code oferece ou qualquer modelo instalado no Ollama. O modelo do Ollama roda **dentro do Claude Code**, com as mesmas ferramentas e os mesmos `CLAUDE.md` |
| Esforço | Baixo a Máximo, repassado como `--effort` (vale a partir da próxima mensagem com o agente parado) |
| Modo, abaixo da caixa de pedido | **Planejar** (planeja e pede aprovação do plano; aprovar passa para Editar), **Perguntar** (pede permissão para cada edição e comando), **Editar** (edita sem perguntar; comandos fora das regras do projeto pedem permissão), **Automático** (o Claude Code decide o que é seguro). Muda na hora, mesmo no meio de uma resposta |

No cartão de permissão, **Permitir e não perguntar de novo** grava a regra sugerida pelo Claude Code, como no terminal.

Os comandos destrutivos do ambiente (`execute`, que recria o banco, e `auto-remove`, que apaga
volumes) não aparecem na tela. Use pelo terminal: `djinn execute <banco> arquivo.sql`.

## Contexto que o agente recebe

O Claude Code já carrega os `CLAUDE.md`, as configurações do projeto (`.claude/`), as skills e o git
status. O DjinnAI acrescenta ao system prompt (`--append-system-prompt`):

- as pastas versionadas do projeto, até 4 níveis e no máximo 150, para o agente não gastar passos procurando;
- o conteúdo de `.djinn/contexto.md`, se existir, como instrução.

Use o `.djinn/contexto.md` para o que vale só para você e não pertence ao repositório: vocabulário do
domínio, armadilhas conhecidas, onde fica cada coisa, o card em andamento. Ele é lido no começo de
cada conversa: depois de editar, digite `/novo`.

## Configuração

O modelo, o esforço e o modo escolhidos na tela ficam salvos em `.djinn/config.json`:

```json
{
  "model": "claude:opus",
  "effort": "high",
  "mode": "acceptEdits",
  "ollamaUrl": "http://127.0.0.1:11434"
}
```

O retorno bruto da última mensagem ao agente fica em `.djinn/last-turn.ndjson`, para diagnóstico.

| Variável de ambiente | Descrição |
|---|---|
| `DJINN_PORT` | Porta fixa no lugar de uma porta livre |
| `DJINN_APP_SCRIPT` | Script de ambiente no lugar de `appDev`/`app` |

Projetos que já têm `.detro/` continuam usando essa pasta, e `DETRO_PORT`/`DETRO_APP_SCRIPT` seguem valendo quando a variável `DJINN_` correspondente não está definida.

O DjinnAI remove `ANTHROPIC_API_KEY` do ambiente do agente: o uso conta na sua assinatura do Claude Code,
não na API paga. Com modelo de nuvem do Ollama (`:cloud`), o código lido pelo agente sai da máquina.

## Segurança

- O servidor só escuta em `127.0.0.1`.
- Toda chamada à API exige o token aleatório que vai na URL (`?t=…`), gerado a cada execução. Outro
  site aberto no navegador não consegue disparar o agente.
- Um comando do ambiente por vez: enquanto um roda, os outros são recusados.
- A resposta do modelo aparece como Markdown, sem HTML, sem imagens e sem links que não sejam http(s).

## Instalação a partir do código

```bash
git clone git@github.com:vitortrack/djinnai.git
cd djinnai
bash ./djinn.sh install     # npm ci + build da tela + npm link + autocompletar do bash
```

| Comando | O que faz |
|---|---|
| `bash ./djinn.sh update` | O mesmo que `install`, depois de um `git pull` |
| `bash ./djinn.sh uninstall` | Remove o link global e o autocompletar |
| `npm run build` | Gera `web/dist`, que é o que o pacote publica |
| `npm test` | Checa o Markdown (sem HTML nem links perigosos) e como a tela monta a conversa a partir dos eventos |

A tela é React + Vite e usa componentes do [React Bits](https://reactbits.dev) (PromptBar,
ThoughtLine, LatticeLoader, StatusMark, GlideSelect, WarmTooltip, LineSidebar), copiados para `web/src/components/`. O
servidor (`server.js`) usa só a biblioteca padrão do Node; a única dependência do pacote é o Electron,
que desenha a janela (`window.cjs`).
