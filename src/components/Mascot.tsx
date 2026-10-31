// O mascote do VANTA. Aparece no repouso (só os olhos), nos estados vazios, nos avisos,
// nas configurações e no instalador. Arte original fornecida pela marca.
import { motion } from "motion/react";
import eyesUrl from "../assets/mascot/eyes.webp";
import fullUrl from "../assets/mascot/mascot-full.webp";
import headUrl from "../assets/mascot/mascot-head.webp";

const SRC = { eyes: eyesUrl, full: fullUrl, head: headUrl } as const;

export function Mascot(props: {
  variant?: keyof typeof SRC;
  size: number;
  /** Flutua suavemente (estados vazios). */
  float?: boolean;
  className?: string;
  label?: string;
}) {
  const { variant = "head", size, float } = props;
  return (
    <motion.img
      src={SRC[variant]}
      alt={props.label ?? ""}
      aria-hidden={props.label ? undefined : true}
      draggable={false}
      className={`vt-mascot vt-mascot--${variant} ${props.className ?? ""}`}
      style={{ width: size }}
      animate={float ? { y: [0, -5, 0], rotate: [0, -2, 0] } : undefined}
      transition={float ? { duration: 4.2, repeat: Infinity, ease: "easeInOut" } : undefined}
    />
  );
}

/** Olhos do repouso: piscam e acompanham o cursor (via --look). */
export function MascotEyes(props: { height: number; hover?: boolean }) {
  return (
    <span className={`vt-eyes-img ${props.hover ? "is-hover" : ""}`} aria-hidden>
      <img src={SRC.eyes} alt="" draggable={false} style={{ height: props.height }} />
    </span>
  );
}

/** Estado vazio com o mascote: frase curta e uma ação opcional. */
export function MascotEmpty(props: { title: string; body?: string; action?: React.ReactNode; size?: number }) {
  return (
    <div className="vt-mascot-empty">
      <Mascot variant="head" size={props.size ?? 86} float />
      <div className="vt-mascot-empty__text">
        <strong>{props.title}</strong>
        {props.body && <span>{props.body}</span>}
        {props.action}
      </div>
    </div>
  );
}
