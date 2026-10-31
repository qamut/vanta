// Baixa o FFmpeg que vai dentro do VANTA, sempre a MESMA build (a GPL exige apontar o código-fonte
// exato do que se distribui; "latest" mudaria por baixo). Confere o SHA-256 antes de usar.
// Trocar de versão = mudar as três constantes e o src-tauri/bin/FFMPEG-NOTICE.txt juntos.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "autobuild-2026-10-30-13-01";
const ASSET = "ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1";
const SHA256 = "7665652ac078f07fbc6e726bf2123e401c242f0771d5a6e5aa56d9e0cdb6a744";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "bin");
const tmp = mkdtempSync(join(tmpdir(), "vanta-ffmpeg-"));
try {
  const zip = join(tmp, `${ASSET}.zip`);
  const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}/${ASSET}.zip`;
  execFileSync("curl.exe", ["-L", "--fail", "--silent", "--show-error", "-o", zip, url], { stdio: "inherit" });
  const got = createHash("sha256").update(readFileSync(zip)).digest("hex");
  if (got !== SHA256) throw new Error(`SHA-256 não confere: ${got}`);
  execFileSync("tar.exe", ["-xf", zip, "-C", tmp], { stdio: "inherit" });
  copyFileSync(join(tmp, ASSET, "bin", "ffmpeg.exe"), join(bin, "ffmpeg.exe"));
  copyFileSync(join(tmp, ASSET, "LICENSE.txt"), join(bin, "FFMPEG-LICENSE.txt"));
  console.log(`FFmpeg ${ASSET} em ${bin}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
