import { registrar } from '../registry';
import { dateToSerial, ERR, localDateToSerial, parseDateText, serialToDate, type EvalValue, type Scalar } from '../values';
import type { EvalScope } from '../evaluator';
import { int, num, numbers, numOf, text } from './helpers';

const f = registrar('Date');

function serial(v: Scalar | undefined): number {
  const n = num(v);
  if (n < 0) throw ERR.NUM;
  return n;
}

const date = (v: Scalar | undefined): Date => serialToDate(serial(v));

f.volatileRange('TODAY', '', "Returns the serial number of today's date.", (_a, s) => Math.floor(localDateToSerial(s.ctx.now())));
f.volatileRange('NOW', '', 'Returns the serial number of the current date and time.', (_a, s) => localDateToSerial(s.ctx.now()));

f.scalar('DATE', 'year, month, day', 'Returns the serial number of a particular date.', ([y, m, d]) => {
  let year = int(y);
  if (year < 0 || year > 9999) return ERR.NUM;
  if (year < 1900) year += 1900;
  const n = dateToSerial(year, int(m), int(d));
  return n < 0 ? ERR.NUM : n;
});
f.scalar('TIME', 'hour, minute, second', 'Returns the serial number of a particular time.', ([h, m, sec]) => {
  const total = int(h) * 3600 + int(m) * 60 + int(sec);
  return total < 0 ? ERR.NUM : (total % 86400) / 86400;
});
f.scalar('DATEVALUE', 'date_text', 'Converts a date in the form of text to a serial number.', ([t]) => {
  const d = parseDateText(text(t));
  return d?.hasDate ? Math.floor(d.serial) : ERR.VALUE;
});
f.scalar('TIMEVALUE', 'time_text', 'Converts a time in the form of text to a serial number.', ([t]) => {
  const d = parseDateText(text(t));
  return d ? d.serial - Math.floor(d.serial) : ERR.VALUE;
});

f.scalar('YEAR', 'serial_number', 'Converts a serial number to a year.', ([d]) => date(d).getUTCFullYear());
f.scalar('MONTH', 'serial_number', 'Converts a serial number to a month.', ([d]) => date(d).getUTCMonth() + 1);
f.scalar('DAY', 'serial_number', 'Converts a serial number to a day of the month.', ([d]) => date(d).getUTCDate());
f.scalar('HOUR', 'serial_number', 'Converts a serial number to an hour.', ([d]) => date(d).getUTCHours());
f.scalar('MINUTE', 'serial_number', 'Converts a serial number to a minute.', ([d]) => date(d).getUTCMinutes());
f.scalar('SECOND', 'serial_number', 'Converts a serial number to a second.', ([d]) => date(d).getUTCSeconds());

f.scalar('WEEKDAY', 'serial_number, [return_type]', 'Converts a serial number to a day of the week.', ([d, t]) => {
  const dow = date(d).getUTCDay();
  const type = int(t, 1);
  if (type === 1 || type === 17) return dow + 1;
  if (type === 2 || type === 11) return ((dow + 6) % 7) + 1;
  if (type === 3) return (dow + 6) % 7;
  if (type >= 12 && type <= 16) return ((dow - (type - 10) + 7) % 7) + 1;
  return ERR.NUM;
});
f.scalar('WEEKNUM', 'serial_number, [return_type]', 'Returns the week number in the year.', ([d, t]) => {
  const when = date(d);
  const startsMonday = int(t, 1) === 2;
  const jan1 = Date.UTC(when.getUTCFullYear(), 0, 1);
  const offset = (new Date(jan1).getUTCDay() + (startsMonday ? 6 : 0)) % 7;
  const day = Math.floor((when.getTime() - jan1) / 86_400_000);
  return Math.floor((day + offset) / 7) + 1;
});
f.scalar('ISOWEEKNUM', 'date', 'Returns the ISO week number of the year.', ([d]) => {
  const when = date(d);
  const thursday = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate() + 3 - ((when.getUTCDay() + 6) % 7)));
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
});

function addMonths(start: number, months: number): Date {
  const d = serialToDate(Math.floor(start));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target;
}
const fromDate = (d: Date): number => dateToSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

f.scalar('EDATE', 'start_date, months', 'Returns the date a number of months before or after the start date.', ([d, m]) => fromDate(addMonths(serial(d), int(m))));
f.scalar('EOMONTH', 'start_date, months', 'Returns the last day of the month before or after a number of months.', ([d, m]) => {
  const t = serialToDate(Math.floor(serial(d)));
  return fromDate(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + int(m) + 1, 0)));
});
f.scalar('DAYS', 'end_date, start_date', 'Returns the number of days between two dates.', ([a, b]) => Math.floor(num(a)) - Math.floor(num(b)));
f.scalar('DAYS360', 'start_date, end_date', 'Calculates days between two dates on a 360-day year.', ([a, b]) => {
  const s = date(a);
  const e = date(b);
  const d1 = Math.min(s.getUTCDate(), 30);
  const d2 = d1 === 30 ? Math.min(e.getUTCDate(), 30) : e.getUTCDate();
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 360 + (e.getUTCMonth() - s.getUTCMonth()) * 30 + (d2 - d1);
});
f.scalar('DATEDIF', 'start_date, end_date, unit', 'Calculates days, months, or years between two dates.', ([a, b, u]) => {
  const s = Math.floor(serial(a));
  const e = Math.floor(serial(b));
  if (s > e) return ERR.NUM;
  const ds = serialToDate(s);
  const de = serialToDate(e);
  let months = (de.getUTCFullYear() - ds.getUTCFullYear()) * 12 + de.getUTCMonth() - ds.getUTCMonth();
  if (de.getUTCDate() < ds.getUTCDate()) months--;
  switch (text(u).toUpperCase()) {
    case 'D':
      return e - s;
    case 'M':
      return months;
    case 'Y':
      return Math.floor(months / 12);
    case 'YM':
      return months % 12;
    case 'MD':
      return e - fromDate(addMonths(s, months));
    case 'YD':
      return e - fromDate(addMonths(s, Math.floor(months / 12) * 12));
    default:
      return ERR.NUM;
  }
});
f.scalar('YEARFRAC', 'start_date, end_date, [basis]', 'Returns the fraction of the year between two dates.', ([a, b, basis]) => {
  const days = Math.abs(Math.floor(num(b)) - Math.floor(num(a)));
  switch (int(basis, 0)) {
    case 1: {
      const y1 = date(a).getUTCFullYear();
      const y2 = date(b).getUTCFullYear();
      let total = 0;
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) total += dateToSerial(y + 1, 1, 1) - dateToSerial(y, 1, 1);
      return days / (total / (Math.abs(y2 - y1) + 1));
    }
    case 2:
      return days / 360;
    case 3:
      return days / 365;
    default: {
      const s = date(num(a) < num(b) ? a : b);
      const e = date(num(a) < num(b) ? b : a);
      const d1 = Math.min(s.getUTCDate(), 30);
      const d2 = d1 === 30 ? Math.min(e.getUTCDate(), 30) : e.getUTCDate();
      return ((e.getUTCFullYear() - s.getUTCFullYear()) * 360 + (e.getUTCMonth() - s.getUTCMonth()) * 30 + d2 - d1) / 360;
    }
  }
});

function holidaySet(v: EvalValue | undefined, s: EvalScope): Set<number> {
  return new Set(v === undefined || v === null ? [] : numbers([v], s).map(Math.floor));
}
const isWeekend = (n: number): boolean => {
  const dow = serialToDate(n).getUTCDay();
  return dow === 0 || dow === 6;
};
f.range('NETWORKDAYS', 'start_date, end_date, [holidays]', 'Returns the number of whole workdays between two dates.', (args, s) => {
  let a = Math.floor(numOf(args[0], s));
  let b = Math.floor(numOf(args[1], s));
  const sign = a > b ? -1 : 1;
  if (a > b) [a, b] = [b, a];
  const off = holidaySet(args[2], s);
  let n = 0;
  for (let d = a; d <= b; d++) if (!isWeekend(d) && !off.has(d)) n++;
  return sign * n;
});
f.range('WORKDAY', 'start_date, days, [holidays]', 'Returns the date before or after a number of workdays.', (args, s) => {
  let d = Math.floor(numOf(args[0], s));
  let left = Math.trunc(numOf(args[1], s));
  const off = holidaySet(args[2], s);
  const step = Math.sign(left);
  while (left !== 0) {
    d += step;
    if (d < 0) return ERR.NUM;
    if (!isWeekend(d) && !off.has(d)) left -= step;
  }
  return d;
});
