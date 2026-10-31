// VANTA — landing page: a ilha que troca de módulo, o feixe de luz, as entradas ao rolar e o vídeo.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- entradas ao rolar (em cascata dentro de cada bloco)
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
    el.style.setProperty("--d", `${Math.min(siblings.indexOf(el), 6) * 90}ms`);
    io.observe(el);
  });

  // ---------- a ilha: recortes reais do app, um por vez, com a "mola" da Dynamic Island
  const stage = document.querySelector(".stage");
  const shots = new Map([...document.querySelectorAll(".island img")].map((img) => [img.dataset.ui, img]));
  const tabs = [...document.querySelectorAll(".stage__tabs button")];
  for (const img of shots.values()) {
    const size = () => img.style.setProperty("--w", img.naturalWidth / 2);
    img.complete ? size() : img.addEventListener("load", size, { once: true });
  }
  const SEQ = ["compact", "music", "compact", "download", "convert", "tasks", "water"];
  const DWELL = { compact: 1500, music: 4200 };
  let i = 0;
  let current = null;
  let timer = 0;
  let paused = false;

  const show = (name) => {
    if (name === current) return;
    const prev = shots.get(current);
    if (prev) {
      prev.classList.remove("is-on");
      prev.classList.add("is-off");
      setTimeout(() => prev.classList.remove("is-off"), 600);
    }
    shots.get(name)?.classList.add("is-on");
    current = name;
    const dwell = DWELL[name] ?? 3600;
    stage.style.setProperty("--dwell", `${dwell}ms`);
    for (const t of tabs) {
      const on = t.dataset.go === name;
      t.setAttribute("aria-selected", String(on));
      if (on) {
        // reinicia a barrinha de progresso da aba
        t.style.animation = "none";
        void t.offsetWidth;
        t.style.animation = "";
      }
    }
    return dwell;
  };
  const tick = () => {
    const dwell = show(SEQ[i % SEQ.length]) ?? 3600;
    i++;
    if (!reduced && !paused) timer = setTimeout(tick, dwell);
  };
  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      clearTimeout(timer);
      i = SEQ.indexOf(t.dataset.go) + 1;
      show(t.dataset.go);
      if (!reduced) timer = setTimeout(tick, 7000);
    }),
  );
  stage.addEventListener("mouseenter", () => {
    paused = true;
    stage.classList.add("is-paused");
    clearTimeout(timer);
  });
  stage.addEventListener("mouseleave", () => {
    paused = false;
    stage.classList.remove("is-paused");
    if (!reduced) timer = setTimeout(tick, 1200);
  });
  setTimeout(tick, reduced ? 0 : 700);
  if (reduced) show("music");

  // ---------- o feixe: luz violeta que desce do topo e acende a ilha
  const canvas = document.querySelector(".hero__beam");
  const ctx = canvas.getContext("2d");
  const hero = document.querySelector(".hero");
  const screen = document.querySelector(".stage__screen");
  let W = 0;
  let H = 0;
  let impactY = 0;
  let dpr = 1;
  const motes = [];
  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    impactY = screen.getBoundingClientRect().top - hero.getBoundingClientRect().top;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    motes.length = 0;
    const n = Math.round(Math.min(160, W / 8));
    for (let k = 0; k < n; k++) motes.push(newMote(true));
  };
  const newMote = (anywhere) => ({
    x: (Math.random() - 0.5) * (40 + Math.random() * 220),
    y: anywhere ? Math.random() * impactY : -10,
    v: 0.25 + Math.random() * 0.9,
    r: Math.random() * 1.4 + 0.3,
    p: Math.random() * Math.PI * 2,
  });

  const draw = (t) => {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const flick = 1 + Math.sin(t / 900) * 0.06 + Math.sin(t / 233) * 0.025;
    ctx.globalCompositeOperation = "lighter";

    // cone largo e suave; mais fraco por trás do texto, forte no topo e junto da ilha
    const coneW = Math.min(520, W * 0.5) * flick;
    const vert = ctx.createLinearGradient(0, 0, 0, impactY);
    vert.addColorStop(0, "rgba(167,139,250,0.30)");
    vert.addColorStop(0.18, "rgba(167,139,250,0.10)");
    vert.addColorStop(0.62, "rgba(167,139,250,0.06)");
    vert.addColorStop(1, "rgba(196,181,253,0.34)");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - coneW * 0.12, 0);
    ctx.lineTo(cx + coneW * 0.12, 0);
    ctx.lineTo(cx + coneW / 2, impactY);
    ctx.lineTo(cx - coneW / 2, impactY);
    ctx.closePath();
    ctx.clip();
    const horiz = ctx.createLinearGradient(cx - coneW / 2, 0, cx + coneW / 2, 0);
    horiz.addColorStop(0, "rgba(0,0,0,0)");
    horiz.addColorStop(0.5, "rgba(255,255,255,1)");
    horiz.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = vert;
    ctx.fillRect(cx - coneW / 2, 0, coneW, impactY);
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = horiz;
    ctx.fillRect(cx - coneW / 2, 0, coneW, impactY);
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";

    // núcleo: um fio de luz quase branco
    const core = ctx.createLinearGradient(0, 0, 0, impactY);
    core.addColorStop(0, "rgba(255,255,255,0.55)");
    core.addColorStop(0.25, "rgba(221,214,254,0.12)");
    core.addColorStop(0.7, "rgba(221,214,254,0.10)");
    core.addColorStop(1, "rgba(255,255,255,0.75)");
    ctx.fillStyle = core;
    const cw = 2.2 * flick;
    ctx.fillRect(cx - cw / 2, 0, cw, impactY);

    // o clarão onde a luz encontra a ilha
    const g = ctx.createRadialGradient(cx, impactY, 0, cx, impactY, Math.min(560, W * 0.55));
    g.addColorStop(0, `rgba(255,255,255,${0.55 * flick})`);
    g.addColorStop(0.08, "rgba(196,181,253,0.42)");
    g.addColorStop(0.35, "rgba(139,92,246,0.16)");
    g.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, impactY);
    ctx.scale(1, 0.32);
    ctx.translate(-cx, -impactY);
    ctx.fillRect(0, impactY - 600, W, 1200);
    ctx.restore();

    // poeira de luz caindo no feixe
    for (const m of motes) {
      if (!reduced) {
        m.y += m.v;
        m.p += 0.03;
        if (m.y > impactY) Object.assign(m, newMote(false));
      }
      const spread = 0.12 + (m.y / impactY) * 0.88;
      const x = cx + m.x * spread;
      const a = (0.35 + Math.sin(m.p) * 0.35) * Math.min(1, m.y / 60);
      ctx.fillStyle = `rgba(233,226,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    if (!reduced && visible) requestAnimationFrame(draw);
  };
  let visible = true;
  new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was && !reduced) requestAnimationFrame(draw);
  }).observe(hero);
  addEventListener("resize", () => {
    resize();
    if (reduced) draw(0);
  });
  const start = () => {
    resize();
    requestAnimationFrame(draw);
  };
  document.readyState === "complete" ? start() : addEventListener("load", start);

  // ---------- vídeo
  const player = document.querySelector(".player");
  const film = document.getElementById("film");
  player.querySelector(".player__play").addEventListener("click", () => {
    player.classList.add("is-playing");
    film.play();
  });
  film.addEventListener("play", () => player.classList.add("is-playing"));
})();
