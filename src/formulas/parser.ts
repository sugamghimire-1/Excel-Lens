import type { CellError } from '@/types';
import { tokenize, type RefInfo, type Token } from './tokenizer';
import { ERR, errorFromCode } from './values';

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=' | ':';

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: CellError }
  | { k: 'ref'; ref: RefInfo }
  | { k: 'spill'; of: Ast }
  | { k: 'name'; name: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'unary'; op: '+' | '-'; a: Ast }
  | { k: 'percent'; a: Ast }
  | { k: 'bin'; op: BinaryOp; a: Ast; b: Ast }
  | { k: 'array'; rows: Ast[][] }
  | { k: 'missing' };

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

const BINARY: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
  ':': 8,
};

const UNARY_BP = 6;

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(private readonly source: string) {
    this.tokens = tokenize(source).filter((t) => t.type !== 'ws');
  }

  parse(): Ast {
    if (this.tokens.length === 0) throw this.fail('The formula is empty.');
    const ast = this.expr(0);
    if (this.peek()) throw this.fail(`Unexpected "${this.peek()!.text}".`);
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw this.fail('The formula ends too soon.');
    return t;
  }

  private fail(message: string): FormulaSyntaxError {
    const t = this.tokens[Math.min(this.pos, this.tokens.length - 1)];
    return new FormulaSyntaxError(message, t ? t.start : this.source.length);
  }

  private expr(minBp: number): Ast {
    let left = this.prefix();
    for (;;) {
      const t = this.peek();
      if (!t || t.type !== 'op') break;
      if (t.text === '%') {
        this.pos++;
        left = { k: 'percent', a: left };
        continue;
      }
      if (t.text === '#') {
        this.pos++;
        left = { k: 'spill', of: left };
        continue;
      }
      const bp = BINARY[t.text];
      if (bp === undefined || bp <= minBp) break;
      this.pos++;
      const right = this.expr(bp);
      left = { k: 'bin', op: t.text as BinaryOp, a: left, b: right };
    }
    return left;
  }

  private prefix(): Ast {
    const t = this.next();
    switch (t.type) {
      case 'num':
        return { k: 'num', v: Number(t.text) };
      case 'str':
        return { k: 'str', v: t.text.slice(1, -1).replace(/""/g, '"') };
      case 'bool':
        return { k: 'bool', v: t.text.toUpperCase() === 'TRUE' };
      case 'err': {
        const code = t.text.slice(t.text.indexOf('#'));
        return { k: 'err', v: errorFromCode(code) ?? ERR.REF };
      }
      case 'ref':
        return { k: 'ref', ref: t.ref! };
      case 'name':
        return { k: 'name', name: t.text };
      case 'func':
        return this.call(t.text);
      case 'lparen': {
        const inner = this.expr(0);
        this.expect('rparen', 'A closing parenthesis is missing.');
        return inner;
      }
      case 'lbrace':
        return this.arrayLiteral();
      case 'op':
        if (t.text === '-' || t.text === '+') return { k: 'unary', op: t.text, a: this.expr(UNARY_BP) };
        if (t.text === '@') return this.expr(UNARY_BP);
        break;
      default:
        break;
    }
    this.pos--;
    throw this.fail(`Unexpected "${t.text}".`);
  }

  private expect(type: Token['type'], message: string): void {
    const t = this.peek();
    if (!t || t.type !== type) throw this.fail(message);
    this.pos++;
  }

  private call(name: string): Ast {
    this.expect('lparen', 'An opening parenthesis is missing.');
    const args: Ast[] = [];
    if (this.peek()?.type === 'rparen') {
      this.pos++;
      return { k: 'call', name: canonicalName(name), args };
    }
    for (;;) {
      const t = this.peek();
      if (t?.type === 'sep' || t?.type === 'rparen') args.push({ k: 'missing' });
      else args.push(this.expr(0));
      const end = this.peek();
      if (end?.type === 'sep') {
        this.pos++;
        continue;
      }
      this.expect('rparen', 'A closing parenthesis is missing.');
      break;
    }
    return { k: 'call', name: canonicalName(name), args };
  }

  private arrayLiteral(): Ast {
    const rows: Ast[][] = [[]];
    for (;;) {
      rows[rows.length - 1].push(this.expr(0));
      const t = this.next();
      if (t.type === 'sep') continue;
      if (t.type === 'semi') {
        rows.push([]);
        continue;
      }
      if (t.type === 'rbrace') break;
      this.pos--;
      throw this.fail('An array constant is not closed.');
    }
    if (rows.some((r) => r.length !== rows[0].length)) throw this.fail('Array rows must have the same length.');
    return { k: 'array', rows };
  }
}

/** Strips the prefixes other applications put on newer functions in files. */
function canonicalName(name: string): string {
  return name.toUpperCase().replace(/^_XLFN\.(?:_XLWS\.)?/, '').replace(/^_XLWS\./, '');
}

const cache = new Map<string, Ast>();

/** Parses formula text (with or without the leading `=`). Results are cached. */
export function parseFormula(source: string): Ast {
  const hit = cache.get(source);
  if (hit) return hit;
  const ast = new Parser(source).parse();
  if (cache.size > 20_000) cache.clear();
  cache.set(source, ast);
  return ast;
}

export function walkAst(ast: Ast, visit: (node: Ast) => void): void {
  visit(ast);
  switch (ast.k) {
    case 'spill':
      walkAst(ast.of, visit);
      break;
    case 'call':
      for (const a of ast.args) walkAst(a, visit);
      break;
    case 'unary':
    case 'percent':
      walkAst(ast.a, visit);
      break;
    case 'bin':
      walkAst(ast.a, visit);
      walkAst(ast.b, visit);
      break;
    case 'array':
      for (const row of ast.rows) for (const a of row) walkAst(a, visit);
      break;
    default:
      break;
  }
}
