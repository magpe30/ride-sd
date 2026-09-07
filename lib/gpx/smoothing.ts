// A general Savitzky-Golay filter: fits a low-order polynomial to a
// sliding window of samples and takes the polynomial's value at the
// window's center. Unlike a moving average, this preserves the shape of
// peaks/curvature in the signal instead of blurring them — important
// here because corner detection and (eventually) lean-angle estimation
// both need the speed signal's derivative to still mean something after
// smoothing raw, noisy GPS-derived speed.
function transpose(matrix: readonly (readonly number[])[]): number[][] {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]));
}

function multiply(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[]
): number[][] {
  return a.map((row) =>
    b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0))
  );
}

// Gauss-Jordan inversion — fine for the small (polyOrder+1) square
// matrices this module deals with.
function invert(matrix: readonly (readonly number[])[]): number[][] {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) pivotRow = row;
    }
    [augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]];

    const pivot = augmented[col][col];
    for (let j = 0; j < 2 * n; j += 1) augmented[col][j] /= pivot;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = 0; j < 2 * n; j += 1) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  return augmented.map((row) => row.slice(n));
}

// Coefficients that, convolved with a window of `windowSize` equally
// spaced samples, give the smoothed value at the window's center point.
function savitzkyGolayCoefficients(windowSize: number, polyOrder: number): number[] {
  const half = (windowSize - 1) / 2;

  const design: number[][] = [];
  for (let i = -half; i <= half; i += 1) {
    const row: number[] = [];
    for (let p = 0; p <= polyOrder; p += 1) row.push(i ** p);
    design.push(row);
  }

  const designT = transpose(design);
  const pseudoInverse = multiply(invert(multiply(designT, design)), designT);
  return pseudoInverse[0];
}

export function smoothSeries(
  values: readonly number[],
  windowSize: number,
  polyOrder: number
): number[] {
  if (values.length < windowSize) return values.slice();

  const half = (windowSize - 1) / 2;
  const coefficients = savitzkyGolayCoefficients(windowSize, polyOrder);
  const result = new Array<number>(values.length);

  for (let i = 0; i < values.length; i += 1) {
    if (i < half || i >= values.length - half) {
      result[i] = values[i];
      continue;
    }
    let sum = 0;
    for (let k = -half; k <= half; k += 1) sum += coefficients[k + half] * values[i + k];
    result[i] = sum;
  }

  return result;
}
