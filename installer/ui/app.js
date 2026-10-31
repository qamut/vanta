// Interface do instalador. Fala só com os três comandos do processo nativo.
(() => {
  const T = window.__TAURI__;
  const card = document.querySelector(".card");
  const $ = (id) => document.getElementById(id);
  const order = ["prepare", "install", "configure", "done"];
  const progress = { prepare: 0.18, install: 0.62, configure: 0.88, done: 1 };
  const labels = { prepare: "Preparando…", install: "Instalando…", configure: "Configurando…", done: "Concluído" };

  const setState = (s) => (card.dataset.state = s);
  const setPhase = (phase) => {
    const idx = order.indexOf(phase);
    document.querySelectorAll(".steps li").forEach((li, i) => {
      li.classList.toggle("is-done", i < idx || phase === "done");
      li.classList.toggle("is-active", i === idx && phase !== "done");
    });
    card.style.setProperty("--progress", String(progress[phase] ?? 0.06));
    $("stepLabel").textContent = labels[phase] ?? "Preparando…";
  };

  $("min").addEventListener("click", () => T?.window.getCurrentWindow().minimize());
  $("close").addEventListener("click", () => T?.window.getCurrentWindow().close());
  $("finish").addEventListener("click", () => T?.window.getCurrentWindow().close());
  $("cancel").addEventListener("click", () => T?.window.getCurrentWindow().close());

  async function boot() {
    if (!T) return;
    const info = await T.core.invoke("setup_info");
    $("version").textContent = info.version;
    if (info.installedVersion !== null) {
      $("ctaLabel").textContent = info.installedVersion === info.version ? "Reinstalar" : "Atualizar";
      $("tagline").textContent =
        info.installedVersion && info.installedVersion !== info.version
          ? `Atualizar da versão ${info.installedVersion} para a ${info.version}.`
          : "O VANTA já está neste computador.";
    }
    $("where").textContent = `Pasta: ${info.installDir}`;
    if (!info.payloadOk) {
      $("error").textContent = "Este instalador foi gerado sem o pacote do VANTA.";
      setState("error");
      $("retry").hidden = true;
    }
    await T.event.listen("setup://phase", (e) => setPhase(e.payload.phase));
  }

  async function install() {
    setState("working");
    setPhase("prepare");
    try {
      await T.core.invoke("install", {
        options: { autostart: $("optAutostart").checked, desktop: $("optDesktop").checked },
      });
      setPhase("done");
      setTimeout(() => setState("done"), 450);
    } catch (err) {
      $("error").textContent = String(err);
      setState("error");
    }
  }

  $("install").addEventListener("click", install);
  $("retry").addEventListener("click", install);
  $("launch").addEventListener("click", async () => {
    try {
      await T.core.invoke("launch");
      setTimeout(() => T.window.getCurrentWindow().close(), 500);
    } catch (err) {
      $("error").textContent = String(err);
      setState("error");
    }
  });

  boot();
})();
