// A tiny, dependency-free spreadsheet formula evaluator scoped to the exact
// grammar our RA-Bill / Schedule workbooks use:
//   functions: ROUND, SUM, PRODUCT, IF, OR
//   operators: + - * /  , unary minus, postfix %  (Excel "%" = value/100)
//   comparisons: = <> < > <= >=
//   operands: numbers, "double-quoted strings", cell refs (A1, $A$1),
//             sheet-qualified refs (Schedule!A1, 'Sheet Name'!A1) and ranges (A1:B5)
//
// Why this exists: ExcelJS writes our exports with LIVE formulas but NO cached
// result. Excel computes them on open; a fresh export straight from the app has
// blank numbers under the hood. The PDF converter uses cached results when a
// file has them (Excel/hand-made) and falls back to this evaluator otherwise —
// so it renders any workbook regardless of who produced it.
//
// Safety: unknown functions, parse errors (e.g. a real "=I22SUM(...)" typo) and
// reference cycles degrade to blank ('') — the evaluator never throws.

// ---- Excel-compatible helpers ----------------------------------------------
// Excel ROUND is half-away-from-zero (not JS Math.round's half-up).
function roundExcel(x, n) {
  if (!isFinite(x)) return 0;
  const f = Math.pow(10, n);
  const y = x * f;
  // nudge for binary-float error so e.g. 2.675*100 rounds like Excel
  const r = y >= 0 ? Math.floor(y + 0.5 + 1e-9) : Math.ceil(y - 0.5 - 1e-9);
  return r / f;
}

const EMPTY = ''; // our sentinel for an empty/blank cell

function toNum(v) {
  if (v === EMPTY || v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

// flatten scalars + ranges (arrays) into a flat list of primitives
function flatten(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(a);
  }
  return out;
}

// ---- tokenizer --------------------------------------------------------------
const TOKENS = [
  [/^\s+/, null],
  [/^"((?:[^"]|"")*)"/, 'STR'],            // "double quoted" ("" = literal ")
  [/^'((?:[^']|'')*)'!/, 'SHEETQ'],        // 'Sheet Name'! (quoted sheet prefix)
  [/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'NUM'],
  [/^\$?[A-Za-z]{1,3}\$?\d+/, 'CELL'],     // A1, $A$1, AB12
  [/^[A-Za-z_][A-Za-z0-9_.]*/, 'IDENT'],   // function name / bare sheet name / defined name
  [/^<>|^<=|^>=/, 'OP'],
  [/^[-+*/(),:!=<>%&]/, 'OP'],
];

function tokenize(src) {
  let s = src;
  const toks = [];
  while (s.length) {
    let matched = false;
    for (const [re, type] of TOKENS) {
      const m = re.exec(s);
      if (m) {
        matched = true;
        if (type) toks.push({ type, value: m[1] !== undefined ? m[1] : m[0] });
        s = s.slice(m[0].length);
        break;
      }
    }
    if (!matched) throw new Error('bad token near: ' + s.slice(0, 8));
  }
  return toks;
}

// ---- parser (recursive descent) --------------------------------------------
// Produces an AST of nodes: {num}, {str}, {ref}, {range}, {func,args}, {bin,op,l,r}, {neg}, {pct}
function parse(toks) {
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (v) => { const t = next(); if (!t || t.value !== v) throw new Error('expected ' + v); return t; };

  function parseExpr() { return parseCompare(); }

  function parseCompare() {
    let l = parseAdd();
    while (peek() && peek().type === 'OP' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().value)) {
      const op = next().value;
      const r = parseAdd();
      l = { bin: op, l, r };
    }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const r = parseMul();
      l = { bin: op, l, r };
    }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (peek() && peek().type === 'OP' && (peek().value === '*' || peek().value === '/')) {
      const op = next().value;
      const r = parseUnary();
      l = { bin: op, l, r };
    }
    return l;
  }
  function parseUnary() {
    if (peek() && peek().type === 'OP' && (peek().value === '-' || peek().value === '+')) {
      const op = next().value;
      const v = parseUnary();
      return op === '-' ? { neg: v } : v;
    }
    return parsePostfix();
  }
  function parsePostfix() {
    let v = parsePrimary();
    while (peek() && peek().type === 'OP' && peek().value === '%') { next(); v = { pct: v }; }
    return v;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.type === 'NUM') { next(); return { num: parseFloat(t.value) }; }
    if (t.type === 'STR') { next(); return { str: t.value.replace(/""/g, '"') }; }
    if (t.value === '(') { next(); const e = parseExpr(); expect(')'); return e; }
    if (t.type === 'SHEETQ') { next(); return parseRefAfterSheet(t.value); }
    if (t.type === 'IDENT') {
      next();
      if (peek() && peek().value === '(') return parseFunc(t.value);       // FUNC(...)
      if (peek() && peek().value === '!') { next(); return parseRefAfterSheet(t.value); } // Sheet!ref
      return { name: t.value };  // bare defined-name -> resolves to blank
    }
    if (t.type === 'CELL') { next(); return parseRangeMaybe(null, t.value); }
    throw new Error('unexpected token ' + t.value);
  }
  function parseRefAfterSheet(sheet) {
    const c = next();
    if (!c || c.type !== 'CELL') throw new Error('expected cell after sheet');
    return parseRangeMaybe(sheet, c.value);
  }
  function parseRangeMaybe(sheet, first) {
    if (peek() && peek().value === ':') {
      next();
      const c2 = next();
      if (!c2 || c2.type !== 'CELL') throw new Error('expected cell after :');
      return { range: { sheet, a: first, b: c2.value } };
    }
    return { ref: { sheet, a: first } };
  }
  function parseFunc(name) {
    expect('(');
    const args = [];
    if (peek() && peek().value !== ')') {
      args.push(parseExpr());
      while (peek() && peek().value === ',') { next(); args.push(parseExpr()); }
    }
    expect(')');
    return { func: name.toUpperCase(), args };
  }

  const ast = parseExpr();
  if (i !== toks.length) throw new Error('trailing tokens');
  return ast;
}

// ---- address helpers --------------------------------------------------------
function parseAddr(a) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a);
  const col = m[1].toUpperCase();
  let c = 0;
  for (const ch of col) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c, r: parseInt(m[2], 10), col };
}
function addrStr(c, r) {
  let s = '';
  while (c > 0) { const rem = (c - 1) % 26; s = String.fromCharCode(65 + rem) + s; c = Math.floor((c - 1) / 26); }
  return s + r;
}

// ---- evaluator factory ------------------------------------------------------
// getRaw(sheet, addr) must return one of:
//   null/undefined  -> empty cell
//   { formula, result } -> a formula cell (result = cached value or undefined)
//   primitive (number|string) -> a plain value cell
// defaultSheet is used for refs with no sheet qualifier.
export function createEvaluator(getRaw, defaultSheet) {
  const memo = new Map();       // "sheet!ADDR" -> resolved primitive
  const inProgress = new Set(); // cycle guard

  function cellValue(sheet, addr) {
    const sh = sheet || defaultSheet;
    const key = sh + '!' + addr.toUpperCase();
    if (memo.has(key)) return memo.get(key);
    if (inProgress.has(key)) return 0; // cycle -> 0 (never loops forever)
    inProgress.add(key);
    let val = EMPTY;
    try {
      const raw = getRaw(sh, addr.toUpperCase());
      if (raw === null || raw === undefined) val = EMPTY;
      else if (typeof raw === 'object' && (raw.formula !== undefined || raw.result !== undefined)) {
        // formula cell: trust a usable cached result, else evaluate the formula
        if (raw.result !== undefined && raw.result !== null && typeof raw.result !== 'object') {
          val = raw.result;
        } else if (raw.formula) {
          val = evalFormula(raw.formula, sh);
        } else {
          val = EMPTY;
        }
      } else if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
        val = raw;
      } else if (raw && typeof raw === 'object' && 'value' in raw) {
        val = raw.value ?? EMPTY;
      }
    } catch {
      val = EMPTY;
    }
    inProgress.delete(key);
    memo.set(key, val);
    return val;
  }

  function evalNode(node, sheet) {
    if (node.num !== undefined) return node.num;
    if (node.str !== undefined) return node.str;
    if (node.name !== undefined) return EMPTY;               // bare defined name
    if (node.neg !== undefined) return -toNum(evalNode(node.neg, sheet));
    if (node.pct !== undefined) return toNum(evalNode(node.pct, sheet)) / 100;
    if (node.ref) return cellValue(node.ref.sheet || sheet, node.ref.a);
    if (node.range) return expandRange(node.range, sheet);
    if (node.bin) return evalBin(node, sheet);
    if (node.func) return evalFunc(node, sheet);
    return EMPTY;
  }

  function expandRange(range, sheet) {
    const sh = range.sheet || sheet;
    const a = parseAddr(range.a), b = parseAddr(range.b);
    const c1 = Math.min(a.c, b.c), c2 = Math.max(a.c, b.c);
    const r1 = Math.min(a.r, b.r), r2 = Math.max(a.r, b.r);
    const out = [];
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        out.push(cellValue(sh, addrStr(c, r)));
    return out;
  }

  function equal(a, b) {
    if (typeof a === 'string' || typeof b === 'string') {
      return String(a === EMPTY ? '' : a) === String(b === EMPTY ? '' : b);
    }
    return toNum(a) === toNum(b);
  }

  function evalBin(node, sheet) {
    const op = node.bin;
    const l = evalNode(node.l, sheet), r = evalNode(node.r, sheet);
    switch (op) {
      case '+': return toNum(l) + toNum(r);
      case '-': return toNum(l) - toNum(r);
      case '*': return toNum(l) * toNum(r);
      case '/': { const d = toNum(r); return d === 0 ? 0 : toNum(l) / d; }
      case '&': return String(l === EMPTY ? '' : l) + String(r === EMPTY ? '' : r);
      case '=': return equal(l, r);
      case '<>': return !equal(l, r);
      case '<': return toNum(l) < toNum(r);
      case '>': return toNum(l) > toNum(r);
      case '<=': return toNum(l) <= toNum(r);
      case '>=': return toNum(l) >= toNum(r);
      default: return EMPTY;
    }
  }

  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (v === EMPTY) return false;
    if (typeof v === 'number') return v !== 0;
    return String(v).length > 0;
  }

  function evalFunc(node, sheet) {
    const name = node.func;
    const args = node.args.map((a) => evalNode(a, sheet));
    switch (name) {
      case 'ROUND': return roundExcel(toNum(args[0]), Math.trunc(toNum(args[1])));
      case 'SUM': return flatten(args).reduce((s, v) => s + toNum(v), 0);
      case 'PRODUCT': {
        // Excel PRODUCT ignores blank/text cells; product of nothing = 0
        const nums = flatten(args).filter((v) => v !== EMPTY && !(typeof v === 'string' && isNaN(parseFloat(v))));
        if (!nums.length) return 0;
        return nums.reduce((p, v) => p * toNum(v), 1);
      }
      case 'IF': return truthy(args[0]) ? (args[1] ?? EMPTY) : (args[2] ?? EMPTY);
      case 'OR': return flatten(args).some((v) => truthy(v));
      case 'AND': return flatten(args).every((v) => truthy(v));
      case 'ABS': return Math.abs(toNum(args[0]));
      case 'MAX': return Math.max(...flatten(args).map(toNum));
      case 'MIN': return Math.min(...flatten(args).map(toNum));
      default: return EMPTY; // unknown function -> blank (never throws)
    }
  }

  function evalFormula(formula, sheet) {
    const src = String(formula).replace(/^=/, '');
    const ast = parse(tokenize(src));
    return evalNode(ast, sheet || defaultSheet);
  }

  // public: resolve a single cell to a display primitive (number | string | '')
  return function resolve(sheet, addr) {
    const v = cellValue(sheet, addr);
    return v === EMPTY ? '' : v;
  };
}

export { roundExcel };
