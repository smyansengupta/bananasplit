/**
 * The weekly pulse's trend: each week evened out with the weeks either side
 * of it (weighted one, two, one), so one odd week bends the line a little
 * instead of making a spike, and the line stays with the bars instead of
 * running ahead of them. Pure, so the shape is unit-tested.
 */

/** Week `i` evened out with its neighbours; an end week leans on the one beside it. */
function evenedAt(values: readonly number[], i: number): number {
  let sum = 2 * values[i]!;
  let weight = 2;
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= values.length) continue;
    sum += values[j]!;
    weight += 1;
  }
  return sum / weight;
}

/**
 * The trend through `values`, one point per week, never below zero. With
 * `ahead`, that many more points carry the last one on, flat (the week
 * under way, whose own count isn't in yet, is on the same pace).
 */
export function trendLine(values: readonly number[], ahead = 0): number[] {
  if (values.length === 0) return [];
  const line = values.map((_, i) => Math.max(0, evenedAt(values, i)));
  return [...line, ...Array<number>(ahead).fill(line[line.length - 1]!)];
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
