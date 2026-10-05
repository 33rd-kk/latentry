// Masonry columns that stay put while more pictures load.
//
// CSS multi-column layout fills the first column top to bottom, then the
// next, so every page that loads re-deals all the pictures between the
// columns and the ones on screen jump. Here each picture goes, in order, to
// the column that is shortest so far: where a picture lands depends only on
// the pictures before it, so loading more only adds to the bottoms.

/** Height of a picture of width 1 (height / width); square when unknown. */
export function heightPerWidth(width: number | null, height: number | null): number {
  return width && height ? height / width : 1
}

/**
 * Indices of `heights` (each item's height at a column width of 1, footer
 * included) dealt into `columns` columns, each in reading order.
 */
export function dealColumns(heights: readonly number[], columns: number): number[][] {
  const count = Math.max(1, Math.floor(columns))
  const result = Array.from({ length: count }, () => [] as number[])
  const filled = new Array<number>(count).fill(0)
  heights.forEach((height, index) => {
    let shortest = 0
    // Strictly shorter, so ties go to the leftmost column, as people read.
    for (let column = 1; column < count; column += 1) if (filled[column] < filled[shortest] - 1e-9) shortest = column
    result[shortest].push(index)
    filled[shortest] += height
  })
  return result
}
