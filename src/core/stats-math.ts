// Student-t critical values, implemented from scratch (plan todo 7): the
// dependency-free inverse-t via bisection on the regularized incomplete beta
// (Numerical-Recipes-style Lanczos gamma + Lentz continued fraction) — a new
// runtime dep is forbidden by the plan. Accuracy: |t − table| < 1e-3 for the
// t-distribution rows checked in stats.test.ts (df=1..30, α=0.05).
//
// Split out of stats.ts (pure-LOC ceiling); stats.ts re-exports studentTQuantile
// so consumers import it from "../core/stats.js" unchanged.

const BISECTION_ITERATIONS = 60;
const LANCZOS: readonly number[] = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

// Lanczos g=7 pairs with the 9 coefficients (c0..c8) above.
const LANCZOS_G = 7;

function logGamma(z: number): number {
  let x = z - 1;
  let acc = LANCZOS[0] as number;
  for (let i = 1; i < LANCZOS.length; i++) {
    acc += (LANCZOS[i] as number) / (x + i);
  }
  const t = x + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(acc);
}

/** Continued fraction for the regularized incomplete beta (Lentz, NR 6.4.2). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b), b=1/2 in every call here. */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-sided Student-t critical value: the t such that P(|T| ≤ t) = 1 − alpha
 * with T ~ t(df). Planned accuracy: matches t-table values to < 1e-3 for the
 * checked rows (stats.test.ts). alpha in (0,1), df ≥ 1.
 */
export function studentTQuantile(alpha: number, df: number): number {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`studentTQuantile: alpha=${String(alpha)} must be in (0, 1)`);
  if (!(df >= 1)) throw new RangeError(`studentTQuantile: df=${String(df)} must be >= 1`);
  // T ~ t(ν): P(T ≤ t) = 1 − ½·I_{ν/(ν+t²)}(ν/2, ½). For the two-sided critical
  // value I_{ν/(ν+t²)}(ν/2, ½) = alpha ⇒ t = √(ν(1−z)/z) with z = ν/(ν+t²).
  const a = df / 2;
  const b = 0.5;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (betai(a, b, mid) < alpha) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  return Math.sqrt((df * (1 - z)) / z);
}
