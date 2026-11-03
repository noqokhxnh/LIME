import { type videoScript } from '../../llm/schema.js';
import { lintGsapCode, lintSceneMotion, type MotionLintUnit } from '../gsapLinter.js';
import type { CodeLintViolation, CodeLintLegResult } from './types.js';

export function extractInlineScripts(htmlCode: string): Array<{ code: string; startLine: number }> {
    const blocks: Array<{ code: string; startLine: number }> = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(htmlCode)) !== null) {
        const attrs = match[1] || '';
        const body = match[2] || '';
        if (/\bsrc\s*=/i.test(attrs)) continue;
        const typeMatch = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
        const type = typeMatch?.[1]?.toLowerCase();
        if (type && !/^(text\/javascript|application\/javascript|module|text\/ecmascript)$/.test(type)) {
            continue;
        }
        if (!body.trim()) continue;
        const startLine = htmlCode.slice(0, match.index).split('\n').length;
        blocks.push({ code: body, startLine });
    }
    return blocks;
}

export function checkGsapLintLeg(
    script: videoScript,
    options?: { strict?: boolean; durations?: Record<string, number> }
): CodeLintLegResult {
    const strict = options?.strict === true;
    const violations: CodeLintViolation[] = [];
    let lintedUnits = 0;

    const lintUnit = (code: string, sceneId?: string) => {
        if (!code || !code.trim()) return;
        lintedUnits += 1;
        const result = lintGsapCode(code, sceneId);
        for (const v of result.violations) {
            violations.push({
                sceneId,
                rule: v.type,
                line: v.line,
                column: v.column,
                message: v.message,
            });
        }
    };

    lintUnit(script.globalSetupJs, undefined);
    for (const scene of script.scenes || []) {
        lintUnit(scene.jsCode, scene.id);
        const motionUnits: MotionLintUnit[] = [];
        if (scene.jsCode && scene.jsCode.trim()) {
            motionUnits.push({ code: scene.jsCode });
        }
        for (const block of extractInlineScripts(scene.htmlCode || '')) {
            lintedUnits += 1;
            motionUnits.push({ code: block.code, lineOffset: block.startLine - 1 });
            const result = lintGsapCode(block.code, scene.id);
            for (const v of result.violations) {
                violations.push({
                    sceneId: scene.id,
                    rule: v.type,
                    line: (v.line || 0) + block.startLine - 1,
                    column: v.column,
                    message: v.message,
                });
            }
        }

        const motionViolations = lintSceneMotion({
            sceneId: scene.id,
            duration: options?.durations?.[scene.id] ?? scene.duration,
            nearStill: scene.nearStill,
            cameraMove: scene.camera?.move,
            units: motionUnits,
        });
        for (const v of motionViolations) {
            violations.push({
                sceneId: scene.id,
                rule: v.type,
                line: v.line,
                column: v.column,
                message: v.message,
            });
        }
    }

    if (violations.length === 0) {
        return { status: 'pass', strict, lintedUnits, violations: [] };
    }

    const preview = violations
        .slice(0, 3)
        .map((v) => `${v.sceneId ?? 'global'}: ${v.rule} (dòng ${v.line})`)
        .join('; ');
    const suffix = violations.length > 3 ? `; +${violations.length - 3} vi phạm khác` : '';
    const summary = `${violations.length} vi phạm GSAP — ${preview}${suffix}`;

    return {
        status: strict ? 'fail' : 'warn',
        strict,
        lintedUnits,
        violations,
        reason: strict
            ? summary
            : `${summary} (warn-only; bật gsapLintStrict để chặn render)`,
    };
}
