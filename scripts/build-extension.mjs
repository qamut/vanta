// Monta a extensão "VANTA Media Bridge" em browser-extension/dist/{chromium,firefox}.
// A lista de sites espelha SUPPORTED_SITES em src-tauri/src/bridge/proto.rs.
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "browser-extension", "src");
const dist = join(root, "browser-extension", "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { key, id } = JSON.parse(readFileSync(join(root, "browser-extension", "key.public.json"), "utf8"));

const MATCHES = [
  "https://*.youtube.com/*",
  "https://music.youtube.com/*",
  "https://*.netflix.com/*",
  "https://*.primevideo.com/*",
  "https://*.amazon.com/gp/video/*",
  "https://*.amazon.com.br/gp/video/*",
  "https://open.spotify.com/*",
  "https://music.apple.com/*",
  "https://*.twitch.tv/*",
  "https://soundcloud.com/*",
  "https://*.deezer.com/*",
  "https://listen.tidal.com/*",
  "https://*.disneyplus.com/*",
  "https://play.max.com/*",
  "https://globoplay.globo.com/*",
  "https://vimeo.com/*",
];

const base = {
  manifest_version: 3,
  name: "VANTA Media Bridge",
  short_name: "VANTA",
  version: pkg.version,
  description: "Mostra no VANTA o site que está tocando mídia (YouTube, Netflix, Spotify Web…). Tudo fica no seu computador.",
  icons: { 32: "icons/32.png", 128: "icons/128.png" },
  permissions: ["nativeMessaging"],
  host_permissions: MATCHES,
  content_scripts: [{ matches: MATCHES, js: ["content.js"], run_at: "document_idle", all_frames: false }],
};

const chromium = { ...base, key, minimum_chrome_version: "110", background: { service_worker: "background.js" } };
const firefox = {
  ...base,
  background: { scripts: ["background.js"] },
  browser_specific_settings: { gecko: { id: "media-bridge@vanta.app", strict_min_version: "115.0" } },
};

for (const [name, manifest] of [["chromium", chromium], ["firefox", firefox]]) {
  const out = join(dist, name);
  mkdirSync(join(out, "icons"), { recursive: true });
  cpSync(join(src, "content.js"), join(out, "content.js"));
  cpSync(join(src, "background.js"), join(out, "background.js"));
  const icons = join(root, "src-tauri", "icons");
  if (existsSync(join(icons, "32x32.png"))) {
    cpSync(join(icons, "32x32.png"), join(out, "icons", "32.png"));
    cpSync(join(icons, "128x128.png"), join(out, "icons", "128.png"));
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
writeFileSync(
  join(dist, "LEIA-ME.txt"),
  [
    "VANTA Media Bridge",
    "",
    "Chrome / Edge / Brave:",
    "  1. Abra chrome://extensions (ou edge://extensions, brave://extensions).",
    "  2. Ative o 'Modo do desenvolvedor'.",
    "  3. Clique em 'Carregar sem compactação' e escolha a pasta 'chromium' ao lado deste arquivo.",
    `  4. O ID mostrado deve ser ${id}.`,
    "",
    "Firefox:",
    "  1. Abra about:debugging#/runtime/this-firefox.",
    "  2. 'Carregar extensão temporária' e escolha firefox/manifest.json.",
    "  3. Em about:addons, conceda o acesso aos sites (o Firefox pede permissão de host no MV3).",
    "  Observação: extensões temporárias do Firefox saem ao fechar o navegador.",
    "",
    "Depois, no VANTA: Configurações > Navegadores > Registrar ponte e Testar comunicação.",
    "",
  ].join("\r\n"),
);
console.log(`extensão montada em ${dist} (id Chromium ${id})`);
