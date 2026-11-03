/**
 * The weekly pulse's trend: where the weeks are heading, not a line joining
 * their tops. Each point is a local linear fit of the weeks around it,
 * weighted by distance (a Gaussian kernel), so one odd week bends the line
 * a little instead of making a corner. Pure, so the shape is unit-tested.
 */

/** How far each fit looks, in weeks: wider for more weeks, never under one and a half. */
export function trendBandwidth(n: number): number {
  return Math.max(1.5, n / 4);
}

/** The local linear fit of `values` (at x = 0..n-1) evaluated at `x`. */
function fitAt(values: readonly number[], x: number, bandwidth: number): number {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  values.forEach((y, i) => {
    const w = Math.exp(-((i - x) ** 2) / (2 * bandwidth ** 2));
    sw += w;
    sx += w * i;
    sy += w * y;
    sxx += w * i * i;
    sxy += w * i * y;
  });
  if (sw === 0) return 0;
  const mx = sx / sw;
  const my = sy / sw;
  const vx = sxx / sw - mx * mx;
  const slope = vx > 1e-9 ? (sxy / sw - mx * my) / vx : 0;
  return my + slope * (x - mx);
}

/**
 * The trend through `values`, one point per week, never below zero. With
 * `ahead`, that many more points carry it on past the last value (the week
 * under way, whose own count isn't in yet).
 */
export function trendLine(values: readonly number[], ahead = 0): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return Array(1 + ahead).fill(Math.max(0, values[0]));
  const bw = trendBandwidth(values.length);
  return Array.from({ length: values.length + ahead }, (_, x) => Math.max(0, fitAt(values, x, bw)));
}

/**
 * A smooth SVG path through points (Catmull-Rom, as cubic Béziers), the
 * control points clamped to the chart so it never dips under the baseline.
 */
export function smoothPath(points: readonly { x: number; y: number }[], floor = 100): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  if (rest.length === 0) return `M${first.x},${first.y}`;
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: Math.min(floor, p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: Math.min(floor, p2.y - (p3.y - p1.y) / 6) };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}
