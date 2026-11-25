import { eachValue, type EvalScope } from '../evaluator';
import { registrar } from '../registry';
import { compareScalars, ERR, isError, Matrix, toNumber, type EvalValue, type Scalar } from '../values';
import { matrixOf, num, numbers, numOf, result, scalarOf } from './helpers';
import { collectIf, matchCriteria } from './math';

const f = registrar('Statistical');

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

function mean(ns: number[]): number {
  if (!ns.length) throw ERR.DIV0;
  return sum(ns) / ns.length;
}

function variance(ns: number[], sample: boolean): number {
  if (ns.length < (sample ? 2 : 1)) throw ERR.DIV0;
  const m = mean(ns);
  return ns.reduce((a, n) => a + (n - m) ** 2, 0) / (ns.length - (sample ? 1 : 0));
}

const max = (ns: number[]): number => ns.reduce((a, b) => (b > a ? b : a), -Infinity);
const min = (ns: number[]): number => ns.reduce((a, b) => (b < a ? b : a), Infinity);

f.range('AVERAGE', 'number1, [number2], ...', 'Returns the average (arithmetic mean) of its arguments.', (args, s) => mean(numbers(args, s)));
f.range('MIN', 'number1, [number2], ...', 'Returns the smallest number in a set of values.', (args, s) => {
  const ns = numbers(args, s);
  return ns.length ? min(ns) : 0;
});
f.range('MAX', 'number1, [number2], ...', 'Returns the largest value in a set of values.', (args, s) => {
  const ns = numbers(args, s);
  return ns.length ? max(ns) : 0;
});

/* ---------------------------------------------------------------- counting */

f.range('COUNT', 'value1, [value2], ...', 'Counts the number of cells that contain numbers.', (args, s) => {
  let n = 0;
  for (const a of args) {
    eachValue(a, s.ctx, (v, inRef) => {
      if (typeof v === 'number') n++;
      else if (!inRef && v !== null && !isError(v) && !isError(toNumber(v))) n++;
    });
  }
  return n;
});
f.range('COUNTA', 'value1, [value2], ...', 'Counts the number of cells that are not empty.', (args, s) => {
  let n = 0;
  for (const a of args) eachValue(a, s.ctx, (v, inRef) => void (v !== null || !inRef ? n++ : 0));
  return n;
});
f.range('COUNTBLANK', 'range', 'Counts empty cells in a range.', (args, s) => {
  let n = 0;
  eachValue(args[0], s.ctx, (v) => void (v === null || v === '' ? n++ : 0));
  return n;
});
f.range('COUNTIF', 'range, criteria', 'Counts the cells that meet the given condition.', (args, s) => {
  let n = 0;
  matchCriteria([args[0], args[1]], s).each(() => n++);
  return n;
});
f.range('COUNTIFS', 'criteria_range1, criteria1, [criteria_range2], [criteria2], ...', 'Counts the cells that meet multiple criteria.', (args, s) => {
  let n = 0;
  matchCriteria(args, s).each(() => n++);
  return n;
});
f.range('AVERAGEIF', 'range, criteria, [average_range]', 'Averages the cells specified by a given condition.', (args, s) =>
  mean(collectIf(args[2] ?? args[0], [args[0], args[1]], s)),
);
f.range('AVERAGEIFS', 'average_range, criteria_range1, criteria1, [criteria_range2], [criteria2], ...', 'Averages the cells that meet multiple criteria.', (args, s) =>
  mean(collectIf(args[0], args.slice(1), s)),
);
f.range('MAXIFS', 'max_range, criteria_range1, criteria1, [criteria_range2], [criteria2], ...', 'Returns the maximum value among cells that meet criteria.', (args, s) => {
  const ns = collectIf(args[0], args.slice(1), s);
  return ns.length ? max(ns) : 0;
});
f.range('MINIFS', 'min_range, criteria_range1, criteria1, [criteria_range2], [criteria2], ...', 'Returns the minimum value among cells that meet criteria.', (args, s) => {
  const ns = collectIf(args[0], args.slice(1), s);
  return ns.length ? min(ns) : 0;
});

/* ------------------------------------------------------------ distribution */

f.range('MEDIAN', 'number1, [number2], ...', 'Returns the median of the given numbers.', (args, s) => {
  const ns = numbers(args, s).sort((a, b) => a - b);
  if (!ns.length) return ERR.NUM;
  return (ns[(ns.length - 1) >> 1] + ns[ns.length >> 1]) / 2;
});
f.range('MODE.SNGL', 'number1, [number2], ...', 'Returns the most common value in a data set.', (args, s) => {
  const counts = new Map<number, number>();
  let best: number | null = null;
  for (const n of numbers(args, s)) {
    const k = (counts.get(n) ?? 0) + 1;
    counts.set(n, k);
    if (k > 1 && (best === null || k > counts.get(best)!)) best = n;
  }
  return best ?? ERR.NA;
});
f.alias('MODE', 'MODE.SNGL');
f.range('STDEV.S', 'number1, [number2], ...', 'Estimates standard deviation based on a sample.', (args, s) => Math.sqrt(variance(numbers(args, s), true)));
f.range('STDEV.P', 'number1, [number2], ...', 'Calculates standard deviation of an entire population.', (args, s) => Math.sqrt(variance(numbers(args, s), false)));
f.range('VAR.S', 'number1, [number2], ...', 'Estimates variance based on a sample.', (args, s) => variance(numbers(args, s), true));
f.range('VAR.P', 'number1, [number2], ...', 'Calculates variance of an entire population.', (args, s) => variance(numbers(args, s), false));
f.alias('STDEV', 'STDEV.S');
f.alias('STDEVP', 'STDEV.P');
f.alias('VAR', 'VAR.S');
f.alias('VARP', 'VAR.P');
f.range('AVEDEV', 'number1, [number2], ...', 'Returns the average of absolute deviations from the mean.', (args, s) => {
  const ns = numbers(args, s);
  const m = mean(ns);
  return mean(ns.map((n) => Math.abs(n - m)));
});
f.range('GEOMEAN', 'number1, [number2], ...', 'Returns the geometric mean.', (args, s) => {
  const ns = numbers(args, s);
  if (!ns.length || ns.some((n) => n <= 0)) return ERR.NUM;
  return Math.exp(mean(ns.map(Math.log)));
});
f.range('HARMEAN', 'number1, [number2], ...', 'Returns the harmonic mean.', (args, s) => {
  const ns = numbers(args, s);
  if (!ns.length || ns.some((n) => n <= 0)) return ERR.NUM;
  return ns.length / sum(ns.map((n) => 1 / n));
});
f.range('LARGE', 'array, k', 'Returns the k-th largest value in a data set.', (args, s) => {
  const ns = numbers([args[0]], s).sort((a, b) => b - a);
  return ns[Math.ceil(numOf(args[1], s)) - 1] ?? ERR.NUM;
});
f.range('SMALL', 'array, k', 'Returns the k-th smallest value in a data set.', (args, s) => {
  const ns = numbers([args[0]], s).sort((a, b) => a - b);
  return ns[Math.ceil(numOf(args[1], s)) - 1] ?? ERR.NUM;
});
f.range('RANK.EQ', 'number, ref, [order]', 'Returns the rank of a number in a list of numbers.', (args, s) => {
  const x = numOf(args[0], s);
  const ascending = args[2] !== undefined && numOf(args[2], s, 0) !== 0;
  const ns = numbers([args[1]], s);
  if (!ns.includes(x)) return ERR.NA;
  return 1 + ns.filter((n) => (ascending ? n < x : n > x)).length;
});
f.alias('RANK', 'RANK.EQ');

function percentile(ns: number[], k: number): number {
  if (!ns.length || k < 0 || k > 1) throw ERR.NUM;
  const sorted = [...ns].sort((a, b) => a - b);
  const pos = k * (sorted.length - 1);
  const lo = Math.floor(pos);
  return sorted[lo] + (pos - lo) * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}
f.range('PERCENTILE.INC', 'array, k', 'Returns the k-th percentile of values in a range.', (args, s) => percentile(numbers([args[0]], s), numOf(args[1], s)));
f.alias('PERCENTILE', 'PERCENTILE.INC');
f.range('QUARTILE.INC', 'array, quart', 'Returns the quartile of a data set.', (args, s) => percentile(numbers([args[0]], s), Math.trunc(numOf(args[1], s)) / 4));
f.alias('QUARTILE', 'QUARTILE.INC');
f.range('PERCENTRANK.INC', 'array, x', 'Returns the percentage rank of a value in a data set.', (args, s) => {
  const ns = numbers([args[0]], s);
  const x = numOf(args[1], s);
  if (ns.length < 2 || x < min(ns) || x > max(ns)) return ERR.NA;
  return Math.floor((ns.filter((n) => n < x).length / (ns.length - 1)) * 1000) / 1000;
});
f.alias('PERCENTRANK', 'PERCENTRANK.INC');

/* -------------------------------------------------------------- regression */

function paired(a: EvalValue, b: EvalValue, s: EvalScope): [number[], number[]] {
  const ma = matrixOf(a, s).rows.flat();
  const mb = matrixOf(b, s).rows.flat();
  if (ma.length !== mb.length) throw ERR.NA;
  const xs: number[] = [];
  const ys: number[] = [];
  ma.forEach((v, i) => {
    const w = mb[i];
    if (isError(v)) throw v;
    if (isError(w)) throw w;
    if (typeof v === 'number' && typeof w === 'number') {
      xs.push(v);
      ys.push(w);
    }
  });
  return [xs, ys];
}

function regression(ys: number[], xs: number[]): { slope: number; intercept: number; r: number } {
  if (xs.length < 2) throw ERR.DIV0;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  if (sxx === 0) throw ERR.DIV0;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy) };
}
f.range('SLOPE', 'known_ys, known_xs', 'Returns the slope of the linear regression line.', (args, s) => regression(...paired(args[0], args[1], s)).slope);
f.range('INTERCEPT', 'known_ys, known_xs', 'Returns the point where a regression line crosses the y-axis.', (args, s) => regression(...paired(args[0], args[1], s)).intercept);
f.range('CORREL', 'array1, array2', 'Returns the correlation coefficient between two data sets.', (args, s) => regression(...paired(args[0], args[1], s)).r);
f.alias('PEARSON', 'CORREL');
f.range('RSQ', 'known_ys, known_xs', 'Returns the square of the correlation coefficient.', (args, s) => regression(...paired(args[0], args[1], s)).r ** 2);
f.range('FORECAST.LINEAR', 'x, known_ys, known_xs', 'Predicts a future value along a linear trend.', (args, s) => {
  const x = numOf(args[0], s);
  const { slope, intercept } = regression(...paired(args[1], args[2], s));
  return result(intercept + slope * x);
});
f.alias('FORECAST', 'FORECAST.LINEAR');
f.range('TREND', 'known_ys, [known_xs], [new_xs]', 'Returns values along a linear trend.', (args, s) => {
  const ys = matrixOf(args[0], s).rows.flat().map((v) => num(v));
  const xs = args[1] === undefined || args[1] === null ? ys.map((_, i) => i + 1) : matrixOf(args[1], s).rows.flat().map((v) => num(v));
  const { slope, intercept } = regression(ys, xs);
  const target = args[2] !== undefined ? matrixOf(args[2], s) : matrixOf(args[1] ?? args[0], s);
  if (args[2] === undefined && (args[1] === undefined || args[1] === null)) {
    let i = 0;
    return new Matrix(target.rows.map((row) => row.map(() => intercept + slope * ++i)));
  }
  return new Matrix(target.rows.map((row) => row.map((v) => intercept + slope * num(v))));
});

function normCdf(z: number): number {
  // Complementary error function approximation with ~1e-15 relative accuracy.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * x);
  const erfc =
    t *
    Math.exp(
      -x * x -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}
f.scalar('NORM.DIST', 'x, mean, standard_dev, cumulative', 'Returns the normal distribution.', ([x, m, sd, cum]) => {
  const d = num(sd);
  if (d <= 0) return ERR.NUM;
  const z = (num(x) - num(m)) / d;
  return cum ? normCdf(z) : Math.exp(-z * z / 2) / (d * Math.sqrt(2 * Math.PI));
});
f.scalar('NORM.S.DIST', 'z, cumulative', 'Returns the standard normal distribution.', ([z, cum]) =>
  cum ? normCdf(num(z)) : Math.exp(-(num(z) ** 2) / 2) / Math.sqrt(2 * Math.PI),
);
f.scalar('STANDARDIZE', 'x, mean, standard_dev', 'Returns a normalized value from a distribution.', ([x, m, sd]) =>
  num(sd) <= 0 ? ERR.NUM : (num(x) - num(m)) / num(sd),
);

f.range('FREQUENCY', 'data_array, bins_array', 'Returns a frequency distribution as a vertical array.', (args, s) => {
  const data = numbers([args[0]], s);
  const bins = numbers([args[1]], s).sort((a, b) => a - b);
  const counts = new Array<number>(bins.length + 1).fill(0);
  for (const n of data) {
    const i = bins.findIndex((b) => n <= b);
    counts[i < 0 ? bins.length : i]++;
  }
  return new Matrix(counts.map((n) => [n]));
});

/* ------------------------------------------------------------------ A forms */

function valuesA(args: EvalValue[], s: EvalScope): number[] {
  const out: number[] = [];
  for (const a of args) {
    eachValue(a, s.ctx, (v: Scalar) => {
      if (isError(v)) throw v;
      if (typeof v === 'number') out.push(v);
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else if (typeof v === 'string') out.push(0);
    });
  }
  return out;
}
f.range('AVERAGEA', 'value1, [value2], ...', 'Averages its arguments, including text and logical values.', (args, s) => mean(valuesA(args, s)));
f.range('MAXA', 'value1, [value2], ...', 'Returns the maximum value, including text and logical values.', (args, s) => {
  const ns = valuesA(args, s);
  return ns.length ? max(ns) : 0;
});
f.range('MINA', 'value1, [value2], ...', 'Returns the smallest value, including text and logical values.', (args, s) => {
  const ns = valuesA(args, s);
  return ns.length ? min(ns) : 0;
});
f.range('TRIMMEAN', 'array, percent', 'Returns the mean of the interior of a data set.', (args, s) => {
  const ns = numbers([args[0]], s).sort((a, b) => compareScalars(a, b));
  const pct = num(scalarOf(args[1], s));
  if (pct < 0 || pct >= 1) return ERR.NUM;
  const cut = Math.floor((ns.length * pct) / 2);
  return mean(ns.slice(cut, ns.length - cut));
});
