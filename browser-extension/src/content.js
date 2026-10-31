// VANTA Media Bridge — script de conteúdo.
// Roda só nos sites de streaming listados no manifesto. Lê apenas o estado do player
// (título, artista, posição, tocando/pausado) do elemento de mídia ativo. Não lê a página,
// formulários, cookies nem histórico.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const host = location.hostname.replace(/^www\./, "");

  // Seletores de próxima/anterior por site. Onde não há, o controle fica indisponível.
  const SKIP = {
    "music.youtube.com": { next: ".next-button", previous: ".previous-button" },
    "youtube.com": { next: ".ytp-next-button", previous: ".ytp-prev-button" },
    "open.spotify.com": {
      next: '[data-testid="control-button-skip-forward"]',
      previous: '[data-testid="control-button-skip-back"]',
    },
    "soundcloud.com": { next: ".skipControl__next", previous: ".skipControl__previous" },
    "deezer.com": { next: '[data-testid="next_track_button"]', previous: '[data-testid="previous_track_button"]' },
  };
  // Reposicionar via currentTime quebra o player destes serviços: busca desligada.
  const NO_SEEK = ["netflix.com", "primevideo.com", "amazon.com", "amazon.com.br", "disneyplus.com", "max.com"];

  const matches = (d) => host === d || host.endsWith("." + d);
  const skipKey = Object.keys(SKIP).find(matches);
  const skip = skipKey ? SKIP[skipKey] : {};
  const noSeek = NO_SEEK.some(matches);

  let last = "";
  let timer = 0;
  let wasReporting = false;

  function activeMedia() {
    const all = [...document.querySelectorAll("video, audio")].filter((m) => m.currentSrc || m.srcObject);
    const playing = all.filter((m) => !m.paused && !m.ended);
    const pool = playing.length ? playing : all.filter((m) => m.currentTime > 0);
    return pool.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
  }

  function metadata() {
    const md = navigator.mediaSession?.metadata;
    const art = [...(md?.artwork ?? [])]
      .filter((a) => typeof a.src === "string" && a.src.startsWith("https://"))
      .sort((a, b) => parseInt(b.sizes || "0", 10) - parseInt(a.sizes || "0", 10))[0];
    const fallback = document.title
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[-|–]\s*(YouTube Music|YouTube|Netflix|Spotify|Twitch|SoundCloud)\s*$/i, "")
      .trim();
    return {
      title: (md?.title || fallback || "").slice(0, 300),
      artist: (md?.artist || "").slice(0, 200),
      album: (md?.album || "").slice(0, 200),
      artworkUrl: art?.src ?? "",
    };
  }

  function report(force = false) {
    const el = activeMedia();
    if (!el) {
      if (wasReporting) {
        wasReporting = false;
        last = "";
        api.runtime.sendMessage({ kind: "gone" }).catch(() => {});
      }
      return;
    }
    const meta = metadata();
    const duration = Number.isFinite(el.duration) ? el.duration * 1000 : null;
    const payload = {
      kind: "media",
      domain: host,
      url: location.origin + location.pathname + location.search,
      ...meta,
      playing: !el.paused && !el.ended,
      positionMs: Math.max(0, el.currentTime * 1000),
      durationMs: duration,
      canSeek: !noSeek && duration !== null,
      canNext: !!(skip.next && document.querySelector(skip.next)),
      canPrevious: !!(skip.previous && document.querySelector(skip.previous)),
    };
    // A posição fica fora da assinatura: só reenvia quando algo além do tempo mudou,
    // ou no envio periódico que corrige o deslize da interpolação no VANTA.
    const sig = JSON.stringify({ ...payload, positionMs: 0 });
    if (!force && sig === last) return;
    last = sig;
    wasReporting = true;
    api.runtime.sendMessage(payload).catch(() => {});
  }

  function schedule() {
    clearInterval(timer);
    const el = activeMedia();
    if (el && !el.paused) timer = setInterval(() => report(true), 5000);
  }

  for (const ev of ["play", "pause", "ended", "loadedmetadata", "durationchange", "seeked", "emptied"]) {
    document.addEventListener(
      ev,
      () => {
        report(true);
        schedule();
      },
      true,
    );
  }
  // Troca de faixa em players de página única (YouTube Music, Spotify) sem evento de mídia.
  const titleEl = document.querySelector("title");
  if (titleEl) new MutationObserver(() => report()).observe(titleEl, { childList: true, characterData: true, subtree: true });

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.kind !== "command") return;
    const el = activeMedia();
    switch (msg.action) {
      case "play":
        el?.play().catch(() => {});
        break;
      case "pause":
        el?.pause();
        break;
      case "toggle":
        if (el) {
          if (el.paused) el.play().catch(() => {});
          else el.pause();
        }
        break;
      case "seek":
        if (el && !noSeek && Number.isFinite(msg.positionMs)) el.currentTime = Math.max(0, msg.positionMs / 1000);
        break;
      case "next":
        if (skip.next) document.querySelector(skip.next)?.click();
        break;
      case "previous":
        if (skip.previous) document.querySelector(skip.previous)?.click();
        break;
    }
    setTimeout(() => report(true), 300);
  });

  report(true);
  schedule();
})();
