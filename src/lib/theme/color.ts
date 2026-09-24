/**
 * Hand-rolled colour math for the theme engine (no dependency): hex <->
 * sRGB <-> linear sRGB <-> OKLab <-> OKLCH, gamut mapping, mixing and the
 * WCAG 2 contrast ratio. Pure and isomorphic: the server (save, render) and
 * the client (live preview) run the same code, so the preview equals the
 * saved result.
 *
 * Every function that returns a colour returns a lowercase `#rrggbb` string,
 * which is what the strict hex rule (./validate.ts) accepts.
 */

export interface Rgb {
  /** 0..1, gamma-encoded sRGB. */
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  L: number;
  /** Chroma, 0..~0.37 inside sRGB. */
  C: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

const HEX6 = /^#([0-9a-f]{6})$/i;

export function hexToRgb(hex: string): Rgb {
  const match = HEX6.exec(hex);
  if (!match) throw new TypeError(`not a #rrggbb colour: ${JSON.stringify(hex)}`);
  const n = Number.parseInt(match[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function channelToHex(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** OKLab from gamma-encoded sRGB (Björn Ottosson's matrices). */
export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Gamma-encoded sRGB from OKLab. Channels may fall outside 0..1 (out of gamut). */
export function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h: C < 1e-6 ? 0 : h };
}

export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function hexToOklch(hex: string): Oklch {
  return oklabToOklch(rgbToOklab(hexToRgb(hex)));
}

const GAMUT_EPSILON = 1e-4;

function inGamut({ r, g, b }: Rgb): boolean {
  return [r, g, b].every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

/**
 * The nearest sRGB colour to an OKLCH value, keeping L and h and reducing
 * chroma until it fits (the CSS Color 4 approach, by bisection).
 */
export function oklchToHex(color: Oklch): string {
  const L = Math.min(1, Math.max(0, color.L));
  const h = ((color.h % 360) + 360) % 360;
  let C = Math.max(0, color.C);
  const direct = oklabToRgb(oklchToOklab({ L, C, h }));
  if (inGamut(direct)) return rgbToHex(direct);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    C = (lo + hi) / 2;
    if (inGamut(oklabToRgb(oklchToOklab({ L, C, h })))) lo = C;
    else hi = C;
  }
  return rgbToHex(oklabToRgb(oklchToOklab({ L, C: lo, h })));
}

/** `amount` of `to` mixed into `from`, in OKLab (like color-mix(in oklab, ...)). */
export function mixOklab(from: string, to: string, amount: number): string {
  const a = rgbToOklab(hexToRgb(from));
  const b = rgbToOklab(hexToRgb(to));
  const t = Math.min(1, Math.max(0, amount));
  return rgbToHex(
    oklabToRgb({ L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t }),
  );
}

/**
 * `top` painted at `alpha` over an opaque `bottom`: what the browser shows
 * for Tailwind's `bg-primary/80` on a page (alpha compositing happens on
 * gamma-encoded sRGB channels).
 */
export function composite(top: string, bottom: string, alpha: number): string {
  const t = hexToRgb(top);
  const b = hexToRgb(bottom);
  const a = Math.min(1, Math.max(0, alpha));
  return rgbToHex({
    r: t.r * a + b.r * (1 - a),
    g: t.g * a + b.g * (1 - a),
    b: t.b * a + b.b * (1 - a),
  });
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether a colour reads as a light surface (dark text goes on it). */
export function isLight(hex: string): boolean {
  // The luminance where black and white text have equal contrast.
  return relativeLuminance(hex) > 0.179;
}

/** Of `candidates`, the one with the highest contrast against `background`. */
export function bestContrast(background: string, candidates: readonly string[]): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio + 1e-9) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * Moves `color`'s OKLCH lightness (keeping hue and, where the gamut allows,
 * chroma) the least distance that reaches `target` contrast against
 * `against`. Returns the colour unchanged when it already passes, and the
 * extreme it reached (black or white end) when nothing passes.
 */
export function adjustForContrast(color: string, against: string, target: number): string {
  if (contrastRatio(color, against) >= target) return color;
  const base = hexToOklch(color);
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const direction of [-1, 1]) {
    // Walk outward in small steps; the first passing step is the closest.
    for (let step = 1; step <= 200; step++) {
      const L = base.L + direction * step * 0.005;
      if (L < 0 || L > 1) break;
      const candidate = oklchToHex({ L, C: base.C, h: base.h });
      if (contrastRatio(candidate, against) >= target) {
        const distance = Math.abs(L - base.L);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
        break;
      }
    }
  }
  if (best) return best;
  return contrastRatio("#000000", against) >= contrastRatio("#ffffff", against)
    ? "#000000"
    : "#ffffff";
}

/** Rounds a ratio for display: 4.4999 must never print as "4.50". */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
