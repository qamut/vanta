// Baixa os binários que vão dentro do VANTA, sempre a MESMA build por sistema (a GPL exige apontar
// o código-fonte exato do que se distribui; "latest" mudaria por baixo) e confere o SHA-256.
//   Windows: FFmpeg (BtbN)                     · renderiza PDF com o próprio Windows
//   Linux:   FFmpeg (BtbN)   + PDFium (bblanchon/pdfium-binaries)
//   macOS:   FFmpeg (martin-riedl.de) + PDFium
// Trocar de versão = mudar a tabela e o aviso (NOTICE) juntos.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "bin");
const arch = process.arch === "arm64" ? "arm64" : "x64";

const BTBN_TAG = "autobuild-2026-10-30-13-01";
const BTBN = (asset) => `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BTBN_TAG}/${asset}`;
const PDFIUM_TAG = "chromium%2F8125";
const PDFIUM = (asset) => `https://github.com/bblanchon/pdfium-binaries/releases/download/${PDFIUM_TAG}/${asset}`;

const PLAN = {
  win32: {
    ffmpeg: { url: BTBN("ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip"), sha256: "7665652ac078f07fbc6e726bf2123e401c242f0771d5a6e5aa56d9e0cdb6a744", file: "ffmpeg.exe" },
  },
  linux: {
    ffmpeg: { url: BTBN("ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz"), sha256: "0912d9de5837ae3fbeb98c54e5a5886ac7fcb68aee7d7d1cfcd2d20c505eccf2", file: "ffmpeg" },
    pdfium: { url: PDFIUM("pdfium-linux-x64.tgz"), sha256: "e1c3ce6e270cb5e0c20816b379ad9f2c1309972697c505f508de92bf5e7d6659", file: "libpdfium.so" },
  },
  darwin: {
    ffmpeg:
      arch === "arm64"
        ? { url: "https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip", sha256: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924", file: "ffmpeg" }
        : { url: "https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip", sha256: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4", file: "ffmpeg" },
    pdfium:
      arch === "arm64"
        ? { url: PDFIUM("pdfium-mac-arm64.tgz"), sha256: "4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d", file: "libpdfium.dylib" }
        : { url: PDFIUM("pdfium-mac-x64.tgz"), sha256: "8a5193535b80c7215d8932f6647ae5097465b6dba2811602c21e120c2af112b0", file: "libpdfium.dylib" },
  },
};

const NOTICE = {
  linux: `FFmpeg incluído no VANTA / FFmpeg bundled with VANTA (Linux)

Versão / Version: FFmpeg n8.1.3-27-g8dca1586f4 (build 2026-10-30), Linux x64, GPL
Build: BtbN/FFmpeg-Builds, release "${BTBN_TAG}", file "ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1.tar.xz"
Licença / License: GNU General Public License v3 (FFMPEG-LICENSE.txt)

Código-fonte correspondente / Corresponding source:
  - https://github.com/FFmpeg/FFmpeg/tree/8dca1586f4
  - https://github.com/BtbN/FFmpeg-Builds/tree/${BTBN_TAG}
`,
  darwin: `FFmpeg incluído no VANTA / FFmpeg bundled with VANTA (macOS)

Versão / Version: FFmpeg 9.0.2, macOS ${arch === "arm64" ? "Apple Silicon (arm64)" : "Intel (x86_64)"}, GPL
Build: https://ffmpeg.martin-riedl.de (static build, ${PLAN.darwin.ffmpeg.url})
Licença / License: GNU General Public License v3 (FFMPEG-LICENSE.txt)

Código-fonte correspondente / Corresponding source:
  - https://github.com/FFmpeg/FFmpeg/tree/n9.0.2
  - Roteiros de build e versões das bibliotecas / build scripts and library versions: https://ffmpeg.martin-riedl.de
`,
};
const OFFER = `
Pedido do código-fonte completo / Request for the complete source:
  Por pelo menos três anos a partir desta distribuição, qualquer pessoa pode pedir uma cópia
  completa do código-fonte correspondente deste FFmpeg escrevendo para hi@notrix.com.br.
  For at least three years from this distribution, anyone may request a complete copy of the
  corresponding source of this FFmpeg by writing to hi@notrix.com.br.

O VANTA executa o ffmpeg como programa separado; ele não é parte do código do VANTA.
VANTA runs ffmpeg as a separate program; it is not part of VANTA's code.
`;

const plan = PLAN[process.platform];
if (!plan) throw new Error(`sistema sem binários definidos: ${process.platform}`);

function fetchChecked(item, dir) {
  const name = decodeURIComponent(item.url.split("/").pop());
  const out = join(dir, name);
  execFileSync(process.platform === "win32" ? "curl.exe" : "curl", ["-L", "--fail", "--silent", "--show-error", "-o", out, item.url], { stdio: "inherit" });
  const got = createHash("sha256").update(readFileSync(out)).digest("hex");
  if (got !== item.sha256) throw new Error(`SHA-256 não confere para ${name}: ${got}`);
  const into = join(dir, "x");
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  // No Windows, o tar do sistema (bsdtar): o GNU tar do Git Bash lê "E:" como nome de servidor.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", out, "-C", into], { stdio: "inherit" });
  return into;
}

/** Procura um arquivo pelo nome dentro do que foi extraído. */
function find(dir, name) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (e === name) {
      return p;
    }
  }
  return null;
}

const tmp = mkdtempSync(join(tmpdir(), "vanta-bin-"));
try {
  const ff = fetchChecked(plan.ffmpeg, tmp);
  const ffmpeg = find(ff, plan.ffmpeg.file);
  if (!ffmpeg) throw new Error("ffmpeg não encontrado no pacote");
  copyFileSync(ffmpeg, join(bin, plan.ffmpeg.file));
  const lic = find(ff, "LICENSE.txt");
  if (lic) copyFileSync(lic, join(bin, "FFMPEG-LICENSE.txt"));
  if (NOTICE[process.platform]) writeFileSync(join(bin, "FFMPEG-NOTICE.txt"), NOTICE[process.platform] + OFFER);
  if (plan.pdfium) {
    const pd = fetchChecked(plan.pdfium, tmp);
    const lib = find(pd, plan.pdfium.file);
    if (!lib) throw new Error("PDFium não encontrado no pacote");
    copyFileSync(lib, join(bin, plan.pdfium.file));
    const plic = find(pd, "LICENSE");
    if (plic) copyFileSync(plic, join(bin, "PDFIUM-LICENSE.txt"));
  }
  if (process.platform !== "win32") execFileSync("chmod", ["+x", join(bin, plan.ffmpeg.file)]);
  console.log(`binários de ${process.platform}/${arch} em ${bin}`);
  if (!existsSync(join(bin, plan.ffmpeg.file))) process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
