import { ColorPanels, GodRays, GrainGradient, MeshGradient } from "@paper-design/shaders-react";
import { ArrowDownToLine, ArrowRight, Check, Copy, Star, Volume2, VolumeX } from "lucide-react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { siApplemusic, siItunes, siMax, siNetflix, siSoundcloud, siSpotify, siTidal, siTwitch, siVimeo, siVlcmediaplayer, siYoutube, siYoutubemusic } from "simple-icons";

import { Link001, Link003 } from "@/components/ui/skiper-ui/skiper40";
import { cn } from "@/lib/utils";

const REPO = "https://github.com/qamut/vanta";
const DOWNLOAD = "download/VANTA-Setup-1.0.0.exe";

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[13px] text-white/90">{children}</kbd>;
}

// ------------------------------------------------------------------ textos (inglês e português)
type Lang = "en" | "pt";
const COPY = {
  en: {
    navFeatures: "Features",
    navCode: "Open source",
    navFaq: "FAQ",
    download: "Download",
    badge: "Open source",
    title1: "Your screen just got",
    title2: "an",
    titleAccent: "island",
    lead: (
      <>
        VANTA is the Dynamic Island for Windows. What's playing with <b>lyrics in time</b>, a <b>converter</b>, <b>link downloads</b>, tasks and
        water, in one living capsule at the top of your screen.
      </>
    ),
    ctaWindows: "Download for Windows",
    ctaGithub: "View on GitHub",
    soundOn: "Sound on",
    soundOff: "Mute",
    featTitle1: "Everything at the",
    featAccent: "top",
    featTitle2: "of your screen.",
    featLead: (
      <>
        Hover, click or press <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>Space</Kbd>. The capsule opens, does what you need and goes back to being a
        quiet detail of your screen.
      </>
    ),
    features: [
      ["Music, with lyrics in time", "Spotify, YouTube, Apple Music, Deezer or any player that talks to Windows. Artwork, controls and lyrics scrolling along."],
      ["Copied a link? It notices.", "YouTube, TikTok, Instagram, X and Pinterest as MP4, or just the audio as MP3."],
      ["Drop and convert", "Photos become a PDF, a PDF becomes images, a video becomes MP3. Nothing else to open."],
      ["Tasks that remind you", "Priority, due date and reminders, one gesture away."],
      ["Drink water, for real", "Tell it your bottle size, then tap the level the water dropped to."],
    ],
    codeTitle: "Read it, change it,",
    codeAccent: "make it yours.",
    codeLead: "Rust, Tauri 2, React 19 and TypeScript, under the MIT license. Every line is on GitHub, and every release lists the SHA-256 of its files.",
    star: "Star on GitHub",
    running: "VANTA running at the top of your screen",
    faqTitle: "Short answers.",
    faq: [
      ["Is VANTA really free?", "Yes. No paid tier, no subscription, no ads. The whole source code is on GitHub under the MIT license."],
      ["Which computers does it run on?", "Windows 10 and Windows 11, 64-bit. It installs for your user only. There is no macOS or Linux version."],
      [
        "Why does Windows say “unknown publisher”?",
        "The installer is not code-signed yet (that takes a paid certificate). Click More info, then Run anyway. You can check the file's SHA-256 on GitHub first.",
      ],
      [
        "Where does my data go?",
        "Nowhere. Only two things ever leave your computer, and only when you use them: the track name, to find lyrics on LRCLIB (you can turn it off), and the link you asked it to download.",
      ],
      ["Can I download any video?", "The downloader uses yt-dlp, an open-source tool. Only download what is yours, what is free, or what you are allowed to download."],
      ["Will the island get in my way?", "No. It never steals focus from the window you are in, and clicks outside the capsule go straight to the app underneath."],
    ],
    ctaTitle1: "Ready for your",
    ctaAccent: "island",
    ctaLead: "It installs in under a minute. The capsule shows up at the top of your main monitor.",
    ctaOs: "Windows 10 & 11",
    ctaMeta: "x64 · 53 MB · version 1.0.0",
    ctaButton: "Download VANTA",
    ctaAlso: (
      <>
        Also on{" "}
        <a className="text-lilac underline" href={`${REPO}/releases/latest`}>
          GitHub Releases
        </a>
        , with the NSIS and MSI installers and the SHA-256 of every file.
      </>
    ),
    footReleases: "Releases",
    footPrivacy: "Privacy",
    footLicense: "MIT License",
    footNote: "Made in Brazil. Not affiliated with Apple or Microsoft.",
  },
  pt: {
    navFeatures: "Recursos",
    navCode: "Código aberto",
    navFaq: "Perguntas",
    download: "Baixar",
    badge: "Código aberto",
    title1: "Sua tela ganhou",
    title2: "uma",
    titleAccent: "ilha",
    lead: (
      <>
        O VANTA é a Dynamic Island do Windows. O que está tocando com a <b>letra no tempo certo</b>, um <b>conversor</b>, <b>downloads por link</b>,
        tarefas e água, numa cápsula viva no topo da tela.
      </>
    ),
    ctaWindows: "Baixar para Windows",
    ctaGithub: "Ver no GitHub",
    soundOn: "Ativar som",
    soundOff: "Sem som",
    featTitle1: "Tudo no",
    featAccent: "topo",
    featTitle2: "da tela.",
    featLead: (
      <>
        Passe o mouse, clique ou aperte <Kbd>Alt</Kbd> <Kbd>Shift</Kbd> <Kbd>Espaço</Kbd>. A cápsula abre, faz o que você precisa e volta a ser só um
        detalhe da tela.
      </>
    ),
    features: [
      ["Música com a letra no tempo certo", "Spotify, YouTube, Apple Music, Deezer ou qualquer player que fale com o Windows. Capa, controles e a letra rolando junto."],
      ["Copiou um link? Ela avisa.", "YouTube, TikTok, Instagram, X e Pinterest em MP4, ou só o áudio em MP3."],
      ["Arraste e converta", "Fotos viram PDF, PDF vira imagem, vídeo vira MP3. Sem abrir mais nada."],
      ["Tarefas que lembram você", "Prioridade, prazo e lembrete, a um gesto de distância."],
      ["Beba água de verdade", "Diga o tamanho da garrafa e toque no nível em que a água ficou."],
    ],
    codeTitle: "Leia, mude e",
    codeAccent: "faça do seu jeito.",
    codeLead: "Rust, Tauri 2, React 19 e TypeScript, sob a licença MIT. Cada linha está no GitHub, e cada versão traz o SHA-256 dos arquivos.",
    star: "Dar uma estrela",
    running: "VANTA rodando no topo da tela",
    faqTitle: "Respostas curtas.",
    faq: [
      ["O VANTA é grátis mesmo?", "Sim. Não tem versão paga, assinatura nem anúncio. O código inteiro está no GitHub sob a licença MIT."],
      ["Em quais computadores funciona?", "Windows 10 e Windows 11, 64 bits. Instala só para o seu usuário. Não há versão para macOS ou Linux."],
      [
        "Por que o Windows avisa “editor desconhecido”?",
        "O instalador ainda não tem assinatura digital, que é um certificado pago. Clique em Mais informações e depois em Executar assim mesmo. Se preferir, confira o SHA-256 do arquivo no GitHub antes.",
      ],
      [
        "Para onde vão os meus dados?",
        "Para lugar nenhum. Só saem duas coisas, e só quando você usa: o nome da música, para buscar a letra no LRCLIB (dá para desligar), e o link que você mandou baixar.",
      ],
      ["Posso baixar qualquer vídeo?", "O downloader usa o yt-dlp, de código aberto. Baixe apenas o que é seu, o que é livre ou o que você tem autorização para baixar."],
      ["A ilha atrapalha o que eu estou fazendo?", "Não. Ela não rouba o foco da janela em que você está, e fora da cápsula os cliques passam direto para o app de baixo."],
    ],
    ctaTitle1: "Pronto para a sua",
    ctaAccent: "ilha",
    ctaLead: "Instala em menos de um minuto. A cápsula aparece no topo do monitor principal.",
    ctaOs: "Windows 10 e 11",
    ctaMeta: "x64 · 53 MB · versão 1.0.0",
    ctaButton: "Baixar o VANTA",
    ctaAlso: (
      <>
        Também no{" "}
        <a className="text-lilac underline" href={`${REPO}/releases/latest`}>
          GitHub Releases
        </a>
        , com os instaladores NSIS e MSI e o SHA-256 de cada arquivo.
      </>
    ),
    footReleases: "Versões",
    footPrivacy: "Privacidade",
    footLicense: "Licença MIT",
    footNote: "Feito no Brasil. Não é afiliado à Apple nem à Microsoft.",
  },
};
type Copy = (typeof COPY)["en"];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("vanta-lang");
    if (saved === "en" || saved === "pt") return saved;
  } catch {
    /* sem armazenamento: segue o navegador */
  }
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

/** Entrada ao rolar: sobe, desfoca e aparece. */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32, filter: "blur(10px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-8% 0px" }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("fill-current", className)} aria-hidden>
      <path d="M0 2.3 6.5 1.4v6.2H0zm7.3-1 8.7-1.3v7.6H7.3zM0 8.4h6.5v6.2L0 13.7zm7.3 0H16V16l-8.7-1.2z" />
    </svg>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("fill-current", className)} aria-hidden>
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0" />
    </svg>
  );
}

// ------------------------------------------------------------------ fundo vivo
function Background() {
  const still = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <MeshGradient
        className="absolute inset-0 h-full w-full opacity-60"
        colors={["#4c1d95", "#7c3aed", "#c026d3", "#0e7490", "#4f46e5", "#701a75"]}
        distortion={0.9}
        swirl={0.7}
        speed={still ? 0 : 0.22}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_100%_at_50%_30%,rgb(7_6_11/0.25)_0%,rgb(7_6_11/0.55)_60%,rgb(7_6_11/0.85)_100%)]" />
      <div className="grain absolute inset-0" />
    </div>
  );
}

// ------------------------------------------------------------------ navegação
function Nav({ t, lang, setLang }: { t: Copy; lang: Lang; setLang: (l: Lang) => void }) {
  // ao rolar, a barra encolhe para o centro e escurece um pouco
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setCompact(y > 60));
  return (
    <header className={cn("fixed inset-x-0 z-50 px-4 transition-[top] duration-500 ease-out-expo", compact ? "top-2.5" : "top-4")}>
      <nav
        className={cn(
          "mx-auto flex items-center justify-between gap-4 rounded-full border border-white/10 pr-2 pl-4 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.9)] backdrop-blur-xl transition-all duration-500 ease-out-expo",
          compact ? "max-w-4xl bg-black/55 py-1.5" : "max-w-6xl bg-black/35 py-2",
        )}
      >
        <a href="#top" aria-label="VANTA" className="flex items-center">
          <img src="media/mascot-head.webp" alt="" className={cn("w-auto drop-shadow-[0_0_12px_rgb(167_139_250/0.8)] transition-all duration-500", compact ? "h-8" : "h-9")} />
        </a>
        <div className="hidden items-center gap-7 text-sm text-white/70 md:flex">
          <Link003 href="#features" className="hover:text-white">
            {t.navFeatures}
          </Link003>
          <Link003 href="#code" className="hover:text-white">
            {t.navCode}
          </Link003>
          <Link003 href="#faq" className="hover:text-white">
            {t.navFaq}
          </Link003>
          <Link001 href={REPO} className="hover:text-white">
            GitHub
          </Link001>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-xs font-medium" role="group" aria-label="Language">
            {(["en", "pt"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={cn("rounded-full px-2.5 py-1.5 uppercase transition", lang === l ? "bg-white text-black" : "text-white/60 hover:text-white")}
              >
                {l}
              </button>
            ))}
          </div>
          <a
            href={DOWNLOAD}
            download
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black shadow-[0_0_30px_-6px_rgb(196_181_253/0.9)] transition hover:scale-[1.03] active:scale-95 sm:px-5"
          >
            <ArrowDownToLine className="size-4" /> <span className="hidden sm:inline">{t.download}</span>
          </a>
        </div>
      </nav>
    </header>
  );
}

// ------------------------------------------------------------------ herói com o vídeo
function Hero({ t }: { t: Copy }) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const still = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 0.2"] });
  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1]);
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) void v.play();
    setMuted(v.muted);
  };
  return (
    <section id="top" className="relative px-4 pt-32 pb-20 text-center sm:pt-36">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] opacity-45 [mask-image:linear-gradient(#000_35%,transparent)]">
        <GodRays
          className="h-full w-full"
          colorBack="rgba(0,0,0,0)"
          colorBloom="#a78bfa"
          colors={["#e9d5ff", "#f0abfc", "#a5f3fc", "#c4b5fd"]}
          offsetY={-1}
          spotty={0.35}
          midSize={0.2}
          midIntensity={0.4}
          density={0.3}
          intensity={0.45}
          bloom={0.35}
          speed={still ? 0 : 0.6}
        />
      </div>

      <div className="relative z-10">
        <Reveal>
          <a
            href={`${REPO}/releases`}
            className="beam-border mx-auto inline-flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pr-4 pl-1 text-[13px] text-white/75 backdrop-blur-md"
          >
            <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-black">v1.0.0</span>
            {t.badge}
            <ArrowRight className="size-3.5" />
          </a>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 className="mx-auto mt-7 max-w-5xl text-[clamp(46px,7.6vw,108px)] leading-[0.92] font-semibold tracking-[-0.06em] drop-shadow-[0_8px_40px_rgb(0_0_0/0.35)]">
            {t.title1}
            <br />
            {t.title2} <span className="text-aurora pr-[0.06em] font-serif font-normal tracking-[-0.02em] italic">{t.titleAccent}</span>
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/70 sm:text-xl [&_b]:font-normal [&_b]:text-white">{t.lead}</p>
        </Reveal>
        <Reveal delay={0.24} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DOWNLOAD}
            download
            className="group inline-flex h-13 items-center gap-2.5 rounded-full bg-white px-7 font-medium text-black shadow-[0_10px_50px_-8px_rgb(196_181_253/0.85)] transition hover:scale-[1.03] active:scale-95"
          >
            <WindowsMark className="size-4" />
            {t.ctaWindows}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
          <a
            href={REPO}
            className="inline-flex h-13 items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-7 font-medium backdrop-blur-md transition hover:bg-white/10"
          >
            <GithubMark className="size-4" /> {t.ctaGithub}
          </a>
        </Reveal>
      </div>

      {/* o palco: uma aura colorida respirando atrás e o vídeo num tablet que começa deitado e se
          endireita ao rolar (o mesmo efeito da hero da Notrix: 20° → 0°, escala 1,05 → 1) */}
      <Reveal delay={0.35} className="relative mx-auto mt-24 max-w-6xl">
        <div ref={stage} style={{ perspective: "1000px" }}>
          <div aria-hidden className="pointer-events-none absolute -inset-x-[12%] -inset-y-[18%] -z-10">
            <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,#8b5cf6,#e879f9,#67e8f9,#6366f1,#8b5cf6)] opacity-55 blur-[90px] [animation:spin_18s_linear_infinite]" />
          </div>
          <motion.div
            style={{
              rotateX: still ? 0 : rotate,
              scale: still ? 1 : scale,
              boxShadow: "0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003",
              "--beam-color": "#f0abfc",
            } as unknown as CSSProperties}
            className="beam-border relative rounded-[24px] border border-white/10 bg-[#0b0a10] p-2 sm:rounded-[34px] sm:p-4"
          >
            {/* o mascote sentado na moldura, como a ilha no topo da tela */}
            <img
              src="media/mascot-head.webp"
              alt=""
              aria-hidden
              className="absolute -top-[52px] left-1/2 z-20 w-[118px] -translate-x-1/2 drop-shadow-[0_0_30px_rgb(167_139_250/0.9)] sm:-top-[70px] sm:w-[156px]"
            />
            <div className="relative overflow-hidden rounded-[16px] bg-black sm:rounded-[20px]">
            <video
              ref={video}
              src="media/vanta.mp4"
              poster="media/vanta-poster.jpg"
              className="block aspect-video w-full"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
            />
            <button
              type="button"
              onClick={toggle}
              className="absolute right-4 bottom-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-sm backdrop-blur-md transition hover:bg-black/75"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {muted ? t.soundOn : t.soundOff}
            </button>
          </div>
          </motion.div>
        </div>
      </Reveal>
    </section>
  );
}

// ------------------------------------------------------------------ marcas (logos do Simple Icons, CC0)
const BRANDS = [siSpotify, siYoutube, siYoutubemusic, siNetflix, siApplemusic, siTwitch, siTidal, siSoundcloud, siMax, siVimeo, siItunes, siVlcmediaplayer];
function Brands() {
  return (
    <section className="py-12">
      <div className="mask-fade-x overflow-hidden">
        <div className="flex w-max items-center gap-14 [animation:marquee_45s_linear_infinite] hover:[animation-play-state:paused]">
          {[...BRANDS, ...BRANDS].map((b, i) => (
            <span key={i} className="flex items-center gap-3 text-white/55 transition-colors hover:text-white">
              <svg viewBox="0 0 24 24" className="size-7 fill-current" aria-hidden>
                <path d={b.path} />
              </svg>
              <span className="text-lg font-semibold tracking-tight whitespace-nowrap">{b.title === "TIDAL" ? "Tidal" : b.title}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ recursos
const FEATURE_ART = [
  { img: "ui-music", accent: "232 121 249", wide: true },
  { img: "ui-download", accent: "103 232 249", wide: false },
  { img: "ui-convert", accent: "251 191 36", wide: false },
  { img: "ui-tasks", accent: "74 222 128", wide: false },
  { img: "ui-water", accent: "96 165 250", wide: false },
];

/** Focos de luz coloridos e flutuando atrás de uma seção. */
function Glows({ tones }: { tones: { c: string; x: string; y: string; s: string }[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-visible">
      {tones.map((tone, i) => (
        <div
          key={i}
          className="absolute rounded-full blur-[110px] [animation:float_14s_ease-in-out_infinite]"
          style={{ left: tone.x, top: tone.y, width: tone.s, height: tone.s, background: tone.c, opacity: 0.55, animationDelay: `${i * -4}s` }}
        />
      ))}
    </div>
  );
}

function FeatureCard({ title, text, art, lang, i }: { title: string; text: string; art: (typeof FEATURE_ART)[number]; lang: Lang; i: number }) {
  // o cartão inclina na direção do mouse e volta com mola (o largo inclina menos)
  const still = useReducedMotion();
  const rx = useSpring(0, { stiffness: 170, damping: 20 });
  const ry = useSpring(0, { stiffness: 170, damping: 20 });
  const onMove = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
    if (still) return;
    const max = art.wide ? 3 : 6;
    ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };
  return (
    <Reveal delay={(i % 3) * 0.08} className={cn(art.wide && "md:col-span-2")}>
      <motion.article
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ "--accent": art.accent, "--beam-color": `rgb(${art.accent})`, rotateX: rx, rotateY: ry, transformPerspective: 1000 } as unknown as CSSProperties}
        className="group beam-border relative flex h-full flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-[0_30px_90px_-40px_rgb(var(--accent)/0.75)] backdrop-blur-2xl"
      >
        {/* a cor do recurso acende o topo; o holofote segue o mouse */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_70%_at_50%_0%,rgb(var(--accent)/0.35),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_circle_at_var(--mx)_var(--my),rgb(var(--accent)/0.16),transparent_60%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        {/* a interface some no vidro do cartão: nenhuma faixa de cor atrás do texto */}
        <div className="relative h-[230px] overflow-hidden px-5 [mask-image:linear-gradient(#000_55%,transparent)] sm:h-[270px]">
          <img
            src={`media/${lang}/${art.img}.webp`}
            alt=""
            loading="lazy"
            className={cn(
              "mx-auto -mt-1 drop-shadow-[0_24px_50px_rgb(0_0_0/0.55)] transition duration-700 ease-out-expo group-hover:translate-y-2 group-hover:scale-[1.02]",
              art.wide ? "w-full max-w-[820px]" : "w-[150%] max-w-none -translate-x-[16.6%]",
            )}
          />
        </div>
        <div className="relative px-7 pt-2 pb-8">
          <h3 className="text-[22px] font-semibold tracking-[-0.03em]">{title}</h3>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-white/65">{text}</p>
        </div>
      </motion.article>
    </Reveal>
  );
}

function Features({ t, lang }: { t: Copy; lang: Lang }) {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-4 py-28">
      <Glows
        tones={[
          { c: "#c026d3", x: "-15%", y: "10%", s: "520px" },
          { c: "#0891b2", x: "70%", y: "35%", s: "560px" },
          { c: "#7c3aed", x: "20%", y: "70%", s: "620px" },
        ]}
      />
      <Reveal className="mx-auto mb-16 max-w-3xl text-center">
        <h2 className="text-[clamp(40px,6vw,76px)] leading-[0.98] font-semibold tracking-[-0.05em]">
          {t.featTitle1} <span className="text-aurora font-serif font-normal italic">{t.featAccent}</span> {t.featTitle2}
        </h2>
        <p className="mt-6 text-lg text-white/65">{t.featLead}</p>
      </Reveal>
      <div className="grid gap-4 md:grid-cols-3">
        {t.features.map(([title, text], i) => (
          <FeatureCard key={title} title={title} text={text} art={FEATURE_ART[i]!} lang={lang} i={i} />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ código aberto
function OpenSource({ t }: { t: Copy }) {
  const [copied, setCopied] = useState(false);
  const cmd = "git clone https://github.com/qamut/vanta.git";
  const copy = () => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  const still = useReducedMotion();
  return (
    <section id="code" className="mx-auto max-w-6xl px-4 py-16">
      <Reveal>
        <div className="relative overflow-hidden rounded-[32px] border border-white/10">
          <GrainGradient
            className="absolute inset-0 h-full w-full"
            colors={["#7c3aed", "#db2777", "#0891b2", "#4c1d95"]}
            colorBack="#07060b"
            softness={0.8}
            intensity={0.5}
            noise={0.35}
            shape="wave"
            speed={still ? 0 : 0.5}
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="relative grid items-center gap-10 p-8 sm:p-14 md:grid-cols-2">
            <div>
              <h2 className="text-[clamp(36px,5vw,60px)] leading-[0.98] font-semibold tracking-[-0.05em]">
                {t.codeTitle} <span className="font-serif font-normal italic">{t.codeAccent}</span>
              </h2>
              <p className="mt-5 max-w-md text-lg text-white/75">{t.codeLead}</p>
              <a href={REPO} className="mt-8 inline-flex h-12 items-center gap-2.5 rounded-full bg-white px-6 font-medium text-black transition hover:scale-[1.03]">
                <Star className="size-4" /> {t.star}
              </a>
            </div>
            <div className="rounded-2xl border border-white/15 bg-black/60 p-5 font-mono text-[13px] leading-7 text-white/80 shadow-2xl backdrop-blur-xl">
              <div className="mb-4 flex gap-1.5">
                <span className="size-3 rounded-full bg-[#ff5f57]" />
                <span className="size-3 rounded-full bg-[#febc2e]" />
                <span className="size-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex items-start justify-between gap-3">
                <p className="break-all">
                  <span className="text-lilac">$</span> {cmd}
                </p>
                <button type="button" onClick={copy} aria-label="Copy" className="shrink-0 rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
              </div>
              <p>
                <span className="text-lilac">$</span> npm ci && npm run ffmpeg:fetch
              </p>
              <p>
                <span className="text-lilac">$</span> npm run desktop
              </p>
              <p className="text-emerald-300">✓ {t.running}</p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ------------------------------------------------------------------ perguntas
function Faq({ t }: { t: Copy }) {
  return (
    <section id="faq" className="relative mx-auto max-w-3xl px-4 py-24">
      <Glows
        tones={[
          { c: "#7c3aed", x: "-40%", y: "20%", s: "520px" },
          { c: "#db2777", x: "75%", y: "45%", s: "440px" },
        ]}
      />
      <Reveal className="mb-12 text-center">
        <h2 className="text-[clamp(40px,6vw,64px)] leading-none font-semibold tracking-[-0.05em]">{t.faqTitle}</h2>
      </Reveal>
      <div className="space-y-3">
        {t.faq.map(([q, a], i) => (
          <Reveal key={q} delay={i * 0.04}>
            <details className="group rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl open:bg-white/[0.07]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-[17px] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 text-white/70 transition group-open:rotate-45">+</span>
              </summary>
              <p className="px-6 pb-6 leading-relaxed text-white/65">{a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ baixar (os painéis de luz bem desfocados por trás)
function Download({ t }: { t: Copy }) {
  const still = useReducedMotion();
  return (
    <section id="download" className="mx-auto max-w-6xl px-4 pt-16 pb-24">
      <Reveal>
        <div className="relative isolate overflow-hidden rounded-[36px] border border-white/15 px-6 pt-14 pb-16 text-center shadow-[0_40px_140px_-50px_rgb(167_139_250/0.8)] sm:px-16">
          <div aria-hidden className="absolute -inset-16 -z-10 scale-110 blur-[42px] saturate-150">
            <ColorPanels
              className="h-full w-full"
              colors={["#8b5cf6", "#e879f9", "#67e8f9", "#a78bfa"]}
              colorBack="#120d24"
              angle1={-0.4}
              angle2={-0.4}
              length={1.4}
              blur={0.6}
              fadeIn={1}
              fadeOut={0.5}
              density={1.6}
              gradient={0.9}
              speed={still ? 0 : 0.45}
            />
          </div>
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_40%,rgb(10_8_18/0.15),rgb(10_8_18/0.6))]" />
          <div aria-hidden className="grain absolute inset-0 -z-10" />
          <img
            src="media/mascot-full.webp"
            alt=""
            className="mx-auto w-40 [animation:float_6s_ease-in-out_infinite] drop-shadow-[0_30px_60px_rgb(167_139_250/0.75)] sm:w-52"
          />
          <h2 className="mt-6 text-[clamp(40px,6vw,76px)] leading-[0.98] font-semibold tracking-[-0.05em]">
            {t.ctaTitle1} <span className="text-aurora font-serif font-normal italic">{t.ctaAccent}</span>?
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-lg text-white/75">{t.ctaLead}</p>
          <div className="mx-auto mt-10 flex max-w-xl flex-col items-stretch gap-4 rounded-3xl border border-white/20 bg-white/10 p-4 text-left backdrop-blur-2xl sm:flex-row sm:items-center sm:justify-between sm:pl-6">
            <div className="flex items-center gap-4">
              <WindowsMark className="size-7 text-white" />
              <div>
                <p className="font-semibold">{t.ctaOs}</p>
                <p className="text-sm text-white/65">{t.ctaMeta}</p>
              </div>
            </div>
            <a
              href={DOWNLOAD}
              download
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 font-medium text-black shadow-[0_10px_40px_-8px_rgb(196_181_253/0.9)] transition hover:scale-[1.03]"
            >
              <ArrowDownToLine className="size-4" /> {t.ctaButton}
            </a>
          </div>
          <p className="mt-6 text-sm text-white/60">{t.ctaAlso}</p>
        </div>
      </Reveal>
    </section>
  );
}

// ------------------------------------------------------------------ rodapé no molde do notrix.com.br: o nome gigante, cortado e desbotando
function Footer({ t }: { t: Copy }) {
  return (
    <footer className="relative">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 text-sm text-white/55">
        <div className="flex flex-wrap gap-6">
          <Link003 href={REPO} className="hover:text-white">
            GitHub
          </Link003>
          <Link003 href={`${REPO}/releases`} className="hover:text-white">
            {t.footReleases}
          </Link003>
          <Link003 href="privacidade" className="hover:text-white">
            {t.footPrivacy}
          </Link003>
          <Link003 href={`${REPO}/blob/main/LICENSE`} className="hover:text-white">
            {t.footLicense}
          </Link003>
        </div>
        <p className="text-white/40">
          {t.footNote} · Links: <a className="underline hover:text-white" href="https://skiper-ui.com">Skiper UI</a> · Shaders:{" "}
          <a className="underline hover:text-white" href="https://paper.design">
            Paper
          </a>
        </p>
      </div>
      <div className="relative mt-6 h-[200px] w-full overflow-hidden md:h-[300px]">
        <motion.p
          aria-hidden
          initial={{ y: 80 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none absolute inset-x-0 top-0 text-center text-[27vw] leading-[0.8] font-black tracking-[-0.07em] text-white opacity-20 select-none"
        >
          VANTA
        </motion.p>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#07060b] to-transparent" />
      </div>
    </footer>
  );
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const t = COPY[lang];
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("vanta-lang", l);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.title = lang === "pt" ? "VANTA — A Dynamic Island para o Windows" : "VANTA — The Dynamic Island for Windows";
  }, [lang]);
  // rolagem suave (Lenis, como na Notrix); os links de âncora do menu também deslizam
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, lerp: 0.1, wheelMultiplier: 1.1, anchors: { offset: -80 } });
    return () => lenis.destroy();
  }, []);
  // o vídeo do herói pausa fora da tela (economiza bateria)
  useEffect(() => {
    const v = document.querySelector<HTMLVideoElement>("#top video");
    if (!v) return;
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? void v.play().catch(() => {}) : v.pause()));
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <Background />
      <Nav t={t} lang={lang} setLang={setLang} />
      <main>
        <Hero t={t} />
        <Brands />
        <Features t={t} lang={lang} />
        <OpenSource t={t} />
        <Faq t={t} />
        <Download t={t} />
      </main>
      <Footer t={t} />
    </>
  );
}
