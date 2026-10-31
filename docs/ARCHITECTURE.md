# VANTA — arquitetura e decisões

## Visão geral

```
┌──────────────────────── processo VANTA.exe ────────────────────────┐
│  Rust (Tauri 2)                                                     │
│  ├─ island.rs     janela da cápsula: monitor/DPI, hit-test, foco     │
│  ├─ media/        GSMTC (sessões de mídia do Windows), eventos       │
│  ├─ power.rs      PowerManager (WinRT), eventos                      │
│  ├─ audio.rs      MMDevice/Core Audio (COM), eventos + volume/mudo   │
│  ├─ alarms.rs     agendador persistente (Condvar) + toast nativo     │
│  ├─ store.rs      JSON por chave, gravação atômica                   │
│  ├─ tools.rs      conversor (FFmpeg) · downloader (yt-dlp) · clipboard│
│  ├─ lyrics.rs     LRCLIB via Windows.Web.Http, cache                 │
│  ├─ files.rs      abrir / mostrar na pasta (caminhos não confiáveis) │
│  ├─ bridge/       pipe nomeado local + host de Native Messaging      │
│  └─ system.rs     URIs permitidas, janela de configurações, atalho   │
│                                                                     │
│  WebView2                                                           │
│  ├─ island.html   a cápsula (React + Motion)                        │
│  └─ settings.html janela de configurações                           │
└─────────────────────────────────────────────────────────────────────┘
          ▲ Native Messaging (stdin/stdout)        ▲ \\.\pipe\vanta-bridge-v1-<usuário>
          │                                         │
   Chrome/Edge/Brave/Firefox ── extensão opcional ──┘ (VANTA.exe em "modo host")
```

## Decisões

| Decisão | Por quê |
|---|---|
| **Tauri 2 + Rust + React/TS (strict) + Vite** | Janela nativa leve (WebView2 já vem no Windows 11), integração direta com WinRT/COM via `windows-rs`, instalador NSIS/MSI oficial. |
| **Janela de tamanho fixo, transparente, com hit-test por cursor** | Redimensionar a janela a cada quadro da animação causa tremor no WebView2. A janela fica fixa (até 1200×780 lógicos, limitada à área de trabalho — cabe a cápsula redimensionada e as Configurações ampliadas); só a cápsula é desenhada. A área de hover é exatamente a cápsula, sem folga. Uma thread lê `GetCursorPos` (33 ms perto da cápsula, 140 ms longe) e liga/desliga `WS_EX_TRANSPARENT` — fora da cápsula os cliques atravessam para o app de baixo. |
| **Não rouba foco** | A janela nasce `focusable: false` (`WS_EX_NOACTIVATE`) e `WS_EX_TOOLWINDOW` (fora do Alt+Tab). Botões funcionam sem ativar a janela. Só um campo de texto ou o atalho global tornam a cápsula focável, e ela devolve o foco ao recolher. |
| **Mídia orientada a eventos** | `SessionsChanged`, `CurrentSessionChanged`, `MediaPropertiesChanged`, `PlaybackInfoChanged`, `TimelinePropertiesChanged`. Rajadas são agrupadas (90 ms). Sem polling de progresso: o frontend interpola a posição a partir de `LastUpdatedTime`. Há só uma releitura de segurança (8 s tocando / 45 s parado). |
| **Identificação da origem** | `shell:AppsFolder\<AUMID>` → nome que o próprio Windows mostra (resolve Firefox, Chrome, apps da Store); depois tabela de executáveis conhecidos; depois nome derivado; senão rótulo neutro. Nunca adivinha marca. |
| **Capa** | Lida do stream do Windows, aceita só JPEG/PNG/WebP/GIF/BMP pelos *magic bytes*, limite de 3 MB, cache LRU de 16 itens em memória. |
| **Alarmes em Rust** | O WebView pode ser estrangulado quando oculto; alarmes precisam sobreviver a reinícios. Uma `Condvar` dorme até o próximo vencimento; vencimentos muito atrasados (PC desligado) não geram rajada de toasts. |
| **Persistência** | JSON por chave numa lista fechada (`settings`, `tasks`, `water`, `notifications`, `media-prefs`, `layout`); gravação em `.tmp` + `rename`; arquivo corrompido vai para quarentena. SQLite não se pagava para este volume. |
| **Sem Tailwind** | Tokens em CSS custom properties (`src/styles/tokens.css`). As preferências de aparência (roxo, brilho, opacidade, velocidade) mudam variáveis em tempo real; não há classes geradas para manter. |
| **Notch** | Encostada no topo (`offsetY = 0`, sem arrasto), a cápsula anima só os raios de baixo — os de cima ficam em 0 — e duas "orelhas" (`.vt-ear`, quarto de círculo vazado de 12 px por `radial-gradient`) acompanham as laterais pela mesma mola. Afastada do topo (arrastada), volta a ser pílula. |
| **Mascote** | Arte da marca em `src/assets/mascot/` (WebP redimensionado). Olhos no repouso (piscam, seguem o cursor), cabeça na moldura, corpo nos estados vazios e no instalador; o ícone do app é a cabeça sobre um quadrado ameixa (`assets/icon-source.png`). |
| **Fontes de mídia** | `src/features/media/filter.ts`: entram players conhecidos (por marca), abas de navegador com artista/canal ou duração ≥ 30 s e, se o usuário quiser, outros players de música/vídeo. Chamadas, chats e jogos ficam fora; o usuário pode ocultar qualquer fonte. |
| **Conversor** | `tools.rs` chama o `ffmpeg.exe` embutido (recurso do bundle) com argumentos montados por lista fechada de destinos por tipo; progresso lido de `-progress pipe:1`; saída nunca sobrescreve (`nome (VANTA).ext`, numerado). Processo sem janela (`CREATE_NO_WINDOW`), cancelável. |
| **Downloader** | yt-dlp oficial baixado sob demanda para a pasta de dados com `curl.exe` (vem no Windows) e conferido contra o `SHA2-256SUMS` da mesma release antes de virar executável. Só URLs `https` de sites de vídeo; progresso lido da saída. O vigia de área de transferência usa `GetClipboardSequenceNumber` e só emite evento quando o texto copiado é link de vídeo — o texto não é guardado. |
| **Motion** | Uma única superfície (`motion.div`) anima `width/height/raios` por mola; o conteúdo entra/sai com opacidade, escala e desfoque. `MotionConfig.reducedMotion` segue a preferência (sistema/sempre/nunca). |
| **Letras via LRCLIB** | `Windows.Web.Http` (sem dependência nova): `/api/get` com duração; se não houver, `/api/search` e o resultado de duração mais próxima (≤ 4 s), preferindo sincronizada; nova tentativa em 429/503; cache em memória e em disco (falta de letra expira em 3 dias). Pré-carregada na troca de faixa (700 ms de espera) para o botão já saber se há letra. |
| **Mover e voltar** | Arrasto pelo corpo move a janela nativa (`island_set_position`, por quadro); 5 s depois de soltar, `island_return_home` anima de volta por uma thread com *easeOutBack*. |
| **Redimensionar** | Alças nas bordas; o lado oposto fica parado durante o arrasto (deslocamento = metade do crescimento) e, ao soltar, o deslocamento anima para 0 (recentraliza). Tamanho salvo por módulo na chave `layout`. |
| **Configurações na ilha** | Não há segunda janela: a cápsula se amplia (1000×640) e mostra as categorias; diálogos nativos não a fecham. |
| **Instalador personalizado** | App Tauri próprio (`installer/`) que embute o NSIS oficial (`include_bytes!`), roda-o com `/S` e aplica as opções (Run em HKCU, atalho via `IShellLinkW`). As fases mostradas são as reais (preparar, instalar, configurar). |
| **Extensão opcional** | Native Messaging → o próprio `VANTA.exe` em modo host (detectado pelos argumentos do navegador) → pipe nomeado com DACL só do dono + SYSTEM, `PIPE_REJECT_REMOTE_CLIENTS`, `first_pipe_instance`. Mensagens com tipos fechados (`deny_unknown_fields`), limites de tamanho, domínio na lista de sites suportados, URL `https` do mesmo site. Nenhuma porta de rede. |

## Máquina de estados da cápsula

Prioridade da vista compacta (`src/features/island/machine.ts`):

```
alerta ao vivo  >  espiar faixa nova  >  conversão/download rodando  >  mídia tocando
  >  mídia pausada (2 min)  >  ociosa (após N min)  >  repouso (olhos | resumo)
```

Expandida: `music (+ letra ao lado) · convert · download · tasks · water · notifications`,
volta ao último módulo usado,
navegação por pontos, setas, grade de módulos, teclas ←/→ e 1–9, Esc recolhe.

## Segurança

- CSP restrita (`default-src 'self'`, sem scripts externos, imagens só `self/data/blob`).
- Capacidades Tauri mínimas: diálogos de arquivo e autostart. Abrir arquivo/URL, notificação e atalho global passam por comandos Rust validados.
- `open_uri`: lista fechada de `ms-settings:` + `https://` sem espaços.
- Conversor: entrada só de arquivo local existente; argumentos do FFmpeg por lista fechada (sem string de usuário no comando).
- Downloader: binário verificado por SHA-256 antes do primeiro uso; URL só `https`, passada como argumento após `--`.
- Nenhuma telemetria, conta ou servidor.
