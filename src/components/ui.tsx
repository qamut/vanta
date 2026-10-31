// Componentes básicos do VANTA. Todos acessíveis por teclado, com rótulo para leitores de tela.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { IconType } from "./icons";

type Variant = "ghost" | "soft" | "accent" | "danger";

export function IconButton(props: {
  icon: IconType;
  label: string;
  onClick?: () => void;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: Variant;
  disabled?: boolean;
  pressed?: boolean;
  disabledReason?: string;
  className?: string;
  fill?: boolean;
}) {
  const { icon: Icon, size = "md", variant = "ghost" } = props;
  const px = { sm: 14, md: 16, lg: 18, xl: 22 }[size];
  return (
    <button
      type="button"
      className={`vt-iconbtn vt-iconbtn--${size} vt-iconbtn--${variant} ${props.className ?? ""}`}
      aria-label={props.label}
      title={props.disabled && props.disabledReason ? props.disabledReason : props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon size={px} fill={props.fill ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  icon?: IconType;
  disabled?: boolean;
  type?: "button" | "submit";
  size?: "sm" | "md";
  title?: string;
}) {
  const { icon: Icon, variant = "soft", size = "md" } = props;
  return (
    <button
      type={props.type ?? "button"}
      className={`vt-btn vt-btn--${variant} vt-btn--${size}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {Icon && <Icon size={size === "sm" ? 15 : 17} aria-hidden />}
      <span>{props.children}</span>
    </button>
  );
}

/** Anel de progresso em SVG. `value` de 0 a 1. */
export function Ring(props: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  label?: string;
}) {
  const { size = 18, stroke = 2.5, color = "var(--accent)", track = "rgba(255,255,255,0.12)" } = props;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(props.value) ? props.value : 0));
  return (
    <span className="vt-ring" style={{ width: size, height: size }} role={props.label ? "img" : undefined} aria-label={props.label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="vt-ring__arc"
        />
      </svg>
      {props.children && <span className="vt-ring__inner">{props.children}</span>}
    </span>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={props.id}
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={`vt-toggle ${props.checked ? "is-on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="vt-toggle__thumb" />
    </button>
  );
}

export function Slider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min || 1)) * 100;
  return (
    <input
      type="range"
      className={`vt-slider ${props.className ?? ""}`}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      aria-valuetext={props.format ? props.format(props.value) : undefined}
      style={{ ...props.style, ["--pct" as string]: `${Math.max(0, Math.min(100, pct))}%` }}
      onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      onPointerUp={(e) => props.onCommit?.(Number(e.currentTarget.value))}
      onKeyUp={(e) => props.onCommit?.(Number(e.currentTarget.value))}
    />
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={`vt-seg vt-seg--${props.size ?? "md"}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? "is-active" : ""}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Indicador animado de reprodução. Representa o ESTADO "tocando" — não mede o áudio real,
 * e por isso o rótulo acessível diz exatamente isso.
 */
export function Wave(props: { playing: boolean; label: string; bars?: number; color?: string }) {
  const n = props.bars ?? 5;
  return (
    <span className={`vt-wave ${props.playing ? "is-playing" : ""}`} role="img" aria-label={props.label} style={{ color: props.color }}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{ animationDelay: `${(i * 137) % 600}ms` }} />
      ))}
    </span>
  );
}

/** Texto que rola só se não couber — e só quando o usuário não pediu menos movimento. */
export function Marquee(props: { text: string; className?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setOverflow(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [props.text]);
  return (
    <span ref={outer} className={`vt-marquee ${overflow > 4 ? "is-overflow" : ""} ${props.className ?? ""}`} title={props.text}>
      <span
        ref={inner}
        className="vt-marquee__inner"
        style={{ ["--shift" as string]: `-${overflow + 16}px`, ["--dur" as string]: `${Math.max(6, overflow / 18)}s` }}
      >
        {props.text}
      </span>
    </span>
  );
}

export function Empty(props: { icon: IconType; title: string; body?: string; action?: ReactNode; tone?: "neutral" | "warning" }) {
  const Icon = props.icon;
  return (
    <div className={`vt-empty vt-empty--${props.tone ?? "neutral"}`}>
      <span className="vt-empty__icon">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="vt-empty__text">
        <strong>{props.title}</strong>
        {props.body && <span>{props.body}</span>}
      </div>
      {props.action && <div className="vt-empty__action">{props.action}</div>}
    </div>
  );
}

/** Renderiza um ícone escolhido em tempo de execução (sem criar componente na renderização). */
export function Glyph(props: { icon: IconType; size?: number; strokeWidth?: number; className?: string; label?: string; fill?: string }) {
  const { icon: I, label, ...rest } = props;
  return <I {...rest} aria-hidden={label ? undefined : true} aria-label={label} />;
}

/** Re-renderiza no intervalo dado (para relógios). Para quando `active` é falso. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Alinha ao segundo para os relógios virarem juntos.
    let id: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), intervalMs);
    }, intervalMs - (Date.now() % intervalMs));
    return () => {
      clearTimeout(t);
      if (id) clearInterval(id);
    };
  }, [intervalMs, active]);
  return now;
}
