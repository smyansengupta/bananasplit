/**
 * Ambient Home's packing: widgets in columns, each as tall as what's in it,
 * every column ending at the same line, so there's never a hole. Wide
 * widgets (the week, the pulse) take a whole row; the ones between them are
 * one segment, split into columns so the columns come out as even as they
 * can. What's left over is shared out among the shorter columns' widgets, a
 * little each; when that would be more than SLACK for any one, fewer,
 * wider columns are tried, down to one, which is always even. Pure: the
 * board measures, this decides.
 */

/** The most a widget may grow past its content to even its column up, in pixels. */
export const SLACK = 56;

export interface Segment {
  /** Columns used, 1 to the most asked for. */
  cols: number;
  /** Each column's widgets, as indexes into the segment, top to bottom. */
  columns: number[][];
  /** Pixels each widget grows by (by index), so every column ends together. */
  extra: number[];
  /** The segment's height. */
  height: number;
}

function columnHeight(items: readonly number[], heights: readonly number[], gap: number): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, i) => sum + heights[i]!, 0) + gap * (items.length - 1);
}

/**
 * The most even way to put `heights` (in order) into `cols` columns, every
 * column used: each widget goes to a column already started or the next new
 * one, so the first widget is top left and columns start in order. Order
 * within a column follows the list. Null when there are fewer widgets than
 * columns.
 */
export function splitEvenly(
  heights: readonly number[],
  cols: number,
  gap: number,
): number[][] | null {
  const n = heights.length;
  if (cols < 1 || n < cols) return null;
  let best: number[][] | null = null;
  let bestSpread = Infinity;
  const columns: number[][] = [];
  const walk = (i: number) => {
    // Not enough widgets left to start every remaining column.
    if (n - i < cols - columns.length) return;
    if (i === n) {
      const hs = columns.map((c) => columnHeight(c, heights, gap));
      const spread = Math.max(...hs) - Math.min(...hs);
      if (spread < bestSpread) {
        bestSpread = spread;
        best = columns.map((c) => [...c]);
      }
      return;
    }
    for (const c of columns) {
      c.push(i);
      walk(i + 1);
      c.pop();
    }
    if (columns.length < cols) {
      columns.push([i]);
      walk(i + 1);
      columns.pop();
    }
  };
  walk(0);
  return best;
}

/**
 * Shares each column's shortfall out among its widgets by their heights, so
 * all end at the tallest and a small card grows least.
 */
function evenUp(columns: readonly number[][], heights: readonly number[], gap: number) {
  const hs = columns.map((c) => columnHeight(c, heights, gap));
  const height = Math.max(0, ...hs);
  const extra = heights.map(() => 0);
  columns.forEach((c, k) => {
    const short = height - hs[k]!;
    const total = c.reduce((sum, i) => sum + heights[i]!, 0);
    let given = 0;
    c.forEach((i, j) => {
      // The last takes what rounding left.
      const share =
        j === c.length - 1
          ? short - given
          : Math.floor(total > 0 ? (short * heights[i]!) / total : short / c.length);
      extra[i] = share;
      given += share;
    });
  });
  return { extra, height };
}

/**
 * One segment's columns: the most columns (up to `maxCols`) whose even-up
 * needs no widget to grow more than `slack`. `heightsAt(k)` gives each
 * widget's height at the width of one of k columns.
 */
export function packSegment(
  heightsAt: (cols: number) => readonly number[],
  count: number,
  maxCols: number,
  gap: number,
  slack = SLACK,
): Segment {
  for (let cols = Math.min(maxCols, count); cols > 1; cols--) {
    const heights = heightsAt(cols);
    const columns = splitEvenly(heights, cols, gap);
    if (!columns) continue;
    const { extra, height } = evenUp(columns, heights, gap);
    if (Math.max(...extra) <= slack) return { cols, columns, extra, height };
  }
  const heights = heightsAt(1);
  const all = heights.map((_, i) => i);
  return {
    cols: 1,
    columns: count > 0 ? [all] : [],
    extra: heights.map(() => 0),
    height: columnHeight(all, heights, gap),
  };
}
