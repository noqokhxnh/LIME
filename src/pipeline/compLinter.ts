import { videoScript } from "../llm/schema.js";
import * as acorn from "acorn";

export type ViolationType =
  | "MATH_RANDOM"
  | "DATE_NOW"
  | "DATE_CONSTRUCTOR_NOW"
  | "PERFORMANCE_NOW"
  | "REQUEST_ANIMATION_FRAME"
  | "NON_DETERMINISTIC_TIMER"
  | "LAYOUT_THRASHING"
  | "UNPAUSED_TIMELINE"
  | "OVERLAPPING_TWEEN";

export interface LintViolation {
  type: ViolationType;
  message: string;
  line: number;
  column: number;
  snippet: string;
  sceneId?: string;
  source?: string;
}

export interface LintResult {
  valid: boolean;
  violations: LintViolation[];
  errors: string[];
}

export class DeterministicContractError extends Error {
  public violations: LintViolation[];

  constructor(message: string, violations: LintViolation[] = []) {
    super(message);
    this.name = "DeterministicContractError";
    this.violations = violations;
  }
}

interface LintRule {
  type: ViolationType;
  pattern: RegExp;
  message: string;
}

const LINT_RULES: LintRule[] = [
  {
    type: "MATH_RANDOM",
    pattern: /\bMath\.random\s*\(/g,
    message: "Forbidden non-deterministic call Math.random(). Use window.__rand() or seeded PRNG instead.",
  },
  {
    type: "DATE_NOW",
    pattern: /\bDate\.now\s*\(/g,
    message: "Forbidden non-deterministic call Date.now(). Animation poses must be a pure function of timeline seek f(t).",
  },
  {
    type: "DATE_CONSTRUCTOR_NOW",
    pattern: /\b(?:new\s+Date|(?<![\w$.])Date)\s*\(\s*\)/g,
    message: "Forbidden non-deterministic Date() call without arguments (reads system clock). Use timeline seek f(t) instead.",
  },
  {
    type: "PERFORMANCE_NOW",
    pattern: /\bperformance\.now\s*\(/g,
    message: "Forbidden non-deterministic call performance.now(). Render timing must be driven purely by timeline seek f(t).",
  },
  {
    type: "REQUEST_ANIMATION_FRAME",
    pattern: /\b(?:window\.)?requestAnimationFrame\s*\(/g,
    message: "Forbidden animation loop requestAnimationFrame(). All animations must be registered on the GSAP timeline.",
  },
  {
    type: "NON_DETERMINISTIC_TIMER",
    pattern: /\b(?:window\.)?(?:setTimeout|setInterval)\s*\(/g,
    message: "Forbidden non-deterministic timer setTimeout/setInterval. Use GSAP timeline delays instead.",
  },
];

/**
 * Mask comments and string literals (single, double, and template strings) in JS code
 * with whitespace so string contents (e.g. console.log("setTimeout") or messages mentioning
 * "Math.random()") do not trigger false positives while preserving exact line numbers and column offsets.
 *
 * NOTE: This is a static lexical check (best-effort) designed to catch common non-deterministic APIs
 * directly invoked on the render path (e.g. Math.random(), Date.now(), setTimeout()). It does not execute
 * code or resolve dynamic indirection such as eval() or window['Math']['random']().
 */
export function maskCommentsAndStrings(code: string): string {
  const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|`(?:\\.|[\s\S])*?`|"(?:\\.|[^"\r\n\\])*"|'(?:\\.|[^'\r\n\\])*'/g;
  return code.replace(pattern, (m) => m.replace(/[^\r\n]/g, " "));
}

/**
 * Calculate line number, column number, and line snippet for a character index in code.
 */
function getPosition(
  code: string,
  index: number
): { line: number; column: number; snippet: string } {
  const preceding = code.slice(0, index);
  const lines = preceding.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  const allLines = code.split("\n");
  const snippet = allLines[line - 1]?.trim() || "";
  return { line, column, snippet };
}

/**
 * Lint arbitrary JavaScript code against the deterministic rendering contract.
 */
export function lintCompCode(
  code: string,
  context?: { source?: string; sceneId?: string; lineOffset?: number }
): LintResult {
  if (!code || typeof code !== "string") {
    return { valid: true, violations: [], errors: [] };
  }

  const masked = maskCommentsAndStrings(code);
  const violations: LintViolation[] = [];

  for (const rule of LINT_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(masked)) !== null) {
      const pos = getPosition(code, match.index);
      const line = pos.line + (context?.lineOffset || 0);

      violations.push({
        type: rule.type,
        message: rule.message,
        line,
        column: pos.column,
        snippet: pos.snippet,
        sceneId: context?.sceneId,
        source: context?.source,
      });
    }
  }

  const errors = violations.map((v) => {
    const loc = v.sceneId
      ? `scene "${v.sceneId}"`
      : v.source
      ? `source "${v.source}"`
      : "code";
    return `[${v.type}] in ${loc} at line ${v.line}, col ${v.column}: ${v.message} (snippet: "${v.snippet}")`;
  });

  return {
    valid: violations.length === 0,
    violations,
    errors,
  };
}

/**
 * Extract script tag contents from an HTML snippet.
 */
function extractScriptsFromHtml(html: string): { code: string; lineOffset: number }[] {
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  const results: { code: string; lineOffset: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const preceding = html.slice(0, match.index);
    const lineOffset = preceding.split("\n").length - 1;
    results.push({ code: match[1], lineOffset });
  }
  return results;
}

/**
 * Statically lint an entire videoScript structure (globalSetupJs, scene jsCode, scene htmlCode scripts).
 */
export function lintVideoScript(script: videoScript): LintResult {
  const allViolations: LintViolation[] = [];

  // 1. Lint globalSetupJs
  if (script.globalSetupJs) {
    const res = lintCompCode(script.globalSetupJs, { source: "globalSetupJs" });
    allViolations.push(...res.violations);
  }

  // 2. Lint each scene
  if (Array.isArray(script.scenes)) {
    for (const sc of script.scenes) {
      if (sc.jsCode) {
        const res = lintCompCode(sc.jsCode, {
          source: "scene.jsCode",
          sceneId: sc.id,
        });
        allViolations.push(...res.violations);
      }

      if (sc.htmlCode) {
        const embeddedScripts = extractScriptsFromHtml(sc.htmlCode);
        for (const emb of embeddedScripts) {
          const res = lintCompCode(emb.code, {
            source: "scene.htmlCode.<script>",
            sceneId: sc.id,
            lineOffset: emb.lineOffset,
          });
          allViolations.push(...res.violations);
        }
      }
    }
  }

  const errors = allViolations.map((v) => {
    const loc = v.sceneId ? `scene "${v.sceneId}"` : v.source || "global";
    return `[${v.type}] in ${loc} at line ${v.line}, col ${v.column}: ${v.message} (snippet: "${v.snippet}")`;
  });

  return {
    valid: allViolations.length === 0,
    violations: allViolations,
    errors,
  };
}

/**
 * Assert that a videoScript satisfies the deterministic rendering contract.
 * Throws DeterministicContractError if any non-deterministic patterns are found.
 */
export function assertDeterministicScript(script: videoScript): void {
  const result = lintVideoScript(script);
  if (!result.valid) {
    const summary = [
      `Deterministic rendering contract violated: Found ${result.violations.length} non-deterministic violation(s):`,
      ...result.errors.map((err) => `  - ${err}`),
    ].join("\n");
    throw new DeterministicContractError(summary, result.violations);
  }
}

/**
 * Assert that code or script satisfies the deterministic contract.
 */
export function assertDeterministicComp(
  codeOrScript: string | videoScript,
  context?: { sceneId?: string }
): void {
  if (typeof codeOrScript === "string") {
    const result = lintCompCode(codeOrScript, context);
    if (!result.valid) {
      const summary = [
        `Deterministic rendering contract violated: Found ${result.violations.length} violation(s):`,
        ...result.errors.map((err) => `  - ${err}`),
      ].join("\n");
      throw new DeterministicContractError(summary, result.violations);
    }
  } else {
    assertDeterministicScript(codeOrScript);
  }
}
