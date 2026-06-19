/**
 * formulaEngine — Safe expression parser/evaluator.
 *
 * No naked eval — hand-written tokenizer + recursive descent parser.
 * Operators: + - * / ( )
 * Variables: vibration, temperature, current, custom metric ids
 * Functions: abs(), min(a,b), max(a,b), sqrt()
 * Comparisons: > < >= <= == != (boolean → 0/1)
 */

import type { FormulaResult } from "@sdf/types"

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

  private parseAdditive(vars: Record<string, number>): number {
    let val = this.parseMultiplicative(vars)
    while (this.peek().type === "OP" && ["+", "-"].includes(this.peek().value)) {
      const op = this.consume().value
      const right = this.parseMultiplicative(vars)
      val = op === "+" ? val + right : val - right
    }
    return val
  }

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

  private parseUnary(vars: Record<string, number>): number {
    if (this.peek().type === "OP" && this.peek().value === "-") {
      this.consume()
      return -this.parsePrimary(vars)
    }
    return this.parsePrimary(vars)
  }

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
      if (this.peek().type === "LPAREN") {
        this.consume()
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
      if (name in vars) return vars[name]
      throw new Error(`Unknown variable: '${name}'`)
    }

    throw new Error(`Unexpected token: ${t.type} (${t.value})`)
  }
}

// ── Public API ───────────────────────────────────────────────────

export function evaluateFormula(
  formula: string,
  vars: Record<string, number>,
): FormulaResult {
  try {
    const tokens = tokenize(formula.trim())
    const parser = new Parser(tokens)
    const value = parser.parseExpression(vars)
    if (!isFinite(value)) return { ok: false, error: "Result is not a finite number" }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function evaluateCondition(
  condition: string,
  vars: Record<string, number>,
): boolean {
  const result = evaluateFormula(condition, vars)
  return result.ok ? result.value !== 0 : false
}

export function validateFormula(formula: string): { valid: boolean; error?: string } {
  const sampleVars = { vibration: 1, temperature: 1, current: 1 }
  const result = evaluateFormula(formula, sampleVars)
  if (result.ok) return { valid: true }
  return { valid: false, error: result.error }
}
