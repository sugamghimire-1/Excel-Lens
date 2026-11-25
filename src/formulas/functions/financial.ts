import { registrar } from '../registry';
import { ERR, type Scalar } from '../values';
import { num, numbers, numOf, result } from './helpers';

const f = registrar('Financial');

function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (nper === 0) throw ERR.NUM;
  if (rate === 0) return -(pv + fv) / nper;
  const g = (1 + rate) ** nper;
  return result((-rate * (pv * g + fv)) / ((1 + rate * type) * (g - 1)));
}

function fvOf(rate: number, nper: number, payment: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + payment * nper);
  const g = (1 + rate) ** nper;
  return result(-(pv * g + (payment * (1 + rate * type) * (g - 1)) / rate));
}

const flag = (v: Scalar | undefined): number => (num(v, 0) ? 1 : 0);

f.scalar('PMT', 'rate, nper, pv, [fv], [type]', 'Returns the periodic payment for a loan.', ([r, n, pv, fv, t]) => pmt(num(r), num(n), num(pv), num(fv, 0), flag(t)));
f.scalar('FV', 'rate, nper, pmt, [pv], [type]', 'Returns the future value of an investment.', ([r, n, p, pv, t]) => fvOf(num(r), num(n), num(p), num(pv, 0), flag(t)));
f.scalar('PV', 'rate, nper, pmt, [fv], [type]', 'Returns the present value of an investment.', ([r, n, p, fv, t]) => {
  const rate = num(r);
  const nper = num(n);
  if (rate === 0) return -(num(fv, 0) + num(p) * nper);
  const g = (1 + rate) ** nper;
  return result(-(num(fv, 0) + (num(p) * (1 + rate * flag(t)) * (g - 1)) / rate) / g);
});
f.scalar('NPER', 'rate, pmt, pv, [fv], [type]', 'Returns the number of periods for an investment.', ([r, p, pv, fv, t]) => {
  const rate = num(r);
  const payment = num(p);
  if (rate === 0) return payment === 0 ? ERR.NUM : -(num(pv) + num(fv, 0)) / payment;
  const k = payment * (1 + rate * flag(t));
  return result(Math.log((k - num(fv, 0) * rate) / (k + num(pv) * rate)) / Math.log(1 + rate));
});

function ipmt(rate: number, per: number, nper: number, pv: number, fv: number, type: number): number {
  if (per < 1 || per > nper) throw ERR.NUM;
  const payment = pmt(rate, nper, pv, fv, type);
  if (type === 1 && per === 1) return 0;
  const balance = fvOf(rate, per - 1, payment, pv, type);
  const interest = balance * rate;
  return type === 1 ? interest / (1 + rate) : interest;
}
f.scalar('IPMT', 'rate, per, nper, pv, [fv], [type]', 'Returns the interest payment for a given period.', ([r, per, n, pv, fv, t]) =>
  ipmt(num(r), num(per), num(n), num(pv), num(fv, 0), flag(t)),
);
f.scalar('PPMT', 'rate, per, nper, pv, [fv], [type]', 'Returns the principal payment for a given period.', ([r, per, n, pv, fv, t]) =>
  pmt(num(r), num(n), num(pv), num(fv, 0), flag(t)) - ipmt(num(r), num(per), num(n), num(pv), num(fv, 0), flag(t)),
);

/** Newton's method with a bisection fallback. */
function solve(fn: (x: number) => number, guess: number): number {
  let x = guess;
  for (let i = 0; i < 60; i++) {
    const y = fn(x);
    if (Math.abs(y) < 1e-9) return x;
    const d = (fn(x + 1e-6) - y) / 1e-6;
    if (!Number.isFinite(d) || d === 0) break;
    const next = x - y / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - x) < 1e-12) return next;
    x = next;
  }
  let lo = -0.9999;
  let hi = 10;
  let a = fn(lo);
  if (a * fn(hi) > 0) throw ERR.NUM;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const m = fn(mid);
    if (Math.abs(m) < 1e-10 || hi - lo < 1e-13) return mid;
    if (a * m < 0) hi = mid;
    else {
      lo = mid;
      a = m;
    }
  }
  return (lo + hi) / 2;
}

f.scalar('RATE', 'nper, pmt, pv, [fv], [type], [guess]', 'Returns the interest rate per period of an annuity.', ([n, p, pv, fv, t, g]) =>
  solve((r) => {
    if (Math.abs(r) < 1e-12) return num(pv) + num(p) * num(n) + num(fv, 0);
    const k = (1 + r) ** num(n);
    return num(pv) * k + (num(p) * (1 + r * flag(t)) * (k - 1)) / r + num(fv, 0);
  }, num(g, 0.1)),
);
f.range('NPV', 'rate, value1, [value2], ...', 'Returns the net present value of periodic cash flows.', (args, s) => {
  const rate = numOf(args[0], s);
  return result(numbers(args.slice(1), s).reduce((acc, v, i) => acc + v / (1 + rate) ** (i + 1), 0));
});
f.range('IRR', 'values, [guess]', 'Returns the internal rate of return for cash flows.', (args, s) => {
  const flows = numbers([args[0]], s);
  if (!flows.some((v) => v > 0) || !flows.some((v) => v < 0)) return ERR.NUM;
  return solve((r) => flows.reduce((acc, v, i) => acc + v / (1 + r) ** i, 0), numOf(args[1], s, 0.1));
});
f.range('XNPV', 'rate, values, dates', 'Returns the net present value for a schedule of cash flows.', (args, s) => {
  const rate = numOf(args[0], s);
  const values = numbers([args[1]], s);
  const dates = numbers([args[2]], s);
  if (values.length !== dates.length) return ERR.NUM;
  return result(values.reduce((acc, v, i) => acc + v / (1 + rate) ** ((dates[i] - dates[0]) / 365), 0));
});
f.range('XIRR', 'values, dates, [guess]', 'Returns the internal rate of return for a schedule of cash flows.', (args, s) => {
  const values = numbers([args[0]], s);
  const dates = numbers([args[1]], s);
  if (values.length !== dates.length) return ERR.NUM;
  return solve((r) => values.reduce((acc, v, i) => acc + v / (1 + r) ** ((dates[i] - dates[0]) / 365), 0), numOf(args[2], s, 0.1));
});
f.scalar('SLN', 'cost, salvage, life', 'Returns the straight-line depreciation for one period.', ([c, sv, l]) => (num(l) === 0 ? ERR.DIV0 : (num(c) - num(sv)) / num(l)));
f.scalar('SYD', 'cost, salvage, life, per', "Returns sum-of-years' digits depreciation.", ([c, sv, l, p]) => {
  const life = num(l);
  const per = num(p);
  if (life <= 0 || per < 1 || per > life) return ERR.NUM;
  return ((num(c) - num(sv)) * (life - per + 1) * 2) / (life * (life + 1));
});
f.scalar('DB', 'cost, salvage, life, period', 'Returns depreciation using the fixed-declining balance method.', ([c, sv, l, p]) => {
  const cost = num(c);
  const life = num(l);
  if (cost <= 0 || life <= 0) return ERR.NUM;
  const rate = Math.round((1 - (num(sv) / cost) ** (1 / life)) * 1000) / 1000;
  let book = cost;
  let dep = 0;
  for (let i = 1; i <= num(p); i++) {
    dep = book * rate;
    book -= dep;
  }
  return dep;
});
f.scalar('EFFECT', 'nominal_rate, npery', 'Returns the effective annual interest rate.', ([r, n]) =>
  num(r) <= 0 || num(n) < 1 ? ERR.NUM : (1 + num(r) / Math.trunc(num(n))) ** Math.trunc(num(n)) - 1,
);
f.scalar('NOMINAL', 'effect_rate, npery', 'Returns the annual nominal interest rate.', ([r, n]) =>
  num(r) <= 0 || num(n) < 1 ? ERR.NUM : ((1 + num(r)) ** (1 / Math.trunc(num(n))) - 1) * Math.trunc(num(n)),
);
f.scalar('RRI', 'nper, pv, fv', 'Returns an equivalent interest rate for growth of an investment.', ([n, pv, fv]) =>
  num(n) <= 0 || num(pv) === 0 ? ERR.NUM : result((num(fv) / num(pv)) ** (1 / num(n)) - 1),
);
