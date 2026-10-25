import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps, children: React.ReactNode, filled = false) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Play = (p: IconProps) => base(p, <path d="M7.4 6.9c0-.86.95-1.38 1.67-.93l8.1 5.1c.67.42.67 1.44 0 1.86l-8.1 5.1c-.72.45-1.67-.07-1.67-.93z" />, true);
export const Pause = (p: IconProps) => base(p, <path d="M8.7 5.6h1.9c.56 0 1 .45 1 1v10.8c0 .55-.44 1-1 1H8.7c-.56 0-1-.45-1-1V6.6c0-.55.44-1 1-1Zm4.7 0h1.9c.56 0 1 .45 1 1v10.8c0 .55-.44 1-1 1h-1.9c-.56 0-1-.45-1-1V6.6c0-.55.44-1 1-1Z" />, true);
export const Prev = (p: IconProps) => base(p, <><path d="M18.6 6.2v11.6c0 .78-.88 1.25-1.53.82l-7.9-5.8c-.58-.42-.58-1.29 0-1.71l7.9-5.8c.65-.43 1.53.04 1.53.82z" /><rect x="5.4" y="5.7" width="2.1" height="12.6" rx="1.05" /></>, true);
export const Next = (p: IconProps) => base(p, <><path d="M5.4 6.2v11.6c0 .78.88 1.25 1.53.82l7.9-5.8c.58-.42.58-1.29 0-1.71l-7.9-5.8c-.65-.43-1.53.04-1.53.82z" /><rect x="16.5" y="5.7" width="2.1" height="12.6" rx="1.05" /></>, true);
export const Shuffle = (p: IconProps) => base(p, <><path d="M17 4.5 20.5 8 17 11.5" /><path d="M17 12.5 20.5 16 17 19.5" /><path d="M3.5 8h3.2c1.2 0 2.3.6 3 1.6l4.1 5.8c.7 1 1.8 1.6 3 1.6h2.2" /><path d="M3.5 16h3.2c1.2 0 2.3-.6 3-1.6l.9-1.3" /><path d="M13.6 9.2l.9-1.3c.7-1 1.8-1.6 3-1.6h2.2" /></>);
export const Repeat = (p: IconProps) => base(p, <><path d="M6.5 3.5h10.2c1.5 0 2.8 1.2 2.8 2.8v2.4" /><path d="M17.5 20.5H7.3A2.8 2.8 0 0 1 4.5 17.7v-2.4" /><path d="M8.4 1.9 6.2 3.5l2.2 1.6" /><path d="M15.6 22.1l2.2-1.6-2.2-1.6" /></>);
export const RepeatOne = (p: IconProps) => base(p, <><path d="M6.5 3.5h10.2c1.5 0 2.8 1.2 2.8 2.8v2.4" /><path d="M17.5 20.5H7.3A2.8 2.8 0 0 1 4.5 17.7v-2.4" /><path d="M8.4 1.9 6.2 3.5l2.2 1.6" /><path d="M15.6 22.1l2.2-1.6-2.2-1.6" /><path d="M11 15.4l1.4-1v4.2" /></>);
export const Volume = (p: IconProps) => base(p, <><path d="M4.5 9.4h2.7l4-3.2a.7.7 0 0 1 1.16.6v10.4a.7.7 0 0 1-1.16.6l-4-3.2H4.5a.9.9 0 0 1-.9-.9v-3.4a.9.9 0 0 1 .9-.9Z" /><path d="M16 9.2a3.8 3.8 0 0 1 0 5.6" /><path d="M18.6 6.8a7.3 7.3 0 0 1 0 10.4" /></>);
export const VolumeMute = (p: IconProps) => base(p, <><path d="M4.5 9.4h2.7l4-3.2a.7.7 0 0 1 1.16.6v10.4a.7.7 0 0 1-1.16.6l-4-3.2H4.5a.9.9 0 0 1-.9-.9v-3.4a.9.9 0 0 1 .9-.9Z" /><path d="M16.4 9.8 21 14.4" /><path d="M21 9.8l-4.6 4.6" /></>);
export const Plus = (p: IconProps) => base(p, <><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const Folder = (p: IconProps) => base(p, <path d="M3.5 6.6c0-1 .8-1.8 1.8-1.8h3.3c.5 0 1 .2 1.4.6l1.2 1.2h6.5c1 0 1.8.8 1.8 1.8v8.6c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8Z" />);
export const Music = (p: IconProps) => base(p, <><path d="M9.3 17.2V6.7l8.3-2.1v10.5" /><ellipse cx="7" cy="17.6" rx="2.3" ry="2.2" /><ellipse cx="15.3" cy="15.9" rx="2.3" ry="2.2" /><path d="M9.3 9.4l8.3-2.1" /></>);
export const NoteSingle = (p: IconProps) => base(p, <><path d="M11 17.8V5.2l6.2 2v3.2L11 8.6" /><circle cx="8.2" cy="17.8" r="2.8" /></>);
export const Settings = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="7.05" /><circle cx="12" cy="12" r="2.75" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(0 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(45 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(90 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(135 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(180 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(225 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(270 12 12)" /><rect x="10.55" y="1.7" width="2.9" height="3.7" rx="1.3" transform="rotate(315 12 12)" /></>);
export const Home = (p: IconProps) => base(p, <><path d="M4 10.7a2 2 0 0 1 .73-1.55l6-4.75a2 2 0 0 1 2.54 0l6 4.75A2 2 0 0 1 20 10.7v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M9.8 19.7v-5.2a1.2 1.2 0 0 1 1.2-1.2h2a1.2 1.2 0 0 1 1.2 1.2v5.2" /></>);
export const Search = (p: IconProps) => base(p, <><circle cx="11" cy="11" r="6.3" /><path d="M15.9 15.9 20.2 20.2" /></>);
export const Heart = (p: IconProps) => base(p, <path d="M12 19.4 4.7 12.3a4.65 4.65 0 0 1 6.5-6.6l.8.8.8-.8a4.65 4.65 0 0 1 6.5 6.6z" />);
export const HeartFilled = (p: IconProps) => base(p, <path d="M12 19.4 4.7 12.3a4.65 4.65 0 0 1 6.5-6.6l.8.8.8-.8a4.65 4.65 0 0 1 6.5 6.6z" />, true);
export const Queue = (p: IconProps) => base(p, <><path d="M4 7.3h10.4" /><path d="M4 12h10.4" /><path d="M4 16.7h6.4" /><path d="M15.7 13.4c0-.53.58-.86 1.03-.59l3.5 2.1c.45.27.45.93 0 1.2l-3.5 2.1c-.45.27-1.03-.06-1.03-.59Z" /></>);
export const Sliders = (p: IconProps) => base(p, <><path d="M6 4v16" /><path d="M12 4v16" /><path d="M18 4v16" /><circle cx="6" cy="9" r="2" fill="currentColor" /><circle cx="12" cy="15" r="2" fill="currentColor" /><circle cx="18" cy="8" r="2" fill="currentColor" /></>);
export const Lyrics = (p: IconProps) => base(p, <><path d="M5 7h14" /><path d="M5 12h10" /><path d="M5 17h7" /><circle cx="17.5" cy="16.5" r="2" /><path d="M19.5 16.5V11l2 .7" /></>);
export const Disc = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="2.2" /><path d="M12 3.6a8.4 8.4 0 0 1 8.4 8.4" opacity=".4" /></>);
export const Users = (p: IconProps) => base(p, <><circle cx="12" cy="8.5" r="3.4" /><path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" /></>);
export const ListPlus = (p: IconProps) => base(p, <><path d="M4 7h11" /><path d="M4 12h8" /><path d="M4 17h8" /><path d="M17.5 12v6" /><path d="M14.5 15h6" /></>);
export const ExternalLink = (p: IconProps) => base(p, <><path d="M14 5h5v5" /><path d="M10 14 19 5" /><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" /></>);
export const Sun = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>);
export const Moon = (p: IconProps) => base(p, <path d="M19.4 14.5A7.6 7.6 0 0 1 9.5 4.6a7.8 7.8 0 1 0 9.9 9.9Z" />);
export const List = (p: IconProps) => base(p, <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>);
export const X = (p: IconProps) => base(p, <><path d="M6.2 6.2 17.8 17.8" /><path d="M17.8 6.2 6.2 17.8" /></>);
export const Minus = (p: IconProps) => base(p, <path d="M5.5 12h13" />);
export const Square = (p: IconProps) => base(p, <rect x="5.5" y="5.5" width="13" height="13" rx="1.6" />);
export const More = (p: IconProps) => base(p, <><circle cx="5.6" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18.4" cy="12" r="1.3" fill="currentColor" stroke="none" /></>);
export const Refresh = (p: IconProps) => base(p, <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20.2 4.6v4.2H16" /></>);
export const Trash = (p: IconProps) => base(p, <><path d="M4.8 6.8h14.4" /><path d="M9.4 6.8V5.2c0-.8.6-1.4 1.4-1.4h2.4c.8 0 1.4.6 1.4 1.4v1.6" /><path d="M6.6 6.8 7.4 19c0 .9.7 1.6 1.6 1.6h6c.9 0 1.6-.7 1.6-1.6l.8-12.2" /><path d="M10.6 10.4v6.2" /><path d="M13.4 10.4v6.2" /></>);
export const Eye = (p: IconProps) => base(p, <><path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12Z" /><circle cx="12" cy="12" r="2.7" /></>);
export const EyeOff = (p: IconProps) => base(p, <><path d="M4.2 4.2 19.8 19.8" /><path d="M9.6 6.3A8.6 8.6 0 0 1 12 5.9c6 0 9.4 6.1 9.4 6.1a17 17 0 0 1-3 3.7" /><path d="M6.2 8.2A16.6 16.6 0 0 0 2.6 12S6 18.1 12 18.1a8.9 8.9 0 0 0 3.5-.7" /><path d="M10.1 10.2a2.7 2.7 0 0 0 3.7 3.7" /></>);
export const Pin = (p: IconProps) => base(p, <><path d="M9.7 3.9h4.6l-.5 4.25 2.6 2.65H7.6l2.6-2.65z" /><path d="M12 10.8v8.7" /></>);
export const ChevronRight = (p: IconProps) => base(p, <path d="M9.5 5.5 16 12l-6.5 6.5" />);
export const ChevronLeft = (p: IconProps) => base(p, <path d="M14.5 5.5 8 12l6.5 6.5" />);
export const ChevronDown = (p: IconProps) => base(p, <path d="M5.5 9.5 12 16l6.5-6.5" />);
export const ChevronUp = (p: IconProps) => base(p, <path d="M5.5 14.5 12 8l6.5 6.5" />);
export const Check = (p: IconProps) => base(p, <path d="M4.8 12.6 9.6 17.4 19.2 6.9" />);
export const Warning = (p: IconProps) => base(p, <><path d="M12 4.6 21 19.4H3Z" /><path d="M12 10.2v4.2" /><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" /></>);
export const ArrowLeft = (p: IconProps) => base(p, <><path d="M19 12H5" /><path d="M11 6 5 12l6 6" /></>);
export const Panel = (p: IconProps) => base(p, <><rect x="3.2" y="5" width="17.6" height="14" rx="2.4" /><path d="M3.2 9.4h17.6" /><path d="M7.6 13.4h6" /></>);
export const Keyboard = (p: IconProps) => base(p, <><rect x="2.6" y="6.2" width="18.8" height="11.6" rx="2" /><path d="M6.4 9.8h.01M9.6 9.8h.01M12.8 9.8h.01M16 9.8h.01M6.4 13h.01M9.6 13h.01M12.8 13h.01M16 13h.01M8 15.8h8" /></>);
export const Sparkle = (p: IconProps) => base(p, <><path d="M12 3.4 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9Z" /><path d="M18.6 3.2v3.2M20.2 4.8h-3.2" /></>);
export const ImagePlus = (p: IconProps) => base(p, <><rect x="3.5" y="4.5" width="17" height="15" rx="2.6" /><circle cx="9" cy="10" r="1.6" /><path d="M4.2 17.6 9.6 13a1.4 1.4 0 0 1 1.9.1l3.1 2.9 2.1-1.9a1.3 1.3 0 0 1 1.8.1l1.8 1.8" /></>);
export const ImageOff = (p: IconProps) => base(p, <><path d="M4.2 4.2 19.8 19.8" /><path d="M9.2 4.5h9.2a2.1 2.1 0 0 1 2.1 2.1v9.2" /><path d="M19.5 19.5H5.6a2.1 2.1 0 0 1-2.1-2.1V6.6c0-.5.2-1 .5-1.4" /><path d="M4.3 17.3 9.2 13a1.4 1.4 0 0 1 1.9.1l2.4 2.2" /></>);
export const Expand = (p: IconProps) => base(p, <><path d="M14.5 4.5h5v5" /><path d="M19.5 4.5 13 11" /><path d="M9.5 19.5h-5v-5" /><path d="M4.5 19.5 11 13" /></>);

/**
 * Vesper mark — a waveform with a spark at its centre.
 *
 * Seven rounded bars, symmetric about the middle, with the centre bar carrying
 * a four-point spark. Drawn in `currentColor` so it inherits ink in both themes;
 * the Windows app icon is generated from the same proportions by
 * `scripts/make-icon.mjs`, so the in-app mark and the taskbar icon match.
 */
export function Mark({ size = 24, tone = "currentColor", ...props }: IconProps & { tone?: string }) {
  // [centreX, height] — mirror-symmetric, tallest in the middle.
  const bars: [number, number][] = [
    [4.15, 2.7],
    [6.8, 5.7],
    [9.45, 9.6],
    [14.55, 9.6],
    [17.2, 5.7],
    [19.85, 2.7],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <g fill={tone}>
        {bars.map(([cx, h]) => (
          <rect key={cx} x={cx - 0.75} y={12 - h / 2} width={1.5} height={h} rx={0.75} />
        ))}
        {/* centre bar, tall */}
        <rect x={11.25} y={5.4} width={1.5} height={13.2} rx={0.75} />
        {/* four-point spark, concave arms */}
        <path d="M12 9.42c.28 1.42 1.18 2.32 2.6 2.6-1.42.28-2.32 1.18-2.6 2.6-.28-1.42-1.18-2.32-2.6-2.6 1.42-.28 2.32-1.18 2.6-2.6Z" />
      </g>
    </svg>
  );
}
