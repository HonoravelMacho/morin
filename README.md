# Morim - Offline Open Source Kahoot

**Morim** é uma alternativa Open Source (licença GPLv3), leve e 100% offline ao Kahoot, desenvolvida para eventos, salas de aula e apresentações que não dependem de conexão com a internet. O aplicativo funciona completamente na rede local, permitindo que professores/apresentadores controlem quizzes em tempo real enquanto os jogadores (estudantes) participam via navegador em seus celulares ou computadores.

## Proposta

- **100% Offline**: Funciona totalmente na rede local sem exigir internet após o início
- **Leve**: Binário único (~10MB), sem dependências externas pesadas
- **Tempo Real**: WebSocket para sincronização instantânea entre apresentador e jogadores
- **Multi-plataforma**: Windows, Linux e macOS
- **QR Code**: Entrada rápida via QR Code gerado automaticamente
- **Assets Personalizáveis**: Avatares, temas de pódium e áudios podem ser adicionados pela comunidade
- **Persistência Local**: Quizzes salvos em JSON/YAML no disco

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri App (Rust)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Frontend   │  │   Backend    │  │   Axum Server    │  │
│  │  (HTML/JS)   │◄─┤  (Commands)  │◄─┤  (Port 8080)     │  │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘  │
│                                                │            │
│                    ┌───────────────────────────┘            │
│                    ▼                                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              WebSocket / HTTP API                     │  │
│  │  • /ws           - Comunicação em tempo real       │  │
│  │  • /api/quizzes  - CRUD de quizzes                  │  │
│  │  • /api/assets   - Gestão de avatares/pódium       │  │
│  │  • /assets/*     - Servir arquivos estáticos       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Frontend**: HTML/CSS/JS modular, com interface separada para mobile e desktop (presenter)
- **Backend**: Rust com Tauri, expondo comandos via IPC e servidor HTTP/Axum
- **Armazenamento**: Dados em `~/.local/share/morim/` (Linux), `%APPDATA%\morim/` (Windows)

## Instalação e Execução em Eventos sem Internet

### Pré-requisitos

- [Rust 1.75+](https://rustup.rs/) - Para compilar e executar o backend
- [Node.js 18+](https://nodejs.org/) - Opcional, apenas para desenvolvimento frontend com hot-reload
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites) - Para builds nativos

### Modo Desenvolvimento (para testes)

```bash
# 1. Clone o repositório
git clone https://github.com/HonoravelMacho/morin.git
cd morin

# 2. Execute em modo desenvolvimento
cargo tauri dev
```

Isso iniciará o servidor HTTP/WebSocket na porta 8080 e abrirá a janela do apresentador.

### Build para Produção

```bash
# Build otimizado
cargo tauri build
```

O binário ficará em: `src-tauri/target/release/morim`
O bundle (instaladores) ficará em: `src-tauri/target/release/bundle/`

### Uso em Eventos (Sem Internet)

1. **Inicie o Morim** - O servidor HTTP/WebSocket sobe automaticamente na porta 8080
2. **Compartilhe o QR Code** - Mostre a tela do apresentador para os jogadores escanearem
3. **Jogadores conectam** - Abrem `http://<IP_LOCAL>:8080` no navegador do celular/computador
4. **Crie ou selecione um Quiz** - Use a interface do apresentador para escolher ou criar um quiz
5. **Inicie o Jogo** - Clique em "Iniciar Jogo" no quiz desejado
6. **Jogue!** - Os jogadores respondem em tempo real, o apresentador vê o pódium atualizando ao vivo

### Endereços de Acesso

- **Apresentador (Desktop)**: Aplicativo nativo Tauri
- **Jogadores (Navegador)**: `http://<IP_LOCAL>:8080`
- **Exemplo**: `http://192.168.1.15:8080`

Para encontrar o IP local, execute `ip addr` no Linux ou `ipconfig` no Windows, ou consiga o IP pelo próprio Morim na tela inicial.

## Estrutura do Projeto

```
morin/
├ src/                      # Frontend (HTML/CSS/JS)
│   ├── index.html           # Página principal (mobile)
│   ├── styles.css           # Estilos (CSS Variables, Dark Mode)
│   ├── app.js               # Lógica do frontend (ES Modules)
│   └── presenter/           # Interface do apresentador (Desktop)
│       ├── index.html       # Tela do apresentador
│       ├── presenter.js     # Lógica WebSocket e views do presenter
│       └── presenter.css    # Estes do presenter
├ src-tauri/               # Backend Rust
│   ├── src/
│   │   ├── main.rs          # Entry point Tauri
│   │   ├── lib.rs           # Exports dos módulos
│   │   ├── models.rs        # Structs de dados (Quiz, Player, etc.)
│   │   ├── server.rs        # Servidor Axum + WebSocket
│   │   ├── commands.rs      # Comandos Tauri (IPC)
│   │   └── utils.rs         # Utilitários
│   ├── Cargo.toml           # Dependências Rust
│   ├── tauri.conf.json      # Configuração Tauri
│   └── build.rs             # Build script
├ assets/                   # Assets estáticos (copiados para AppData)
│   ├── avatars/            # Imagens de avatar (.png, .jpg, .gif, .svg)
│   └── podiums/            # Áudios/temas de pódium
├ quizzes/                 # Arquivos de quiz (.json, .yaml)
└── .gitignore
```

## Como Contribuir (Guia para a Comunidade)

A comunidade é fundamental para o Morim crescer. Aqui está como você pode ajudar:

### 1. Adicionando Novos Avatares

Os avatares são usados pelos jogadores para se identificarem nas partidas.

**Passo a passo:**

1. Prepare uma imagem em `.png`, `.jpg` ou `.gif` (preferencialmente quadrada, 64x64px ou maior)
2. Nomeie o arquivo com um identificador único (ex: `astronauta.png`, `robot.gif`)
3. Coloque o arquivo na pasta `/assets/avatars/`
4. Reinicie o Morim ou execute `cargo tauri dev` para recarregar
5. Os novos avatares aparecerão automaticamente na lista de seleção no cliente mobile

**Especificações técnicas:**
- Formatos aceitos: PNG, JPG, JPEG, GIF, SVG, WebP
- Tamanho recomendado: até 256x256px (será redimensionado automaticamente)
- Opcional: adicione um emoji como fallback caso a imagem não carregue

### 2. Criando Temas para o Pódium

Os temas do pódium controlam a aparência visual das telhas de classificação ao final das seções.

**Passo a passo:**

1. Crie um arquivo de configuração na pasta `/assets/podiums/`
2. Pode ser:
   - **Arquivo JSON**: Define cores, fonts e estilos do pódium
   - **Arquivo CSS**: Sobrescreve variáveis CSS para customizar o visual
   - **Arquivo JavaScript**: Lógica complexa para animações
   - **Arquivo de áudio**: Arquivos .mp3, .wav, .ogg para efeitos sonoros
3. Nomeie o arquivo (ex: `celebration.json`, `minimal.css`, `fanfare.mp3`)
4. O tema ficará disponível no seletor de temas do apresentador

**Exemplo de tema JSON:**
```json
{
  "name": "Celebração",
  "primaryColor": "#ffd700",
  "backgroundColor": "#1a1a2e",
  "accentColor": "#e94560",
  "fontFamily": "Arial, sans-serif"
}
```

### 3. Como Contribuir no Código

1. **Fork** o projeto: clique em "Fork" no GitHub
2. **Crie sua branch**: `git checkout -b feature/nova-funcionalidade`
3. **Commit suas mudanças**: `git commit -m 'feat: adiciona nova funcionalidade'`
4. **Push para a branch**: `git push origin feature/nova-funcionalidade`
5. **Abra um Pull Request**: descreva o que foi feito e por que é útil

### 4. Adicionando Novos Tipos de Pergunta

Se você quiser adicionar um novo tipo de pergunta:

1. Modifique `src-tauri/src/models.rs` para adicionar o novo tipo no enum `QuestionType`
2. Atualize a lógica de validação em `src-tauri/src/server.rs`
3. Atualize a renderização em `src/app.js` e `src/mobile/mobile.js`
4. Siga os passos 2-5 acima

## Guia de Compilação Local

### Requisitos

| Componente | Versão Mínima | Instalação |
|------------|---------------|------------|
| Rust       | 1.75+         | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| Node.js    | 18+           | Download em https://nodejs.org/ |
| Tauri CLI  | 2.0+          | `npm install -g @tauri-apps/cli` |
| Git        | 2.0+          | `sudo apt-get install git` (Linux) ou `choco install git` (Windows) |

### Compilação no Linux

```bash
# 1. Clone o repositório
git clone https://github.com/HonoravelMacho/morin.git
cd morin

# 2. Instale dependências do sistema
# (dependências variam pela distro, geralmente:
#  - libwebkit2gtk-4.1-0 no Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y build-essential libwebkit2gtk-4.1-0

# 3. Instale dependências do Node (opcional, para hot-reload)
npm install

# 4. Build de desenvolvimento
cargo tauri dev

# 5. Build de produção
cargo tauri build
```

### Compilação no macOS

```bash
# 1. Clone o repositório
git clone https://github.com/HonoravelMacho/morin.git
cd morin

# 2. Instale dependências
brew install webkit2gtk  # ou use o build framework da Apple

# 3. Build
cargo tauri build
```

### Compilação no Windows

```powershell
# 1. Clone o repositório
git clone https://github.com/HonoravelMacho/morin.git
cd morin

# 2. Instale Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 3. Build
cargo tauri build
```

### Arquitetura do Projeto (Detalhada)

O projeto segue a arquitetura cliente-servidor descentralizada:

- **Tauri App (Rust)**: O "cérebro" do aplicativo. Compilado em binário nativo, responsável por:
  - Servir arquivos estáticos (quizzes, avatars, podiums)
  - Gerenciar WebSocket connections entre apresentador e jogadores
  - Processar respostas de quiz e calcular pontos
  - Gerenciar estado das sessões de jogo

- **Frontend Mobile (HTML/JS)**: A interface que os jogadores acessam via navegador
  - Conecta via WebSocket em `ws://<IP>:8080/ws`
  - Envia respostas, nomes e avatares
  - Recebe perguntas, timers e leaderboards atualizados

- **Frontend Desktop (HTML/JS - Apresentador)**: A interface para o professor/apresentador
  - Conecta via WebSocket para sincronização de estado
  - Exibe QR Code para entrada de jogadores
  - Controla fluxo de seções, cronômetros e pódiums
  - Carrega e seleciona quizzes da pasta local

- **Armazenamento Local**: Todos os dados (quizzes, avatars, podiums, configs) são persistidos
  - Em `~/.local/share/morim/` no Linux
  - Em `%APPDATA%\morim\` no Windows
  - Isso garante que o aplicativo funcione completamente offline após o primeiro setup

## API REST Endpoints

### Quizzes

```http
GET    /api/quizzes              # Lista todos os quizzes
POST   /api/quizzes              # Cria novo quiz
GET    /api/quizzes/:id          # Obtém quiz específico
DELETE /api/quizzes/:id          # Exclui quiz
```

### Assets

```http
GET    /api/avatars              # Lista avatares disponíveis
GET    /api/podiums              # Lista assets de pódium
POST   /api/upload               # Upload de asset (multipart/form-data)
DELETE /api/assets/:type/:id     # Exclui avatar ou tema de pódium
# :type pode ser "avatars" ou "podiums"
```

### WebSocket

```javascript
const ws = new WebSocket('ws://192.168.1.15:8080/ws');

// Entrar no jogo
ws.send(JSON.stringify({
  type: 'JoinGame',
  payload: { pin: '123456', name: 'João', avatar: 'astronauta' }
});

// Responder pergunta
ws.send(JSON.stringify({
  type: 'SubmitAnswer',
  payload: { question_id: 'uuid-da-pergunta', answer: [0] }  // índice da opção correta
}));
```

## Licença

Este projeto está licenciado sob a **GNU General Public License v3.0** - veja o arquivo [LICENSE](LICENSE) para detalhes.

## Roadmap

- [x] Interface Desktop do Apresentador (Tauri)
- [x] Multi-seções de quiz com pódiums parciais
- [ ] Modo "Apresentação" para tela cheia
- [ ] Exportar/Importar quizzes (Kahoot, Quizizz, CSV)
- [ ] Estatísticas detalhadas por jogador
- [ ] Temas visuais personalizáveis pela comunidade
- [ ] Suporte a times/equipes
- [ ] Internacionalização (i18n - pt/en)
- [ ] Integração com Google Drive/Dropbox para backup de quizzes

## Reconcimentos

Feito com ❤️ por [HonoravelMacho](https://github.com/HonoravelMacho) para a comunidade educacional.

Inspirado por projetos Open Source que democratizam o acesso a ferramentas de ensino interativo.

---

**Morim** - Making quizzes accessible offline, anywhere, anytime.