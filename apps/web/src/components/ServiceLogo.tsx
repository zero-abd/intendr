/** Monochrome, self-contained brand glyphs for the "supported services" wall.
 *  Each is a stylized inline SVG that inherits `currentColor` — no external
 *  requests, no exact-logotype reproduction. The service name labels each mark. */
import type { ReactNode } from "react";

type Glyph = () => ReactNode;

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 28 28" width="26" height="26" fill="none" aria-hidden>
    {children}
  </svg>
);

/* — Commerce — */
const Amazon: Glyph = () =>
  svg(
    <>
      <path
        d="M4.5 15.4c3 2.2 6 3.3 9.5 3.3s6.5-1.1 9.5-3.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20.4 20.4c1.5-.9 2.6-1.7 3.2-2.6-1-.2-2.3-.3-3.7-.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10.5" r="1.4" fill="currentColor" />
      <circle cx="18" cy="10.5" r="1.4" fill="currentColor" />
    </>,
  );

const DoorDash: Glyph = () =>
  svg(
    <>
      <path d="M6.5 9.5c5 1.7 8 3.5 8 4.9s-3 3.2-8 4.9" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M12.5 9.5c5 1.7 8 3.5 8 4.9s-3 3.2-8 4.9" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    </>,
  );

const Uber: Glyph = () =>
  svg(
    <>
      <rect x="4" y="4" width="20" height="20" rx="5.5" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="12" width="8" height="4" rx="1.2" fill="currentColor" />
    </>,
  );

const Instacart: Glyph = () =>
  svg(
    <>
      <path
        d="M9.5 21.5c-1.7-4 .3-9.3 4.6-11.4l6.4 6.4c-2.1 4.3-7.4 6.3-11 5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M19 10.5l2-2.8M20.4 12l3.2-1.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
  );

/* — Data & APIs — */
const ContactOut: Glyph = () =>
  svg(
    <>
      <circle cx="11" cy="10" r="3.6" stroke="currentColor" strokeWidth="2" />
      <path d="M4.5 21c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M18.5 5.5h5v5M23.5 5.5l-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  );

const OpenAI: Glyph = () =>
  svg(
    <g stroke="currentColor" strokeWidth="1.7">
      <ellipse cx="14" cy="14" rx="9.5" ry="3.8" />
      <ellipse cx="14" cy="14" rx="9.5" ry="3.8" transform="rotate(60 14 14)" />
      <ellipse cx="14" cy="14" rx="9.5" ry="3.8" transform="rotate(120 14 14)" />
    </g>,
  );

const Anthropic: Glyph = () => {
  const cx = 14;
  const cy = 14;
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const inner = i % 2 === 0 ? 3.2 : 4.2;
    const outer = i % 2 === 0 ? 11 : 8.5;
    return {
      x1: cx + inner * Math.cos(a),
      y1: cy + inner * Math.sin(a),
      x2: cx + outer * Math.cos(a),
      y2: cy + outer * Math.sin(a),
    };
  });
  return svg(
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      {rays.map((r, i) => (
        <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />
      ))}
    </g>,
  );
};

const AWS: Glyph = () =>
  svg(
    <>
      <path
        d="M9 18.5a4 4 0 0 1-.6-7.9 5.6 5.6 0 0 1 10.5-1.3A3.9 3.9 0 0 1 19 18.5H9z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M7 21.5c3.2 1.5 8.8 1.5 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M17.5 21.8c.8-.5 1.4-.9 1.8-1.4-.6-.1-1.3-.2-2.1 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>,
  );

export type ServiceGroup = "Commerce" | "Data & APIs";

export interface Service {
  name: string;
  tag: string;
  group: ServiceGroup;
  Glyph: Glyph;
}

/** Everything the repo wires up as a capability provider, plus demo merchants. */
export const SERVICES: Service[] = [
  { name: "Amazon", tag: "Buy anything", group: "Commerce", Glyph: Amazon },
  { name: "DoorDash", tag: "Order food", group: "Commerce", Glyph: DoorDash },
  { name: "Uber", tag: "Book a ride", group: "Commerce", Glyph: Uber },
  { name: "Instacart", tag: "Groceries", group: "Commerce", Glyph: Instacart },
  { name: "ContactOut", tag: "People data", group: "Data & APIs", Glyph: ContactOut },
  { name: "OpenAI", tag: "AI API", group: "Data & APIs", Glyph: OpenAI },
  { name: "Anthropic", tag: "AI API", group: "Data & APIs", Glyph: Anthropic },
  { name: "AWS", tag: "Cloud", group: "Data & APIs", Glyph: AWS },
];
