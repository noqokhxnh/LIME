import { existsSync, readFileSync } from 'node:fs';
import { type Tempo } from '../llm/tempo.js';
import {
    type QAReport,
    type OracleQaOptions,
    type ContinuityLegResult,
    type CurvesLegResult,
    type FramingLegResult,
    type CaptionLegResult,
    type CompositionLegResult,
    type MotionCoverageLegResult,
} from './oracleQa/types.js';
import { checkRhythmLeg } from './oracleQa/rhythmLeg.js';
import { checkContinuityLeg } from './oracleQa/continuityLeg.js';
import { checkCurvesLeg } from './oracleQa/curvesLeg.js';
import { checkFramingLeg } from './oracleQa/framingLeg.js';
import { checkCaptionBandLeg } from './oracleQa/captionBandLeg.js';
import { checkCompositionLeg } from './oracleQa/compositionLeg.js';
import { checkAudioLeg } from './oracleQa/audioLeg.js';
import { checkGsapLintLeg } from './oracleQa/gsapLintLeg.js';
import { createBrowserDOMSampler } from './oracleQa/browserSampler.js';
import { checkMotionCoverageLeg } from './oracleQa/motionCoverageLeg.js';

// Re-export all types and sub-functions for 100% backward compatibility
export * from './oracleQa/types.js';
export * from './oracleQa/rhythmLeg.js';
export * from './oracleQa/continuityLeg.js';
export * from './oracleQa/curvesLeg.js';
export * from './oracleQa/framingLeg.js';
export * from './oracleQa/captionBandLeg.js';
export * from './oracleQa/compositionLeg.js';
export * from './oracleQa/audioLeg.js';
export * from './oracleQa/gsapLintLeg.js';
export * from './oracleQa/browserSampler.js';
export * from './oracleQa/motionCoverageLeg.js';

/**
 * Hàm điều phối chính Oracle QA (Phase 4.5)
 */
export async function runOracleQa(options: OracleQaOptions): Promise<QAReport> {
    const {
        script,
        htmlPath,
        audioResult,
        audioPath: explicitAudioPath,
        width,
        height,
        fps,
        jobId = 'default-job',
        attempt = 1,
    } = options;

    const scenes = script.scenes || [];
    const boundaries = script.boundaries || [];
    const durations = audioResult?.scencesDuration || {};

    // 1. Leg 1: Rhythm — ngưỡng theo tempo của video (#117)
    const tempo: Tempo = options.tempo ?? script.tempo ?? 'auto';
    const rhythmLeg = checkRhythmLeg(scenes, durations, {
        tempo,
        targetDurationSec: options.targetDurationSec,
    });

    // Chuẩn bị DOM sampler
    let domSampler = options.domSampler;
    let batchDomSampler = options.batchDomSampler;
    let captionSampler = options.captionSampler;
    let contentSampler = options.contentSampler;
    let motionSampler = options.motionSampler;
    let cleanupBrowser: (() => Promise<void>) | null = null;
    let hasShutterBlur = options.hasShutterBlur ?? false;

    if (!domSampler && !batchDomSampler) {
        if (existsSync(htmlPath)) {
            try {
                const browserSetup = await createBrowserDOMSampler(
                    htmlPath,
                    width,
                    height,
                    options.page
                );
                domSampler = browserSetup.domSampler;
                batchDomSampler = browserSetup.batchDomSampler;
                captionSampler = captionSampler ?? browserSetup.captionSampler;
                contentSampler = contentSampler ?? browserSetup.contentSampler;
                motionSampler = motionSampler ?? browserSetup.motionSampler;
                cleanupBrowser = browserSetup.cleanup;
                if (options.hasShutterBlur === undefined) {
                    hasShutterBlur = browserSetup.hasShutterBlur;
                }
            } catch (err: any) {
                console.warn(`[Oracle QA] Không thể khởi động browser để lấy mẫu DOM (${err?.message || err}).`);
                domSampler = async () => null;
            }
        } else {
            domSampler = async () => null;
        }
    } else {
        if (options.hasShutterBlur === undefined) {
            if (options.page) {
                const markerBlur = await options.page.evaluate(() => !!(window as any).__hasShutterBlur).catch(() => false);
                hasShutterBlur = markerBlur;
            }
            if (!hasShutterBlur && existsSync(htmlPath)) {
                const htmlContent = readFileSync(htmlPath, 'utf-8');
                hasShutterBlur = /shutter[-_]?blur|motion[-_]?blur|feGaussianBlur|filter:\s*blur/i.test(htmlContent);
            }
        }
        if (!domSampler && batchDomSampler) {
            domSampler = async (t, s) => {
                const res = await batchDomSampler!(t, [s]);
                return res[s] ?? null;
            };
        }
    }

    let continuityLeg: ContinuityLegResult;
    let curvesLeg: CurvesLegResult;
    let framingLeg: FramingLegResult;
    let captionLeg: CaptionLegResult;
    let compositionLeg: CompositionLegResult;
    let motionLeg: MotionCoverageLegResult;

    try {
        // 2. Leg 2: Continuity
        continuityLeg = await checkContinuityLeg(
            boundaries,
            scenes,
            durations,
            domSampler!,
            width,
            height
        );

        // 3. Leg 3: Curves
        curvesLeg = await checkCurvesLeg(
            scenes,
            durations,
            boundaries,
            domSampler!,
            fps,
            hasShutterBlur,
            batchDomSampler
        );

        // 4. Leg 4: Framing
        framingLeg = await checkFramingLeg(
            scenes,
            durations,
            domSampler!,
            width,
            height,
            batchDomSampler
        );

        // 4b. Leg 4b: Caption band — đo bbox thật sau layout (#110)
        if (captionSampler) {
            try {
                captionLeg = await checkCaptionBandLeg(scenes, durations, captionSampler);
            } catch (captionErr: any) {
                captionLeg = {
                    status: 'warn',
                    reason: `Không đo được dải caption: ${captionErr?.message || captionErr}`,
                };
            }
        } else {
            captionLeg = { status: 'pass', sampledFrames: 0 };
        }

        // 4c. Leg 4c: Composition — đo bố cục từ bbox thật (#111)
        const layoutSampler = contentSampler ?? captionSampler;
        if (layoutSampler) {
            try {
                compositionLeg = await checkCompositionLeg(
                    scenes,
                    durations,
                    layoutSampler,
                    width,
                    height,
                    {
                        strict:
                            options.compositionStrict ??
                            process.env.LIME_COMPOSITION_STRICT === '1',
                    }
                );
            } catch (compErr: any) {
                compositionLeg = {
                    status: 'warn',
                    strict: false,
                    thresholds: {
                        minOverlapRatio: 0.25,
                        bottomHeavyRatio: 0.6,
                        minElements: 3,
                        minContentCoverage: 0.02,
                    },
                    scenes: [],
                    violations: [],
                    reason: `Không đo được bố cục: ${compErr?.message || compErr}`,
                };
            }
        } else {
            compositionLeg = {
                status: 'pass',
                strict: false,
                thresholds: {
                    minOverlapRatio: 0.25,
                    bottomHeavyRatio: 0.6,
                    minElements: 3,
                    minContentCoverage: 0.02,
                },
                scenes: [],
                violations: [],
            };
        }

        // 4d. Leg 4d: Motion coverage (#125) — report-only, không fail job.
        if (motionSampler) {
            try {
                motionLeg = await checkMotionCoverageLeg(scenes, durations, motionSampler);
            } catch (motionErr: any) {
                motionLeg = {
                    status: 'pass',
                    strict: false,
                    intervalSec: 0.5,
                    scenes: [],
                    reason: `Không đo được motion coverage: ${motionErr?.message || motionErr}`,
                };
            }
        } else {
            motionLeg = {
                status: 'pass',
                strict: false,
                intervalSec: 0.5,
                scenes: [],
                reason: 'không có motion sampler',
            };
        }
    } finally {
        if (cleanupBrowser) {
            await cleanupBrowser();
        }
    }

    // 5. Leg 5: Audio
    const targetAudioPath = explicitAudioPath || audioResult?.mixAudioPath;
    const totalDurationSec =
        audioResult?.totalDurationSec ??
        scenes.reduce((sum, s) => sum + (durations[s.id] ?? s.duration ?? 0), 0);
    const audioLeg = await checkAudioLeg(
        targetAudioPath,
        totalDurationSec,
        options.audioAnalyzer
    );

    // 6. Leg 6: Lint code GSAP (#41) — warn-only trừ khi bật strict
    const codeLeg = checkGsapLintLeg(script, {
        strict: options.gsapLintStrict ?? process.env.LIME_GSAP_LINT_STRICT === '1',
        durations,
    });

    // Tổng hợp kết quả từ các legs
    const legs = {
        rhythm: rhythmLeg,
        continuity: continuityLeg,
        curves: curvesLeg,
        framing: framingLeg,
        caption: captionLeg,
        composition: compositionLeg,
        audio: audioLeg,
        code: codeLeg,
        motion: motionLeg,
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [legName, legResult] of Object.entries(legs)) {
        if (legResult.status === 'fail') {
            const reason =
                'reason' in legResult && legResult.reason
                    ? legResult.reason
                    : `Kiểm tra ${legName} thất bại`;
            errors.push(`[${legName.toUpperCase()}] ${reason}`);
        } else if (legResult.status === 'warn') {
            const reason =
                'reason' in legResult && legResult.reason
                    ? legResult.reason
                    : `Lưu ý kiểm tra ${legName}`;
            warnings.push(`[${legName.toUpperCase()}] ${reason}`);
        }
    }

    let qaStatus: 'pass' | 'warn' | 'fail' = 'pass';
    let valid = true;

    if (errors.length > 0) {
        qaStatus = 'fail';
        valid = false;
    } else if (warnings.length > 0) {
        qaStatus = 'warn';
        valid = true;
    }

    return {
        jobId,
        qaStatus,
        attempt,
        valid,
        carryScore: continuityLeg.carryScore,
        warnings,
        errors,
        legs,
        createdAt: new Date().toISOString(),
    };
}
