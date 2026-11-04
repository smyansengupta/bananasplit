import { NODE_HEIGHT, NODE_WIDTH, type ChartLayout } from "./layout";

/**
 * The chart as a standalone SVG, for "Download PNG" and "Print or save as
 * PDF": the same tidy layout and pill tiles as the canvas, with colours
 * passed in already resolved from the theme (the browser reads the CSS
 * tokens), so the file looks like the screen in any theme. Pure.
 */

export interface ExportNode {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  /** Hex colour of the team, or null. */
  color: string | null;
  dashed: boolean;
}

export interface ExportPalette {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
}

const PAD = 32;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Cuts `s` to about `max` characters with an ellipsis. */
export function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function chartToSvg(
  layout: ChartLayout,
  nodes: ReadonlyMap<string, ExportNode>,
  palette: ExportPalette,
  options: { title?: string } = {},
): string {
  const head = options.title ? 40 : 0;
  const width = Math.max(layout.width, NODE_WIDTH) + PAD * 2;
  const height = Math.max(layout.height, NODE_HEIGHT) + PAD * 2 + head;
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const r = NODE_HEIGHT / 2;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Hanken Grotesk, Inter, system-ui, sans-serif">`,
    `<rect width="100%" height="100%" fill="${palette.background}"/>`,
  );
  if (options.title) {
    parts.push(`<text x="${PAD}" y="${PAD + 14}" font-size="20" font-weight="700" fill="${palette.foreground}">${esc(options.title)}</text>`);
  }
  parts.push(`<g transform="translate(${PAD} ${PAD + head})">`);
  for (const e of layout.edges) {
    const s = at.get(e.source);
    const t = at.get(e.target);
    if (!s || !t) continue;
    if (e.kind === "advisor") {
      const y = s.y + r;
      parts.push(
        `<path d="M${s.x + NODE_WIDTH} ${y} H${t.x}" stroke="${palette.mutedForeground}" stroke-width="1.5" stroke-dasharray="6 5" fill="none"/>`,
      );
      continue;
    }
    if (e.kind === "dotted") {
      const x1 = s.x + NODE_WIDTH / 2;
      const y1 = s.y + NODE_HEIGHT;
      const x2 = t.x + NODE_WIDTH / 2;
      const y2 = t.y;
      const bend = Math.max(40, Math.abs(y2 - y1) / 2);
      parts.push(
        `<path d="M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}" stroke="${palette.mutedForeground}" stroke-width="1.5" stroke-dasharray="3 5" fill="none"/>`,
      );
      continue;
    }
    const x1 = s.x + NODE_WIDTH / 2;
    const y1 = s.y + NODE_HEIGHT;
    const x2 = t.x + NODE_WIDTH / 2;
    const y2 = t.y;
    const mid = y1 + (y2 - y1) / 2;
    const stroke = nodes.get(e.target)?.color ?? palette.mutedForeground;
    parts.push(`<path d="M${x1} ${y1} V${mid} H${x2} V${y2}" stroke="${stroke}" stroke-opacity="0.7" stroke-width="1.5" fill="none"/>`);
  }
  for (const n of layout.nodes) {
    const node = nodes.get(n.id);
    if (!node) continue;
    const color = node.color ?? palette.mutedForeground;
    parts.push(
      `<g transform="translate(${n.x} ${n.y})">`,
      `<rect x="0.75" y="0.75" width="${NODE_WIDTH - 1.5}" height="${NODE_HEIGHT - 1.5}" rx="${r}" fill="${node.dashed ? palette.background : palette.card}" stroke="${node.dashed ? palette.mutedForeground : palette.border}" stroke-width="1.5"${node.dashed ? ' stroke-dasharray="5 4"' : ""}/>`,
      `<circle cx="${r}" cy="${r}" r="${r - 10}" fill="${node.dashed ? palette.muted : color}" fill-opacity="${node.dashed ? 1 : 0.28}"/>`,
      `<text x="${r}" y="${r + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="${palette.foreground}">${esc(node.initials)}</text>`,
      `<text x="${NODE_HEIGHT + 2}" y="${r - 3}" font-size="14" font-weight="600" fill="${palette.foreground}">${esc(fit(node.title, 22))}</text>`,
      `<text x="${NODE_HEIGHT + 2}" y="${r + 15}" font-size="12.5" fill="${palette.mutedForeground}">${esc(fit(node.subtitle, 26))}</text>`,
      `</g>`,
    );
  }
  parts.push(`</g></svg>`);
  return parts.join("");
}

/** The margin around the chart in the file. */
export const EXPORT_PADDING = PAD;
