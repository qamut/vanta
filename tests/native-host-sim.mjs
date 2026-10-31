// Simula o navegador: inicia o VANTA em modo host de Native Messaging, envia quadros
// (hello, mídia válida, mídia de domínio proibido, lixo) e mostra o que o host devolve.
import { spawn } from "node:child_process";

const exe = process.argv[2];
const origin = "chrome-extension://oljgdogjbdlpekdianjiekfmopfegkfp/";
const child = spawn(exe, [origin, "--parent-window=0"], { stdio: ["pipe", "pipe", "inherit"] });

const frame = (obj) => {
  const body = Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
};

let out = Buffer.alloc(0);
child.stdout.on("data", (d) => {
  out = Buffer.concat([out, d]);
  while (out.length >= 4) {
    const n = out.readUInt32LE(0);
    if (out.length < 4 + n) break;
    console.log("host ->", out.subarray(4, 4 + n).toString());
    out = out.subarray(4 + n);
  }
});
child.on("exit", (code) => console.log("host saiu com", code));

child.stdin.write(frame({ type: "hello", browser: "chrome", version: "1.0.0" }));
child.stdin.write(frame({
  type: "media", tabId: 42, domain: "www.youtube.com", title: "Teste da ponte VANTA", artist: "Canal",
  url: "https://www.youtube.com/watch?v=test", artworkUrl: "", playing: true, positionMs: 1000, durationMs: 60000,
  canSeek: true, canNext: true, canPrevious: false,
}));
child.stdin.write(frame({ type: "media", tabId: 7, domain: "evil.example", title: "x", playing: true, positionMs: null, durationMs: null }));
child.stdin.write(frame("isto não é json"));
setTimeout(() => {
  child.stdin.end();
}, Number(process.argv[3] ?? 2500));
