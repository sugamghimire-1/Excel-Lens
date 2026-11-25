import { describe, expect, it } from 'vitest';
import { allFunctions, FormulaSyntaxError, parseFormula } from '@/formulas';
import { dateToSerial } from '@/formulas/values';
import { calc, Harness } from './helpers';

const table = { A1: 'Name', B1: 'Dept', C1: 'Pay', A2: 'Ann', B2: 'Ops', C2: 100, A3: 'Bo', B3: 'IT', C3: 250, A4: 'Cy', B4: 'Ops', C4: 300, A5: 'Di', B5: 'HR', C5: 50 };

describe('operators', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=2^3^2', 64],
    ['=-2^2', 4],
    ['=10/4', 2.5],
    ['=50%', 0.5],
    ['=200*10%', 20],
    ['="a"&"b"&1', 'ab1'],
    ['=1=1', true],
    ['="A"="a"', true],
    ['=1<>2', true],
    ['=3>=3', true],
    ['="b">"a"', true],
    ['=1<"a"', true],
    ['=0.1+0.2-0.3', 0],
    ['=--"5"', 5],
    ['="3"*"4"', 12],
    ['=TRUE+1', 2],
  ])('%s', (f, expected) => {
    expect(calc(f)).toBe(expected);
  });
});

describe('errors', () => {
  it.each([
    ['=1/0', '#DIV/0!'],
    ['="a"*2', '#VALUE!'],
    ['=NOPE(1)', '#NAME?'],
    ['=undefined_name', '#NAME?'],
    ['=VLOOKUP("x",A1:B2,2,FALSE)', '#N/A'],
    ['=SQRT(-1)', '#NUM!'],
    ['=Missing!A1', '#REF!'],
    ['=#REF!+1', '#REF!'],
    ['=INDEX(A1:B2,5,1)', '#REF!'],
    ['=NA()', '#N/A'],
    ['=SUM(1,1/0)', '#DIV/0!'],
    ['=1+', '#NAME?'],
  ])('%s gives %s', (f, code) => {
    expect(calc(f)).toBe(code);
  });

  it('reports syntax errors with a position', () => {
    expect(() => parseFormula('=SUM(1,2')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('=1 2')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('={1,2;3}')).toThrow(FormulaSyntaxError);
  });

  it('catches errors with IFERROR and IFNA', () => {
    expect(calc('=IFERROR(1/0,"oops")')).toBe('oops');
    expect(calc('=IFERROR(5,"oops")')).toBe(5);
    expect(calc('=IFNA(NA(),"none")')).toBe('none');
    expect(calc('=IFNA(1/0,"none")')).toBe('#DIV/0!');
  });
});

describe('math', () => {
  it.each([
    ['=SUM(1,2,3)', 6],
    ['=SUM(A1:A3,10)', 16],
    ['=AVERAGE(A1:A3)', 2],
    ['=MIN(A1:A3)', 1],
    ['=MAX(A1:A3)', 3],
    ['=COUNT(A1:A5)', 3],
    ['=COUNTA(A1:A5)', 4],
    ['=COUNTBLANK(A1:A5)', 1],
    ['=ROUND(2.675,2)', 2.68],
    ['=ROUND(-2.5,0)', -3],
    ['=ROUND(1234,-2)', 1200],
    ['=ROUNDUP(3.2,0)', 4],
    ['=ROUNDUP(-3.2,0)', -4],
    ['=ROUNDDOWN(3.99,1)', 3.9],
    ['=ABS(-4)', 4],
    ['=SQRT(16)', 4],
    ['=POWER(2,10)', 1024],
    ['=MOD(-3,2)', 1],
    ['=INT(-1.5)', -2],
    ['=TRUNC(-1.5)', -1],
    ['=CEILING(4.1,0.5)', 4.5],
    ['=FLOOR(4.9,0.5)', 4.5],
    ['=SUMPRODUCT({1,2,3},{4,5,6})', 32],
    ['=GCD(12,18)', 6],
    ['=LCM(4,6)', 12],
    ['=FACT(5)', 120],
    ['=COMBIN(5,2)', 10],
    ['=SIGN(-3)', -1],
  ])('%s', (f, expected) => {
    expect(calc(f, { A1: 1, A2: 2, A3: 3, A4: 'x' })).toBe(expected);
  });

  it('ignores text inside ranges but not in direct arguments', () => {
    expect(calc('=SUM(A1:A2)', { A1: 1, A2: 'x' })).toBe(1);
    expect(calc('=SUM("x")')).toBe('#VALUE!');
    expect(calc('=SUM("2",TRUE)')).toBe(3);
  });
});

describe('conditional aggregates', () => {
  it.each([
    ['=SUMIF(B2:B5,"Ops",C2:C5)', 400],
    ['=SUMIF(C2:C5,">100")', 550],
    ['=COUNTIF(B2:B5,"o*")', 2],
    ['=COUNTIF(A2:A5,"??")', 3],
    ['=COUNTIF(C2:C5,"<>100")', 3],
    ['=AVERAGEIF(B2:B5,"Ops",C2:C5)', 200],
    ['=SUMIFS(C2:C5,B2:B5,"Ops",C2:C5,">150")', 300],
    ['=COUNTIFS(B2:B5,"Ops",C2:C5,"<200")', 1],
    ['=MAXIFS(C2:C5,B2:B5,"Ops")', 300],
    ['=MINIFS(C2:C5,B2:B5,"Ops")', 100],
    ['=AVERAGEIF(B2:B5,"None",C2:C5)', '#DIV/0!'],
    ['=SUMIF(B:B,"Ops",C:C)', 400],
  ])('%s', (f, expected) => {
    expect(calc(f, table)).toBe(expected);
  });
});

describe('logic', () => {
  it.each([
    ['=IF(1>2,"y","n")', 'n'],
    ['=IF(TRUE,"y")', 'y'],
    ['=IF(FALSE,"y")', false],
    ['=IF(TRUE,1,1/0)', 1],
    ['=AND(TRUE,1,"true")', true],
    ['=AND(TRUE,FALSE)', false],
    ['=OR(FALSE,0,1)', true],
    ['=NOT(FALSE)', true],
    ['=XOR(TRUE,TRUE,TRUE)', true],
    ['=IFS(1>2,"a",2>1,"b")', 'b'],
    ['=SWITCH(2,1,"one",2,"two","other")', 'two'],
    ['=SWITCH(9,1,"one","other")', 'other'],
    ['=CHOOSE(2,"a","b","c")', 'b'],
    ['=LET(x,5,y,x*2,x+y)', 15],
  ])('%s', (f, expected) => {
    expect(calc(f)).toBe(expected);
  });
});

describe('lookup', () => {
  it.each([
    ['=VLOOKUP("Bo",A2:C5,3,FALSE)', 250],
    ['=VLOOKUP("b*",A2:C5,2,FALSE)', 'IT'],
    ['=VLOOKUP("Zed",A2:C5,3,FALSE)', '#N/A'],
    ['=VLOOKUP("Bo",A2:C5,9,FALSE)', '#REF!'],
    ['=HLOOKUP("Pay",A1:C5,3,FALSE)', 250],
    ['=INDEX(A2:C5,2,3)', 250],
    ['=INDEX(C2:C5,3)', 300],
    ['=MATCH("Cy",A2:A5,0)', 3],
    ['=INDEX(C2:C5,MATCH("Di",A2:A5,0))', 50],
    ['=XLOOKUP("Cy",A2:A5,C2:C5)', 300],
    ['=XLOOKUP("Zed",A2:A5,C2:C5,"none")', 'none'],
    ['=XMATCH("Di",A2:A5)', 4],
    ['=ROW(C7)', 7],
    ['=COLUMN(C7)', 3],
    ['=ROWS(A2:C5)', 4],
    ['=COLUMNS(A2:C5)', 3],
    ['=SUM(OFFSET(C2,1,0,2,1))', 550],
    ['=INDIRECT("C"&3)', 250],
    ['=ADDRESS(2,3)', '$C$2'],
    ['=SUM(C2:INDEX(C2:C5,2))', 350],
  ])('%s', (f, expected) => {
    expect(calc(f, table)).toBe(expected);
  });

  it('does approximate matches on sorted data', () => {
    const grades = { A1: 0, B1: 'F', A2: 60, B2: 'D', A3: 70, B3: 'C', A4: 80, B4: 'B', A5: 90, B5: 'A' };
    expect(calc('=VLOOKUP(85,A1:B5,2)', grades)).toBe('B');
    expect(calc('=VLOOKUP(90,A1:B5,2,TRUE)', grades)).toBe('A');
    expect(calc('=VLOOKUP(-1,A1:B5,2)', grades)).toBe('#N/A');
    expect(calc('=MATCH(75,A1:A5)', grades)).toBe(3);
    expect(calc('=XLOOKUP(75,A1:A5,B1:B5,"",-1)', grades)).toBe('C');
    expect(calc('=XLOOKUP(75,A1:A5,B1:B5,"",1)', grades)).toBe('B');
  });
});

describe('text', () => {
  it.each([
    ['=CONCAT("a",1,TRUE)', 'a1TRUE'],
    ['=CONCATENATE("a","-","b")', 'a-b'],
    ['=LEFT("hello",2)', 'he'],
    ['=RIGHT("hello",3)', 'llo'],
    ['=MID("hello",2,3)', 'ell'],
    ['=LEN("hello")', 5],
    ['=TRIM("  a   b ")', 'a b'],
    ['=UPPER("abc")', 'ABC'],
    ['=LOWER("ABC")', 'abc'],
    ['=PROPER("john o\'neil")', "John O'Neil"],
    ['=TEXT(1234.567,"#,##0.00")', '1,234.57'],
    ['=TEXT(0.256,"0.0%")', '25.6%'],
    ['=TEXT(DATE(2026,3,9),"yyyy-mm-dd")', '2026-03-09'],
    ['=FIND("l","hello")', 3],
    ['=SEARCH("L","hello")', 3],
    ['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
    ['=SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
    ['=REPLACE("abcdef",2,3,"X")', 'aXef'],
    ['=REPT("ab",3)', 'ababab'],
    ['=TEXTJOIN(", ",TRUE,"a","","b")', 'a, b'],
    ['=VALUE("1,234")', 1234],
    ['=EXACT("a","A")', false],
    ['=TEXTBEFORE("a/b/c","/")', 'a'],
    ['=TEXTAFTER("a/b/c","/",2)', 'c'],
    ['="say ""hi"""', 'say "hi"'],
  ])('%s', (f, expected) => {
    expect(calc(f)).toBe(expected);
  });
});

describe('dates', () => {
  it.each([
    ['=DATE(2024,2,29)', dateToSerial(2024, 2, 29)],
    ['=YEAR(DATE(2026,7,4))', 2026],
    ['=MONTH(DATE(2026,7,4))', 7],
    ['=DAY(DATE(2026,7,4))', 4],
    ['=DATE(2026,13,1)', dateToSerial(2027, 1, 1)],
    ['=EDATE(DATE(2026,1,31),1)', dateToSerial(2026, 2, 28)],
    ['=EOMONTH(DATE(2026,1,15),0)', dateToSerial(2026, 1, 31)],
    ['=WEEKDAY(DATE(2026,11,25))', 4],
    ['=DAYS(DATE(2026,1,31),DATE(2026,1,1))', 30],
    ['=DATEDIF(DATE(2020,1,15),DATE(2026,1,14),"Y")', 5],
    ['=NETWORKDAYS(DATE(2026,11,23),DATE(2026,11,29))', 5],
    ['=WORKDAY(DATE(2026,11,27),1)', dateToSerial(2026, 11, 30)],
    ['=HOUR(TIME(13,45,0))', 13],
    ['=MINUTE("1:45 PM")', 45],
  ])('%s', (f, expected) => {
    expect(calc(f)).toBe(expected);
  });

  it('TODAY and NOW follow the engine clock', () => {
    const h = new Harness({ Sheet1: { A1: '=TODAY()', A2: '=NOW()' } });
    h.engine.clock = () => new Date(2026, 10, 25, 12, 0, 0);
    h.engine.calculateNow();
    expect(h.get('A1')).toBe(dateToSerial(2026, 11, 25));
    expect(h.get('A2')).toBe(dateToSerial(2026, 11, 25) + 0.5);
  });
});

describe('statistics and finance', () => {
  it.each([
    ['=MEDIAN(1,2,3,4)', 2.5],
    ['=LARGE({5,1,9},2)', 5],
    ['=SMALL({5,1,9},1)', 1],
    ['=RANK(5,{5,1,9})', 2],
    ['=STDEV.P(2,4,4,4,5,5,7,9)', 2],
    ['=VAR.S(1,2,3,4)', 5 / 3],
    ['=QUARTILE({1,2,3,4},2)', 2.5],
    ['=NPER(0,-100,1000)', 10],
  ])('%s', (f, expected) => {
    expect(calc(f)).toBeCloseTo(expected, 10);
  });

  it('matches known loan figures', () => {
    expect(calc('=PMT(0.05/12,360,200000)')).toBeCloseTo(-1073.64, 2);
    expect(calc('=FV(0.06/12,10,-200,-500,1)')).toBeCloseTo(2581.4, 1);
    expect(calc('=NPV(0.1,-10000,3000,4200,6800)')).toBeCloseTo(1188.44, 2);
    expect(calc('=IRR({-70000,12000,15000,18000,21000,26000})')).toBeCloseTo(0.0866, 4);
    expect(calc('=RATE(48,-200,8000)')).toBeCloseTo(0.0077, 4);
  });
});

describe('dynamic arrays', () => {
  it('spills and clears', () => {
    const h = new Harness({ Sheet1: { A1: '=SEQUENCE(3,2)' } });
    expect([h.get('A1'), h.get('B1'), h.get('A3'), h.get('B3')]).toEqual([1, 2, 5, 6]);
    h.set('A1', '1');
    expect(h.get('B3')).toBe(null);
  });

  it('reports #SPILL! when blocked and recovers', () => {
    const h = new Harness({ Sheet1: { A1: '=SEQUENCE(3)', A2: 'x', C1: '=SUM(A1:A3)' } });
    expect(h.get('A1')).toBe('#SPILL!');
    h.set('A2', '');
    expect(h.get('A1')).toBe(1);
    expect(h.get('A3')).toBe(3);
    expect(h.get('C1')).toBe(6);
    h.set('A3', 'block');
    expect(h.get('A1')).toBe('#SPILL!');
  });

  it('SORT, FILTER, UNIQUE and the spill operator work together', () => {
    const h = new Harness({ Sheet1: { ...table, E1: '=SORT(FILTER(C2:C5,C2:C5>=100),1,-1)', F1: '=SUM(E1#)', G1: '=COUNTA(UNIQUE(B2:B5))' } });
    expect([h.get('E1'), h.get('E2'), h.get('E3'), h.get('E4')]).toEqual([300, 250, 100, null]);
    expect(h.get('F1')).toBe(650);
    expect(h.get('G1')).toBe(3);
    h.set('C5', '400');
    expect(h.get('E1')).toBe(400);
    expect(h.get('F1')).toBe(1050);
  });

  it('broadcasts operators and scalar functions', () => {
    expect(calc('=SUM(A1:A3*B1:B3)', { A1: 1, A2: 2, A3: 3, B1: 4, B2: 5, B3: 6 })).toBe(32);
    expect(calc('=SUM(IF({1,2,3}>1,10,0))')).toBe(20);
    expect(calc('=SUM(LEN({"a","bb","ccc"}))')).toBe(6);
  });
});

describe('library', () => {
  it('documents every function', () => {
    const fns = allFunctions();
    expect(fns.length).toBeGreaterThan(180);
    for (const f of fns) {
      expect(f.summary.length, f.name).toBeGreaterThan(5);
      expect(f.max, f.name).toBeGreaterThanOrEqual(f.min);
    }
  });
});
