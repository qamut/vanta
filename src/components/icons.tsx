// Família de ícones autoral do VANTA — duotone.
// Grade 24×24. Cada ícone tem duas camadas: a MASSA (`.duo`, preenchida no tom secundário)
// e o TRAÇO (linha 1,9 px arredondada no tom principal). Ícones mecânicos (setas, ×, +, ✓)
// são de um tom só, com traço mais firme. O tom secundário vem de `--duo-color` /
// `--duo-opacity`, então o mesmo desenho funciona sobre preto, sobre o acento e desativado.
import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "fill"> {
  size?: number;
  strokeWidth?: number;
  /** Preenche a massa por inteiro (controles de reprodução). */
  fill?: string;
}
export type IconType = (props: IconProps) => ReactNode;

function make(base: ReactNode, line: ReactNode, opts: { solid?: boolean; weight?: number } = {}): IconType {
  return function Icon({ size = 20, strokeWidth, fill, className, ...rest }: IconProps) {
    const solid = opts.solid || (fill !== undefined && fill !== "none");
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth ?? opts.weight ?? 1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`vt-icon ${solid ? "is-solid" : ""} ${className ?? ""}`}
        {...rest}
      >
        {base && (
          <g className="duo" stroke="none">
            {base}
          </g>
        )}
        {line}
      </svg>
    );
  };
}

const mech = (line: ReactNode) => make(null, line, { weight: 2.15 });

// ---------------------------------------------------------------- mídia
const noteBase = (
  <>
    <circle cx="7" cy="17" r="3.2" />
    <circle cx="16.8" cy="15" r="3.2" />
    <path d="M10.2 6.5 20 4.3v3.4l-9.8 2.2z" />
  </>
);
const noteLine = (
  <>
    <path d="M10.2 17V6.5L20 4.3V15" />
    <circle cx="7" cy="17" r="3.2" />
    <circle cx="16.8" cy="15" r="3.2" />
  </>
);
export const Music = make(noteBase, noteLine);
export const Music2 = Music;

const bubble = "M6.5 3.5h11A2.5 2.5 0 0 1 20 6v7.5a2.5 2.5 0 0 1-2.5 2.5h-6.3l-4 3.2a.6.6 0 0 1-1-.47V16A2.5 2.5 0 0 1 4 13.5V6a2.5 2.5 0 0 1 2.5-2.5z";
/** Letra: um balão com linhas de texto (o que se canta, não o microfone). */
export const Lyrics = make(
  <path d={bubble} />,
  <>
    <path d={bubble} />
    <path d="M8 8h8M8 11.5h5" />
  </>,
);

const playPath = "M8 5.4v13.2a1 1 0 0 0 1.5.86l10.6-6.6a1 1 0 0 0 0-1.72L9.5 4.54A1 1 0 0 0 8 5.4z";
export const Play = make(<path d={playPath} />, <path d={playPath} />, { solid: true, weight: 1.6 });
export const Pause = make(
  <>
    <rect x="6.3" y="4.8" width="4.2" height="14.4" rx="1.5" />
    <rect x="13.5" y="4.8" width="4.2" height="14.4" rx="1.5" />
  </>,
  <>
    <rect x="6.3" y="4.8" width="4.2" height="14.4" rx="1.5" />
    <rect x="13.5" y="4.8" width="4.2" height="14.4" rx="1.5" />
  </>,
  { solid: true, weight: 1.4 },
);
const skipShape = (
  <>
    <path d="M4.8 6.3v11.4a.9.9 0 0 0 1.42.73l8.2-5.7a.9.9 0 0 0 0-1.46l-8.2-5.7A.9.9 0 0 0 4.8 6.3z" />
    <rect x="16.4" y="5.5" width="2.8" height="13" rx="1.4" />
  </>
);
export const SkipForward = make(skipShape, skipShape, { solid: true, weight: 1.4 });
export const SkipBack = make(<g transform="matrix(-1 0 0 1 24 0)">{skipShape}</g>, <g transform="matrix(-1 0 0 1 24 0)">{skipShape}</g>, {
  solid: true,
  weight: 1.4,
});

export const ListMusic = make(
  <circle cx="17" cy="17.2" r="2.7" />,
  <>
    <path d="M3.5 6h12M3.5 11h12M3.5 16h7M19.7 17.2V8.4l1.8.7" />
    <circle cx="17" cy="17.2" r="2.7" />
  </>,
);

export const ExternalLink = make(
  <rect x="3.5" y="6.5" width="14" height="14" rx="3" />,
  <path d="M13.5 3.5h7v7M20.5 3.5l-9 9M17.5 13.5v4a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h4" />,
);

export const Volume2 = make(
  <path d="M4 9.3h3l5-4v13.4l-5-4H4a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1z" />,
  <path d="M4 9.3h3l5-4v13.4l-5-4H4a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1zM15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
);
export const VolumeX = make(
  <path d="M4 9.3h3l5-4v13.4l-5-4H4a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1z" />,
  <path d="M4 9.3h3l5-4v13.4l-5-4H4a1 1 0 0 1-1-1V10.3a1 1 0 0 1 1-1zM16 9.5l5 5M21 9.5l-5 5" />,
);

export const Headphones = make(
  <>
    <rect x="3.5" y="12.5" width="4.6" height="7.6" rx="2.1" />
    <rect x="15.9" y="12.5" width="4.6" height="7.6" rx="2.1" />
  </>,
  <>
    <path d="M3.5 15.5V12a8.5 8.5 0 0 1 17 0v3.5" />
    <rect x="3.5" y="12.5" width="4.6" height="7.6" rx="2.1" />
    <rect x="15.9" y="12.5" width="4.6" height="7.6" rx="2.1" />
  </>,
);
export const Speaker = make(
  <rect x="5.5" y="2.8" width="13" height="18.4" rx="3" />,
  <>
    <rect x="5.5" y="2.8" width="13" height="18.4" rx="3" />
    <circle cx="12" cy="14.3" r="3.3" />
    <path d="M12 7.2h.01" />
  </>,
);
export const Bluetooth = make(
  <circle cx="12" cy="12" r="8.6" />,
  <path d="M7.5 8.2 16.5 15.8 12 19.5V4.5l4.5 3.7-9 7.6" />,
);
export const Monitor = make(
  <rect x="2.8" y="4" width="18.4" height="12" rx="2.6" />,
  <>
    <rect x="2.8" y="4" width="18.4" height="12" rx="2.6" />
    <path d="M8.5 20.5h7M12 16v4.5" />
  </>,
);

// ---------------------------------------------------------------- produtividade
export const Timer = make(
  <circle cx="12" cy="13.5" r="7.5" />,
  <>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 13.5V9.6M10 2.8h4M18.4 6.6l1.3-1.3" />
  </>,
);
const dropPath = "M12 3.2c3.4 4 6.1 7.4 6.1 10.7a6.1 6.1 0 0 1-12.2 0c0-3.3 2.7-6.7 6.1-10.7z";
export const Droplet = make(<path d={dropPath} />, <path d={`${dropPath}M9.2 14.4a2.9 2.9 0 0 0 2.5 2.7`} />);
export const Droplets = Droplet;
export const Upload = make(
  <path d="M3.5 14h4.2l1.5 2.5h5.6l1.5-2.5h4.2v4a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3.5 18z" />,
  <path d="M3.5 14h4.2l1.5 2.5h5.6l1.5-2.5h4.2v4a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3.5 18zM12 3.5v8.2M8.6 6.9 12 3.5l3.4 3.4" />,
);
export const ListChecks = make(
  <>
    <rect x="3" y="4.3" width="5.4" height="5.4" rx="1.7" />
    <rect x="3" y="14.3" width="5.4" height="5.4" rx="1.7" />
  </>,
  <>
    <rect x="3" y="4.3" width="5.4" height="5.4" rx="1.7" />
    <rect x="3" y="14.3" width="5.4" height="5.4" rx="1.7" />
    <path d="M11.8 7h8.7M11.8 17h8.7M11.8 12h5.5" />
  </>,
);
export const Brain = make(
  <path d="M11.2 5.3A3 3 0 0 0 6.3 7a3.2 3.2 0 0 0-1.8 5.5 3.3 3.3 0 0 0 3.2 5.2 3 3 0 0 0 3.5 1.8zM12.8 5.3A3 3 0 0 1 17.7 7a3.2 3.2 0 0 1 1.8 5.5 3.3 3.3 0 0 1-3.2 5.2 3 3 0 0 1-3.5 1.8z" />,
  <path d="M11.2 5.3A3 3 0 0 0 6.3 7a3.2 3.2 0 0 0-1.8 5.5 3.3 3.3 0 0 0 3.2 5.2 3 3 0 0 0 3.5 1.8zM12.8 5.3A3 3 0 0 1 17.7 7a3.2 3.2 0 0 1 1.8 5.5 3.3 3.3 0 0 1-3.2 5.2 3 3 0 0 1-3.5 1.8zM8.2 10.8a2.4 2.4 0 0 1 3 0M15.8 13.6a2.4 2.4 0 0 1-3 0" />,
);
export const Coffee = make(
  <path d="M4.5 9h11v5.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />,
  <path d="M4.5 9h11v5.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM15.5 10.5H17a2.6 2.6 0 0 1 0 5.2h-1.7M8 3.5v2.2M11.6 3.5v2.2" />,
);
export const Sofa = make(
  <rect x="5" y="9.5" width="14" height="5" rx="2" />,
  <path d="M5 10V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2M3.5 12a1.6 1.6 0 0 1 3.2 0v2.5h10.6V12a1.6 1.6 0 0 1 3.2 0v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM6.3 18.5V20M17.7 18.5V20" />,
);
export const CalendarClock = make(
  <rect x="3.5" y="5" width="14" height="13.5" rx="2.6" />,
  <>
    <path d="M17.5 9.5V7.6A2.6 2.6 0 0 0 14.9 5H6.1a2.6 2.6 0 0 0-2.6 2.6v8.3a2.6 2.6 0 0 0 2.6 2.6H11M3.5 9.5h14M7.5 3v3.5M13.5 3v3.5" />
    <circle cx="17.5" cy="17" r="4" />
    <path d="M17.5 15.2v1.9l1.2.8" />
  </>,
);
export const Pencil = make(
  <path d="M14.6 5.4 18.6 9.4 9 19H5v-4z" />,
  <path d="M14.6 5.4 18.6 9.4 9 19H5v-4zM12.8 7.2l4 4M14.6 5.4l1.3-1.3a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-1.3 1.3" />,
);
export const Trash2 = make(
  <path d="M5.6 7.5h12.8l-1 11.6a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z" />,
  <path d="M5.6 7.5h12.8l-1 11.6a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8zM3.5 7.5h17M9 7.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2.5M10 11.5v5M14 11.5v5" />,
);

// ---------------------------------------------------------------- avisos e sistema
const bellPath = "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z";
export const Bell = make(<path d={bellPath} />, <path d={`${bellPath}M10 20.6a2.2 2.2 0 0 0 4 0`} />);
export const BellRing = make(<path d={bellPath} />, <path d={`${bellPath}M10 20.6a2.2 2.2 0 0 0 4 0M3 8a9 9 0 0 1 2.2-4M21 8a9 9 0 0 0-2.2-4`} />);
export const BellOff = make(<path d={bellPath} />, <path d={`${bellPath}M10 20.6a2.2 2.2 0 0 0 4 0M3.5 3.5l17 17`} />);

export const TriangleAlert = make(
  <path d="M10.3 4.2 2.9 17.4a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />,
  <path d="M10.3 4.2 2.9 17.4a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.6v4.1M12 17h.01" />,
);
export const Settings = make(
  <circle cx="12" cy="12" r="6.4" />,
  <>
    <circle cx="12" cy="12" r="6.4" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
  </>,
);
export const Settings2 = make(
  <>
    <circle cx="8" cy="7" r="2.7" />
    <circle cx="16" cy="17" r="2.7" />
  </>,
  <>
    <path d="M3.5 7h1.8M10.7 7h9.8M3.5 17h9.8M18.7 17h1.8" />
    <circle cx="8" cy="7" r="2.7" />
    <circle cx="16" cy="17" r="2.7" />
  </>,
);
export const LayoutGrid = make(
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </>,
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </>,
);
export const Globe = make(
  <circle cx="12" cy="12" r="8.5" />,
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" />
  </>,
);
export const AppWindow = make(
  <rect x="3" y="4.5" width="18" height="15" rx="3" />,
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
  </>,
);
export const Keyboard = make(
  <rect x="2.5" y="6" width="19" height="12" rx="3" />,
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="3" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </>,
);
export const Palette = make(
  <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 1.6-2.2-.4-1.2.4-2.3 1.7-2.3H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z" />,
  <>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 1.6-2.2-.4-1.2.4-2.3 1.7-2.3H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z" />
    <path d="M7.8 11.5h.01M10.5 7.6h.01M15 8.2h.01" strokeWidth="2.6" />
  </>,
);
export const Shield = make(
  <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" />,
  <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6zM9 12l2 2 4-4" />,
);
export const Info = make(<circle cx="12" cy="12" r="8.5" />, <path d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM12 11v5.5M12 7.6h.01" />);
export const CheckCircle2 = make(<circle cx="12" cy="12" r="8.5" />, <path d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM8.5 12.2l2.3 2.3 4.7-4.7" />);
export const CircleAlert = make(<circle cx="12" cy="12" r="8.5" />, <path d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM12 7.8v4.6M12 16h.01" />);
export const CircleDashed = make(null, <circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 3" />);
export const Wifi = make(
  <circle cx="12" cy="19" r="1.7" />,
  <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.8a4.8 4.8 0 0 1 6.4 0" />,
);
export const Leaf = make(
  <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" />,
  <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19c3-4 6-6.5 9-8" />,
);
const plugBase = <path d="M5 7.5h10V11a5 5 0 0 1-10 0z" />;
export const PlugZap = make(plugBase, <path d="M7 3.5v4M13 3.5v4M5 7.5h10V11a5 5 0 0 1-10 0zM10 16v4.5M19 9.5l-2 3.2h3l-2 3.3" />);
export const Cable = make(plugBase, <path d="M7 3.5v4M13 3.5v4M5 7.5h10V11a5 5 0 0 1-10 0zM10 16v1.5a3 3 0 0 0 3 3h5" />);

const batteryBody = <rect x="2.8" y="7" width="16.2" height="10" rx="3" />;
const batteryLine = (
  <>
    <rect x="2.8" y="7" width="16.2" height="10" rx="3" />
    <path d="M21.2 10.5v3" />
  </>
);
const level = (w: number) => <rect x="5" y="9.2" width={w} height="5.6" rx="1.4" className="vt-icon__level" />;
export const Battery = make(batteryBody, batteryLine);
export const BatteryLow = make(null, <>{batteryLine}{level(3)}</>);
export const BatteryMedium = make(null, <>{batteryLine}{level(6.6)}</>);
export const BatteryFull = make(null, <>{batteryLine}{level(11.8)}</>);
export const BatteryCharging = make(batteryBody, <>{batteryLine}<path d="M11.6 8.8 9.6 12.2h3l-2 3.2" /></>);

// ---------------------------------------------------------------- arquivos
const docPath = "M6.5 3h7l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z";
const doc = (glyph?: ReactNode) => make(<path d={docPath} />, <><path d={`${docPath}M13.5 3v5h5`} />{glyph}</>);
export const File = doc();
export const FileText = doc(<path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.2h4" />);
export const FileImage = doc(<><circle cx="9.6" cy="12.4" r="1.3" /><path d="M7.6 18.2l3.2-3.2 2.3 2.3 1.5-1.5 2.3 2.4" /></>);
export const FileVideo = doc(<path d="M10 12v5.6l4.5-2.8z" />);
export const FileAudio = doc(<><path d="M11 17.4V12l3.8-.9v5" /><circle cx="9.9" cy="17.4" r="1.1" /><circle cx="13.7" cy="16.1" r="1.1" /></>);
export const FileArchive = doc(<path d="M11.5 4v1.4M11.5 7.3v1.4M11.5 10.6V12M10.3 14.2h2.4v3.2h-2.4z" />);
export const FileSpreadsheet = doc(<path d="M8.5 12.3h7v6h-7zM8.5 15.3h7M12 12.3v6" />);
export const FileCode = doc(<path d="M10 12.6l-2 2.1 2 2.1M14 12.6l2 2.1-2 2.1" />);
export const FileWarning = doc(<path d="M11.8 11.2v3.6M11.8 17.6h.01" />);
const folderPath = "M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z";
export const Folder = make(<path d={folderPath} />, <path d={folderPath} />);
export const FolderOpen = make(
  <path d="M3.5 18.5l2.3-6.2A2 2 0 0 1 7.7 11h12.4a1 1 0 0 1 .9 1.3l-2 6.2a2 2 0 0 1-1.9 1.5H4.5a1 1 0 0 1-1-1.5z" />,
  <path d="M3.5 18V7.5a2 2 0 0 1 2-2h4l2 2.2h6a2 2 0 0 1 2 2V11M3.5 18.5l2.3-6.2A2 2 0 0 1 7.7 11h12.4a1 1 0 0 1 .9 1.3l-2 6.2a2 2 0 0 1-1.9 1.5H4.5a1 1 0 0 1-1-1.5z" />,
);
export const Copy = make(
  <rect x="8.5" y="8.5" width="12" height="12" rx="2.6" />,
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.6" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </>,
);

// ---------------------------------------------------------------- mecânicos (um tom)
export const ChevronLeft = mech(<path d="M14.5 6 8.5 12l6 6" />);
export const ChevronRight = mech(<path d="M9.5 6l6 6-6 6" />);
export const Plus = mech(<path d="M12 5.5v13M5.5 12h13" />);
export const Minus = mech(<path d="M5.5 12h13" />);
export const X = mech(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const Check = mech(<path d="M5 12.6l4.4 4.4L19 7.4" />);
export const CheckCheck = mech(<path d="M2.5 12.6 6.5 16.6 15 8M11 15.6l1 1L21.5 8" />);
export const RefreshCw = mech(<path d="M20 11.5a8 8 0 0 0-14.2-4.8L4 8.5M4 4.5v4h4M4 12.5a8 8 0 0 0 14.2 4.8l1.8-1.8M20 19.5v-4h-4" />);
export const RotateCcw = mech(<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4.5v4h4" />);
export const Undo2 = mech(<path d="M9 14 4.5 9.5 9 5M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11" />);
export const Maximize = mech(<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />);
