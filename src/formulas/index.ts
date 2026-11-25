/** Formula engine entry point. Importing it registers the whole function library. */
import './functions/math';
import './functions/statistical';
import './functions/logical';
import './functions/lookup';
import './functions/text';
import './functions/date';
import './functions/information';
import './functions/financial';
import './functions/array';

export { CalcEngine } from './calcEngine';
export { evaluate, type CalcContext, type EvalScope } from './evaluator';
export { FormulaSyntaxError, parseFormula, walkAst, type Ast } from './parser';
export { allFunctions, getFunction, signatureText, type FunctionCategory, type FunctionDef } from './registry';
export { tokenize, type RefInfo, type Token } from './tokenizer';
