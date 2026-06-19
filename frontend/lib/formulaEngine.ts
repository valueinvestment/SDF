/**
 * formulaEngine.ts
 *
 * 안전한 수식 파서/평가기.
 * - naked eval 사용 금지 — 직접 토큰화 후 재귀 하강 파싱
 * - 지원 연산자: + - * / ( )
 * - 지원 변수: vibration, temperature, current, 커스텀 지표 id
 * - 지원 함수: abs(), min(a,b), max(a,b), sqrt()
 * - 비교 연산자: > < >= <= == !=  (룰 엔진 조건문용, boolean → 0/1)
 */

import type { FormulaResult } from "./types"

// ── Tokenizer ────────────────────────────────────────────────────

type TokenType =
  | "NUMBER" | "IDENT" | "OP" | "LPAREN" | "RPAREN"
  | "COMMA" | "EOF"

interface Token {
  type: TokenType
  value: string
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(src[i + 1] ?? ""))) {
      let num = ""
      while (i < src.length && /[\d.]/.test(src[i])) num += src[i++]
      tokens.push({ type: "NUMBER", value: num })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ""
      while (i < src.length && /[\w]/.test(src[i])) id += src[i++]
      tokens.push({ type: "IDENT", value: id })
      continue
    }
    if (ch === "(") { tokens.push({ type: "LPAREN", value: "(" }); i++; continue }
    if (ch === ")") { tokens.push({ type: "RPAREN", value: ")" }); i++; continue }
    if (ch === ",") { tokens.push({ type: "COMMA", value: "," }); i++; continue }
    // Two-char operators
    const two = src.slice(i, i + 2)
    if ([">=", "<=", "==", "!="].includes(two)) {
      tokens.push({ type: "OP", value: two }); i += 2; continue
    }
    if (["+", "-", "*", "/", ">", "<"].includes(ch)) {
      tokens.push({ type: "OP", value: ch }); i++; continue
    }
    throw new Error(`Unexpected character: '${ch}'`)
  }
  tokens.push({ type: "EOF", value: "" })
  return tokens
}

// ── Recursive Descent Parser ─────────────────────────────────────

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek() { return this.tokens[this.pos] }
  private consume() { return this.tokens[this.pos++] }

  private expect(type: TokenType): Token {
    const t = this.consume()
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type} (${t.value})`)
    return t
  }

  /** comparison → additive ((> | < | >= | <= | == | !=) additive)? */
  parseExpression(vars: Record<string, number>): number {
    const left = this.parseAdditive(vars)
    const op = this.peek()
    if (op.type === "OP" && [">=", "<=", "==", "!=", ">", "<"].includes(op.value)) {
      this.consume()
      const right = this.parseAdditive(vars)
      switch (op.value) {
        case ">":  return left > right  ? 1 : 0
        case "<":  return left < right  ? 1 : 0
        case ">=": return left >= right ? 1 : 0
        case "<=": return left <= right ? 1 : 0
        case "==": return left === right ? 1 : 0
        case "!=": return left !== right ? 1 : 0
      }
    }
    return left
  }

  /** additive → multiplicative ((+ | -) multiplicative)* */
  private parseAdditive(vars: Record<string, number>): number {
    let val = this.parseMultiplicative(vars)
    while (this.peek().type === "OP" && ["+", "-"].includes(this.peek().value)) {
      const op = this.consume().value
      const right = this.parseMultiplicative(vars)
      val = op === "+" ? val + right : val - right
    }
    return val
  }

  /** multiplicative → unary ((* | /) unary)* */
  private parseMultiplicative(vars: Record<string, number>): number {
    let val = this.parseUnary(vars)
    while (this.peek().type === "OP" && ["*", "/"].includes(this.peek().value)) {
      const op = this.consume().value
      const right = this.parseUnary(vars)
      if (op === "/" && right === 0) throw new Error("Division by zero")
      val = op === "*" ? val * right : val / right
    }
    return val
  }

  /** unary → -? primary */
  private parseUnary(vars: Record<string, number>): number {
    if (this.peek().type === "OP" && this.peek().value === "-") {
      this.consume()
      return -this.parsePrimary(vars)
    }
    return this.parsePrimary(vars)
  }

  /** primary → NUMBER | IDENT | IDENT(args) | (expr) */
  private parsePrimary(vars: Record<string, number>): number {
    const t = this.peek()

    if (t.type === "NUMBER") {
      this.consume()
      return parseFloat(t.value)
    }

    if (t.type === "LPAREN") {
      this.consume()
      const val = this.parseExpression(vars)
      this.expect("RPAREN")
      return val
    }

    if (t.type === "IDENT") {
      const name = this.consume().value
      // Built-in functions
      if (this.peek().type === "LPAREN") {
        this.consume() // (
        const args: number[] = []
        if (this.peek().type !== "RPAREN") {
          args.push(this.parseExpression(vars))
          while (this.peek().type === "COMMA") {
            this.consume()
            args.push(this.parseExpression(vars))
          }
        }
        this.expect("RPAREN")
        switch (name) {
          case "abs":  return Math.abs(args[0] ?? 0)
          case "sqrt": return Math.sqrt(Math.max(0, args[0] ?? 0))
          case "min":  return Math.min(args[0] ?? 0, args[1] ?? 0)
          case "max":  return Math.max(args[0] ?? 0, args[1] ?? 0)
          default: throw new Error(`Unknown function: ${name}`)
        }
      }
      // Variable lookup
      if (name in vars) return vars[name]
      throw new Error(`Unknown variable: '${name}'`)
    }

    throw new Error(`Unexpected token: ${t.type} (${t.value})`)
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * 수식을 평가한다.
 * @param formula  수식 문자열 e.g. "(vibration + temperature) / 2"
 * @param vars     변수 맵 (센서값 + 커스텀 지표값)
 */
export function evaluateFormula(
  formula: string,
  vars: Record<string, number>,
): FormulaResult {
  try {
    const tokens = tokenize(formula.trim())
    const parser = new Parser(tokens)
    const value = parser.parseExpression(vars)
    if (!isFinite(value)) return { ok: false, error: "결과가 유한수가 아닙니다" }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * 조건 수식을 평가해 boolean을 반환한다.
 * e.g. "temperature > 100" → true/false
 */
export function evaluateCondition(
  condition: string,
  vars: Record<string, number>,
): boolean {
  const result = evaluateFormula(condition, vars)
  return result.ok ? result.value !== 0 : false
}

/**
 * 수식 유효성 검사 (샘플 변수값으로 파싱 통과 여부 확인)
 */
export function validateFormula(formula: string): { valid: boolean; error?: string } {
  const sampleVars = { vibration: 1, temperature: 1, current: 1 }
  const result = evaluateFormula(formula, sampleVars)
  if (result.ok) return { valid: true }
  return { valid: false, error: result.error }
}
