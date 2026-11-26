// The pieces of OpenSCAD the generator writes: number expressions over named sizes, and calls of the basic shapes.
// Every part's code is built from these and printed by the functions below, with one fixed number format.

export type Expr = number | { ref: string } | { op: '+' | '-' | '*' | '/'; a: Expr; b: Expr } | { fn: 'max' | 'min' | 'sin' | 'cos'; args: Expr[] };

/** Numbers are rounded to 4 decimals and printed the same way every time. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot write ${value} as OpenSCAD.`);
  const rounded = Math.round(value * 10000) / 10000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

const tidy = (value: number) => Math.round(value * 1e9) / 1e9;

export const ref = (name: string): Expr => ({ ref: name });

export function add(a: Expr, b: Expr): Expr {
  if (typeof a === 'number' && typeof b === 'number') return tidy(a + b);
  if (b === 0) return a;
  if (a === 0) return b;
  if (typeof b === 'number' && b < 0) return sub(a, -b);
  return { op: '+', a, b };
}

export function sub(a: Expr, b: Expr): Expr {
  if (typeof a === 'number' && typeof b === 'number') return tidy(a - b);
  if (b === 0) return a;
  if (a === 0) return neg(b);
  if (typeof b === 'number' && b < 0) return add(a, -b);
  return { op: '-', a, b };
}

export function mul(a: Expr, b: Expr): Expr {
  if (typeof a === 'number' && typeof b === 'number') return tidy(a * b);
  if (a === 0 || b === 0) return 0;
  if (a === 1) return b;
  if (b === 1) return a;
  return { op: '*', a, b };
}

export function div(a: Expr, b: Expr): Expr {
  if (typeof a === 'number' && typeof b === 'number') return tidy(a / b);
  if (b === 1) return a;
  return { op: '/', a, b };
}

export const half = (a: Expr) => div(a, 2);

/** Minus a: written as -a. */
export function neg(a: Expr): Expr {
  return typeof a === 'number' ? tidy(-a) : { op: '-', a: 0, b: a };
}

export function max(...args: Expr[]): Expr {
  return args.every((arg) => typeof arg === 'number') ? Math.max(...(args as number[])) : { fn: 'max', args };
}

export function min(...args: Expr[]): Expr {
  return args.every((arg) => typeof arg === 'number') ? Math.min(...(args as number[])) : { fn: 'min', args };
}

// OpenSCAD's sin and cos take degrees.
const radians = (deg: number) => (deg * Math.PI) / 180;

// Kept as calls even for a plain number, so the code says cos(30) rather than a rounded 0.866.
export const sin = (a: Expr): Expr => ({ fn: 'sin', args: [a] });
export const cos = (a: Expr): Expr => ({ fn: 'cos', args: [a] });

export type Env = Record<string, number>;

export function evaluate(expr: Expr, env: Env): number {
  if (typeof expr === 'number') return expr;
  if ('ref' in expr) {
    const value = env[expr.ref];
    if (value === undefined) throw new Error(`Unknown size: ${expr.ref}`);
    return value;
  }
  if ('fn' in expr) {
    const values = expr.args.map((arg) => evaluate(arg, env));
    if (expr.fn === 'sin') return Math.sin(radians(values[0]!));
    if (expr.fn === 'cos') return Math.cos(radians(values[0]!));
    return expr.fn === 'max' ? Math.max(...values) : Math.min(...values);
  }
  const a = evaluate(expr.a, env);
  const b = evaluate(expr.b, env);
  if (expr.op === '+') return a + b;
  if (expr.op === '-') return a - b;
  if (expr.op === '*') return a * b;
  return a / b;
}

/** The names of the sizes an expression uses. */
export function refs(expr: Expr, into: Set<string> = new Set()): Set<string> {
  if (typeof expr === 'number') return into;
  if ('ref' in expr) into.add(expr.ref);
  else if ('fn' in expr) expr.args.forEach((arg) => refs(arg, into));
  else {
    refs(expr.a, into);
    refs(expr.b, into);
  }
  return into;
}

const rank = (op: string) => (op === '+' || op === '-' ? 1 : 2);

export function expr(e: Expr, parent?: string, right = false): string {
  if (typeof e === 'number') return e < 0 && parent ? `(${num(e)})` : num(e);
  if ('ref' in e) return e.ref;
  if ('fn' in e) return `${e.fn}(${e.args.map((arg) => expr(arg)).join(', ')})`;
  if (e.op === '-' && e.a === 0) {
    const minus = `-${expr(e.b, '*')}`;
    return parent ? `(${minus})` : minus;
  }
  const text = `${expr(e.a, e.op)} ${e.op} ${expr(e.b, e.op, true)}`;
  if (!parent) return text;
  const wrap = rank(e.op) < rank(parent) || (right && rank(e.op) === rank(parent) && (parent === '-' || parent === '/'));
  return wrap ? `(${text})` : text;
}

// ---- statements

export type Arg = Expr | boolean | Arg[];

export type Node = {
  name: string;
  args?: Arg[];
  named?: [string, Arg][];
  loops?: [string, Expr[] | { from: Expr; to: Expr }][];
  kids?: Node[];
};

function arg(value: Arg): string {
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(arg).join(', ')}]`;
  return expr(value);
}

const isZero = (vector: Expr[]) => vector.every((part) => part === 0);

export const cube = (size: Expr[]): Node => ({ name: 'cube', args: [size] });
export const square = (size: Expr[]): Node => ({ name: 'square', args: [size] });
export const circle = (d: Expr): Node => ({ name: 'circle', named: [['d', d]] });
export const polygon = (points: Expr[][]): Node => ({ name: 'polygon', args: [points] });
export const call = (module: string, ...args: Expr[]): Node => ({ name: module, args });

export function cylinder(opts: { d?: Expr; d1?: Expr; d2?: Expr; h: Expr; fn?: number }): Node {
  const named: [string, Arg][] = [];
  if (opts.d !== undefined) named.push(['d', opts.d]);
  if (opts.d1 !== undefined) named.push(['d1', opts.d1]);
  if (opts.d2 !== undefined) named.push(['d2', opts.d2]);
  named.push(['h', opts.h]);
  if (opts.fn !== undefined) named.push(['$fn', opts.fn]);
  return { name: 'cylinder', named };
}

function wrap(name: string, args: Arg[], kids: Node[]): Node {
  return { name, args, kids };
}

export function translate(v: Expr[], ...kids: Node[]): Node {
  return isZero(v) && kids.length === 1 ? kids[0]! : wrap('translate', [v], kids);
}

export function rotate(v: Expr[], ...kids: Node[]): Node {
  return isZero(v) && kids.length === 1 ? kids[0]! : wrap('rotate', [v], kids);
}

export const mirror = (v: Expr[], ...kids: Node[]): Node => wrap('mirror', [v], kids);
export const linearExtrude = (height: Expr, ...kids: Node[]): Node => wrap('linear_extrude', [height], kids);
export const hull = (...kids: Node[]): Node => ({ name: 'hull', kids });
export const union = (...kids: Node[]): Node => ({ name: 'union', kids });
export const difference = (...kids: Node[]): Node => ({ name: 'difference', kids });

export function offset(by: { r: Expr } | { delta: Expr }, ...kids: Node[]): Node {
  return { name: 'offset', named: ['r' in by ? ['r', by.r] : ['delta', by.delta]], kids };
}

export function each(loops: [string, Expr[] | { from: Expr; to: Expr }][], ...kids: Node[]): Node {
  return { name: 'for', loops, kids };
}

function head(node: Node): string {
  if (node.name === 'for') {
    const loops = (node.loops ?? []).map(([name, list]) =>
      Array.isArray(list) ? `${name} = ${arg(list)}` : `${name} = [${expr(list.from)} : ${expr(list.to)}]`,
    );
    return `for (${loops.join(', ')})`;
  }
  const parts = [...(node.args ?? []).map(arg), ...(node.named ?? []).map(([name, value]) => `${name} = ${arg(value)}`)];
  return `${node.name}(${parts.join(', ')})`;
}

const WIDTH = 110;

/** Prints a statement as lines, indented by two spaces per level. A single child stays on the same line when it fits. */
export function lines(node: Node, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  const top = head(node);
  const kids = node.kids;
  if (!kids) return [`${pad}${top};`];
  if (kids.length === 1) {
    const chained = lines(kids[0]!, depth);
    const first = `${pad}${top} ${chained[0]!.trimStart()}`;
    if (first.length <= WIDTH) return [first, ...chained.slice(1)];
    return [`${pad}${top}`, ...lines(kids[0]!, depth + 1)];
  }
  return [`${pad}${top} {`, ...kids.flatMap((kid) => lines(kid, depth + 1)), `${pad}}`];
}

// ---- whole files

export type Param = { name: string; caption: string; value: number; min: number; step: number; max: number };
export type Module = { name: string; body: Node[] };
export type Program = {
  title: string;
  params: Param[];
  hidden: { name: string; value: Expr }[];
  modules: Module[];
  main: Node[];
};

/**
 * The site's format: a title comment, every size as a named number with a caption line above it and a slider range,
 * then the hidden values, the modules and the call.
 */
export function print(program: Program): string {
  const out = [`// ${program.title}`, ''];
  for (const param of program.params) {
    out.push(`// ${param.caption}`, `${param.name} = ${num(param.value)}; // [${num(param.min)}:${num(param.step)}:${num(param.max)}]`);
  }
  if (program.hidden.length) {
    out.push('', '/* [Hidden] */');
    for (const { name, value } of program.hidden) out.push(`${name} = ${expr(value)};`);
  }
  for (const module of program.modules) {
    out.push('', `module ${module.name}() {`, ...module.body.flatMap((node) => lines(node, 1)), '}');
  }
  out.push('', ...program.main.flatMap((node) => lines(node)));
  return `${out.join('\n')}\n`;
}
