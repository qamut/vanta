# VANTA 1.0.0 — validação executada

Ambiente: Windows 11 Pro 10.0.26200 x64, AMD Ryzen 5 1600, 16 GB, monitor 1920×1080 a 100%,
WebView2 155.0.4283.62, Rust 1.98.1 (MSVC), Node 24.14. Data: 2026-10-25.

Tudo abaixo foi **executado**, não estimado. O que não pôde ser executado está na última seção.

## Código

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) | 0 erros — confirmado com uma sonda de erro proposital, que foi detectada |
| `eslint .` (typescript-eslint strict + react-hooks 7) | 0 problemas |
| `vitest run` | 9 arquivos, **41 testes** passando (máquina de estados, Pomodoro, água, tarefas, LRC, seleção/mesclagem de mídia, preferências, atalho, traduções, painel de tarefas com Testing Library) |
| `cargo clippy --all-targets` | 0 avisos |
| `cargo test` | **24 testes** passando (store atômico e quarentena, alarmes, nomes de apps, relógio do Windows, ordinais de sessão, cache de capa, MIME por *magic bytes*, protocolo da ponte e validação de abas, detecção do host, URIs permitidas, caminhos da Shelf, normalização de letras, áudio) |
| `vite build` | ok |
| `tauri build` | ok — NSIS + 2 MSI |

## Aplicativo real (modo desenvolvimento e instalado)

| Verificação | Como | Resultado |
|---|---|---|
| Janela da cápsula transparente, sem moldura, no topo e centralizada | captura de tela | ok — posicionada em 570,6 (780×400) no monitor 1920×1080 |
| Mídia real (Spotify) | captura | título, artista · álbum, capa, origem "Spotify", linha do tempo e onda corretos; troca de faixa refletida sem reiniciar a janela |
| Identificação da origem | log | `"Spotify.exe" -> "Spotify" (table)` |
| Expansão por hover e navegação por setas/pontos | ponteiro programático + captura | ok nos 9 módulos |
| Clique não rouba foco; campo de texto pega o teclado | `GetForegroundWindow` antes/depois | antes: outro app; depois do clique no campo: `vanta`; tarefa criada pelo teclado |
| Áudio | captura | saída padrão real (VB-Audio Voicemeeter VAIO, "Virtual", volume 1 %, +9 saídas); bateria declarada indisponível |
| Energia em desktop | captura | "Sem bateria" em vez de porcentagem inventada |
| Lembrete de água → notificação na central e na cápsula | captura | ok (e corrigido: disparava ~1 min após abrir; agora 1 intervalo depois, com 5 min de folga quando atrasado) |
| Persistência | arquivos em `%APPDATA%\app.vanta.island\data` | `tasks.json`, `notifications.json`, `alarms.json` gravados atomicamente |
| Ponte do navegador | `tests/native-host-sim.mjs`: simulação do Chrome contra o `vanta.exe` instalado (Native Messaging) | app registrou "extensão conectada (chrome)" e "desconectada"; mensagens fora do protocolo descartadas |

### Defeitos encontrados pela validação e corrigidos

1. Fundo com alfa 96 % deixava o conteúdo de trás aparecer; padrão passou a 100 % (opacidade continua configurável).
2. Botões do painel de água invadiam o gráfico.
3. Data com capitalização errada ("Dom., 25 De Out.").
4. Plural ausente ("1 notificações").
5. Lembrete de água disparava logo após abrir o app.
6. **Host de Native Messaging não terminava** quando o navegador fechava a porta e podia travar a escrita (E/S síncrona serializada no mesmo handle do pipe). Reescrito com pipe *overlapped* (Tokio).
7. Log acusava `favicon.ico` ausente.

## Instalador

| Verificação | Resultado |
|---|---|
| `VANTA_1.0.0_x64-setup.exe /S` | código 0; instala em `%LOCALAPPDATA%\VANTA` (sem administrador) |
| Arquivos | `vanta.exe`, `uninstall.exe`, `browser-extension\{chromium,firefox}` |
| Registro de desinstalação | HKCU `Uninstall\VANTA` com versão 1.0.0 |
| Atalho | Menu Iniciar → `VANTA.lnk` |
| Executa fora do ambiente de desenvolvimento | sim (sem Node/Rust) |
| Assinatura | **não assinado** (`Get-AuthenticodeSignature`: NotSigned) |

## Consumo medido (instalado, Spotify tocando, cápsula compacta, 10 s)

| Processo | Working set |
|---|---|
| `vanta.exe` | 44 MB |
| WebView2 (navegador, GPU, renderizador, 2 utilitários) | 118 + 100 + 108 + 35 + 19 MB |
| **Total** | **~425 MB working set / ~314 MB privados**; CPU ≈ 0 % no intervalo |

O peso é dominado pelo WebView2 (Chromium). É o custo da interface web; o núcleo Rust usa 44 MB.

## Não validado neste ambiente (e por quê)

- **Comandos de mídia em sessão real (pausar/próxima/buscar):** a única sessão disponível era o
  Spotify do usuário em uso; interromper a música dele não era aceitável. O caminho de comando está
  coberto por tipos e pela validação Rust, mas não foi exercido ponta a ponta aqui.
- **Extensão carregada num navegador de verdade** (Chrome/Edge com YouTube, Netflix, Prime Video,
  Spotify Web, YouTube Music): exige instalar a extensão no navegador do usuário; o protocolo foi
  validado com um navegador simulado contra o executável instalado.
- **Registro do host em HKCU** (botão "Registrar ponte"): não acionado para não alterar o registro do
  usuário sem ele pedir.
- **Notebook com bateria, fones Bluetooth, múltiplos monitores e escalas ≠ 100 %:** hardware não
  disponível. O código trata DPI por monitor e reposiciona ao mudar a geometria.
- **Tela cheia (ocultar em jogos/vídeos):** usa `SHQueryUserNotificationState`; não exercido.
- **Instalação MSI:** gerada, não instalada (o NSIS foi o instalador validado).
- **Leitor de tela:** rótulos ARIA presentes, sem teste com NVDA/Narrador.

---

# Rodada 2 (feedback do usuário, 2026-10-25)

| Pedido | Implementado | Como foi verificado |
|---|---|---|
| Laterais mais afastadas; setas longe do conteúdo | calhas de 64 px; setas surgem no hover da moldura | CSS / revisão visual pendente do usuário |
| Indicador de páginas com respiro e centralizado | 16 px de folga; controles do player centralizados na largura total | idem |
| Letras online, botão desativado sem letra | LRCLIB (`/api/get` + `/api/search`, nova tentativa em 503, cache) com pré-carga | contrato confirmado na API ao vivo; na máquina, a faixa tocando teve **letra sincronizada de 63 linhas** gravada no cache |
| Microfone como alternador | um clique abre, outro volta ao player | teste de unidade do redutor + revisão |
| Remover importação de letras | removida (Rust e interface) | busca no código |
| Ícones autorais duotone | família própria com ~70 ícones; Lucide removido das dependências | `npm uninstall`, typecheck |
| Animações nível motion design | mola única da casa, troca de módulo direcional com desfoque, cascata dos blocos, capa com rotação/escala, letras com foco/desfoque por distância, olhos que seguem o cursor, antecipação no hover | revisão visual pendente do usuário |
| Redimensionar pelas bordas e recentralizar | alças; lado oposto fixo durante o arrasto; recentraliza ao soltar; tamanho salvo por módulo | teste de `clampCustom` |
| Instalador personalizado | `VANTA-Setup-1.0.0.exe` (app próprio que embute o NSIS) | instalação silenciosa: código 0 em 5 s, atalho na área de trabalho criado, inicialização com o Windows **não** ligada (`--no-autostart`) |
| Configurações dentro da ilha | janela separada removida; a cápsula amplia para 1000×640 | evento real simulado por CDP abriu o modo `is-settings` |
| Mover a ilha e voltar em 5 s | arrasto move a janela nativa; barra de contagem; volta com animação | revisão; não exercido fisicamente para não interferir no uso do usuário |
| Lembrar o módulo ao reabrir | `defaultModule` devolve o último usado | teste de unidade |
| Sem bateria, sem opção de bateria | módulo Energia some; anel de bateria só com bateria | teste de unidade |
| Notificações vazias | texto centralizado "Nenhuma notificação por agora" | revisão |
| Expandir só ao passar POR CIMA | área de hover = exatamente a cápsula, sem folga | ver defeito abaixo |

### Defeito encontrado e corrigido nesta rodada

**Hover não expandia no app instalado.** Diagnóstico com depuração remota do WebView2 (CDP, sem
mover o mouse): o evento de hover simulado expandia normalmente; o sensor nativo não reconhecia o
ponteiro. Causa: no build de produção a página carrega antes de o Rust redimensionar a janela
(780 → 1200 px), e a área de hover era calculada com a largura antiga. Correção: o comando
`island_geometry` devolve o tamanho lógico real e a interface o consulta ao montar e a cada
`onResized`.
