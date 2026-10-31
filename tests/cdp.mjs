// Cliente CDP mínimo para inspecionar a cápsula em modo desenvolvimento, sem mexer no mouse.
// Uso: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run desktop
//      node tests/cdp.mjs "<expressão JS>" [<expressão JS> ...]
const port = process.env.CDP_PORT ?? "9333";
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((p) => p.url.includes("island.html"));
if (!page) throw new Error("página da ilha não encontrada");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    console.log(`[console.${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description).join(" "));
  } else if (msg.method === "Runtime.exceptionThrown") {
    console.log("[exceção]", msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
await send("Runtime.enable");
for (const expr of process.argv.slice(2)) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result?.result;
  console.log(">", expr.slice(0, 90), "\n ", JSON.stringify(v?.value ?? v?.description ?? r.result?.exceptionDetails?.text));
}
await new Promise((r) => setTimeout(r, Number(process.env.CDP_WAIT ?? 300)));
ws.close();
