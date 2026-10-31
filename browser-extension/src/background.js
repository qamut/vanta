// VANTA Media Bridge — processo de fundo.
// Só abre a porta nativa quando alguma aba suportada reporta mídia; não observa outras abas
// e não tem a permissão "tabs" (não enxerga URL nem título de abas fora dos sites listados).
const api = globalThis.browser ?? globalThis.chrome;
const HOST = "app.vanta.bridge";
let port = null;
let offlineUntil = 0;
const reporting = new Set();

function browserName() {
  if (typeof globalThis.browser !== "undefined" && api.runtime.getBrowserInfo) return "firefox";
  if (navigator.brave) return "brave";
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
  if (brands.some((b) => /Edge/i.test(b))) return "edge";
  if (brands.some((b) => /Opera/i.test(b))) return "opera";
  return "chrome";
}

function connect() {
  if (port || Date.now() < offlineUntil) return port;
  try {
    port = api.runtime.connectNative(HOST);
  } catch {
    offlineUntil = Date.now() + 15000;
    return null;
  }
  port.onMessage.addListener(onAppMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    // O VANTA fechou ou o host não está registrado: tenta de novo depois.
    offlineUntil = Date.now() + 15000;
  });
  port.postMessage({ type: "hello", browser: browserName(), version: api.runtime.getManifest().version });
  return port;
}

function send(msg) {
  const p = connect();
  try {
    p?.postMessage(msg);
  } catch {
    port = null;
  }
}

function onAppMessage(msg) {
  if (msg?.type === "ping") {
    port?.postMessage({ type: "pong", nonce: msg.nonce });
  } else if (msg?.type === "command" && Number.isInteger(msg.tabId) && reporting.has(msg.tabId)) {
    api.tabs.sendMessage(msg.tabId, { kind: "command", action: msg.action, positionMs: msg.positionMs }).catch(() => {});
  } else if (msg?.type === "status" && msg.state === "app-offline") {
    offlineUntil = Date.now() + 15000;
  }
}

api.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || sender.id !== api.runtime.id) return;
  if (msg?.kind === "media") {
    reporting.add(tabId);
    send({
      type: "media",
      tabId,
      domain: String(msg.domain || ""),
      title: String(msg.title || ""),
      artist: String(msg.artist || ""),
      album: String(msg.album || ""),
      url: String(msg.url || ""),
      artworkUrl: String(msg.artworkUrl || ""),
      playing: !!msg.playing,
      positionMs: typeof msg.positionMs === "number" ? msg.positionMs : null,
      durationMs: typeof msg.durationMs === "number" ? msg.durationMs : null,
      canSeek: !!msg.canSeek,
      canNext: !!msg.canNext,
      canPrevious: !!msg.canPrevious,
    });
  } else if (msg?.kind === "gone" && reporting.delete(tabId)) {
    send({ type: "gone", tabId });
  }
});

api.tabs.onRemoved.addListener((tabId) => {
  if (reporting.delete(tabId) && port) port.postMessage({ type: "gone", tabId });
});
