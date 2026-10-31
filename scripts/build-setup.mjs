// Monta o instalador personalizado: compila o app (gera o NSIS oficial), embute esse
// NSIS no "VANTA Setup" e copia o resultado para release/.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = (await import("../package.json", { with: { type: "json" } })).default;
const version = pkg.version;
const target = join(root, "src-tauri", "target");
const nsis = join(target, "release", "bundle", "nsis", `VANTA_${version}_x64-setup.exe`);
const skipApp = process.argv.includes("--skip-app");

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

if (!skipApp) {
  run("node scripts/build-extension.mjs", root);
  run("npx tauri build", root);
}
if (!existsSync(nsis)) throw new Error(`instalador NSIS não encontrado: ${nsis}`);

// Mesmo diretório de compilação do app: as dependências já compiladas são reaproveitadas.
run("npx tauri build --no-bundle", join(root, "installer"), { VANTA_PAYLOAD: nsis, CARGO_TARGET_DIR: target });

const built = join(target, "release", "vanta-setup.exe");
mkdirSync(join(root, "release"), { recursive: true });
const out = join(root, "release", `VANTA-Setup-${version}.exe`);
copyFileSync(built, out);
copyFileSync(nsis, join(root, "release", `VANTA_${version}_x64-nsis.exe`));
const msi = join(target, "release", "bundle", "msi", `VANTA_${version}_x64_pt-BR.msi`);
if (existsSync(msi)) copyFileSync(msi, join(root, "release", `VANTA_${version}_x64_pt-BR.msi`));
console.log(`\nInstalador personalizado: ${out} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
