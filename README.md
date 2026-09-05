# Morim

> **Morim** — Alternativa Open Source (GPLv3), leve e 100% offline ao Kahoot para eventos e salas de aula.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg)](https://tauri.app)
[![Axum](https://img.shields.io/badge/Axum-0.7-green.svg)](https://github.com/tokio-rs/axum)

## Características

- **100% Offline** — Funciona totalmente na rede local sem internet
- **Leve** — Binário único (~10MB), sem dependências externas pesadas
- **Tempo Real** — WebSocket para sincronização instantânea entre professor e jogadores
- **Multi-plataforma** — Windows, Linux, macOS
- **QR Code** — Entrada rápida via QR Code gerado automaticamente
- **Editor Visual** — Crie quizzes com tipos de pergunta variados
- **Assets Personalizáveis** — Avatares, temas de pódium, áudios
- **Persistência Local** — Quizzes salvos em JSON/YAML

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
│  │  • /ws           - Real-time game communication      │  │
│  │  • /api/quizzes  - Quiz CRUD                         │  │
│  │  • /api/assets   - Avatar/Podium management          │  │
│  │  • /assets/*     - Static file serving               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Início Rápido

### Pré-requisitos

- [Rust 1.75+](https://rustup.rs/)
- [Node.js 18+](https://nodejs.org/) (para desenvolvimento frontend)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Desenvolvimento

```bash
# Clone o repositório
git clone https://github.com/HonoravelMacho/morin.git
cd morin

# Instale dependências do frontend (opcional - para hot reload)
npm install

# Execute em modo desenvolvimento
cargo tauri dev
```

### Build de Produção

```bash
# Build otimizado
cargo tauri build

# O binário estará em: src-tauri/target/release/morim
# O bundle (AppImage/.deb/.msi/.dmg) em: src-tauri/target/release/bundle/
```

## Uso

1. **Inicie o Morim** — O servidor HTTP/WebSocket sobe automaticamente na porta 8080
2. **Compartilhe o QR Code** — Mostre a tela para os jogadores escanearem
3. **Crie Quizzes** — Use o editor visual na aba "Quizzes"
4. **Inicie o Jogo** — Clique em "Iniciar Jogo" no quiz desejado
5. **Jogue!** — Jogadores entram pelo navegador no celular/computador

### Endereços de Acesso

- **Professor (Desktop):** App nativo Tauri
- **Jogadores (Navegador):** `http://<IP_LOCAL>:8080`
- **Exemplo:** `http://192.168.1.15:8080`

## Estrutura do Projeto

```
morin/
├── src/                      # Frontend (HTML/CSS/JS)
│   ├── index.html           # Página principal
│   ├── styles.css           # Estilos (CSS Variables, Dark Mode)
│   └── app.js               # Lógica do frontend (ES Modules)
├── src-tauri/               # Backend Rust
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
├── assets/                  # Assets estáticos (copiados para AppData)
│   ├── avatars/            # Imagens de avatar (.png, .jpg, .gif, .svg)
│   └── podiums/            # Áudios/temas de pódium
├── quizzes/                # Arquivos de quiz (.json, .yaml)
└── .gitignore
```

## Tipos de Pergunta Suportados

| Tipo | Descrição |
|------|-----------|
| `single_choice` | Escolha única (rádio) |
| `multiple_choice` | Múltipla escolha (checkbox) |
| `true_false` | Verdadeiro ou Falso |
| `type_answer` | Digitação livre |
| `puzzle` | Ordenação/arrastar |

## API REST

### Quizzes

```http
GET    /api/quizzes              # Lista todos os quizzes
POST   /api/quizzes              # Cria novo quiz
GET    /api/quizzes/:id          # Obtém quiz específico
DELETE /api/quizzes/:id          # Exclui quiz
```

### Assets

```http
GET    /api/avatars              # Lista avatares
GET    /api/podiums              # Lista assets de pódium
POST   /api/upload               # Upload de asset (multipart)
DELETE /api/assets/:type/:id     # Exclui asset
```

### WebSocket

```javascript
const ws = new WebSocket('ws://<IP>:8080/ws');

// Entrar no jogo
ws.send(JSON.stringify({
  type: 'JoinGame',
  payload: { pin: '123456', name: 'João', avatar: 'avatar1' }
}));

// Responder pergunta
ws.send(JSON.stringify({
  type: 'SubmitAnswer',
  payload: { question_id: 'uuid', answer: [0] }
}));
```

## Dados Locais

Os dados são armazenados em:

```
Linux:   ~/.local/share/morim/
macOS:   ~/Library/Application Support/morim/
Windows: %APPDATA%\morim\
```

Estrutura:
```
morim/
├── assets/
│   ├── avatars/          # Imagens de avatar
│   └── podiums/          # Áudios/temas
└── quizzes/              # Arquivos .json/.yaml dos quizzes
```

## Licença

GPLv3 — Veja [LICENSE](LICENSE) para detalhes.

## Contribuição

1. Fork o projeto
2. Crie sua branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'feat: adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## Roadmap

- [ ] Modo "Apresentação" para tela cheia
- [ ] Exportar/Importar quizzes (Kahoot, Quizizz, CSV)
- [ ] Estatísticas detalhadas por jogador
- [ ] Temas visuais personalizáveis
- [ ] Suporte a times/equipes
- [ ] Modo "Torneio" com múltiplas rodadas
- [ ] Internacionalização (i18n)

---

**Feito com ❤️ por [HonoravelMacho](https://github.com/HonoravelMacho) para a comunidade educacional.**