import { type scene } from '../../llm/schema.js';
import type {
    SceneMotionSample,
    MotionSampler,
    MotionCoverageScene,
    MotionCoverageLegResult,
} from './types.js';

export function computeMotionCoverage(samples: SceneMotionSample[]): {
    coverage: number;
    movingIntervals: number;
    totalIntervals: number;
} {
    if (samples.length < 2) {
        return { coverage: 0, movingIntervals: 0, totalIntervals: 0 };
    }

    let moving = 0;
    for (let i = 1; i < samples.length; i += 1) {
        const prev = samples[i - 1].elements;
        const next = samples[i].elements;
        let changed = prev.length !== next.length;
        if (!changed) {
            for (let k = 0; k < prev.length; k += 1) {
                if (
                    prev[k].transform !== next[k].transform ||
                    prev[k].opacity !== next[k].opacity
                ) {
                    changed = true;
                    break;
                }
            }
        }
        if (changed) moving += 1;
    }

    const total = samples.length - 1;
    return {
        coverage: total > 0 ? moving / total : 0,
        movingIntervals: moving,
        totalIntervals: total,
    };
}

export async function checkMotionCoverageLeg(
    scenes: scene[],
    durations: Record<string, number>,
    sampler: MotionSampler,
    intervalSec = 0.5
): Promise<MotionCoverageLegResult> {
    const results: MotionCoverageScene[] = [];
    const step = intervalSec > 0 ? intervalSec : 0.5;
    let sceneStart = 0;

    for (const current of scenes) {
        const duration = durations[current.id] ?? current.duration ?? 0;
        if (!Number.isFinite(duration) || duration <= 0) {
            results.push({
                sceneId: current.id,
                coverage: 0,
                movingIntervals: 0,
                totalIntervals: 0,
                reason: 'không có duration',
            });
            continue;
        }

        const steps = Math.max(1, Math.ceil(duration / step));
        const samples: SceneMotionSample[] = [];
        let failure: string | undefined;
        for (let i = 0; i <= steps; i += 1) {
            const t = sceneStart + Math.min(duration, i * step);
            try {
                const sample = await sampler(t, current.id);
                if (!sample) {
                    failure = 'không tìm thấy scene trong DOM';
                    break;
                }
                samples.push(sample);
            } catch (err: any) {
                failure = err?.message || String(err);
                break;
            }
        }

        if (failure) {
            results.push({
                sceneId: current.id,
                coverage: 0,
                movingIntervals: 0,
                totalIntervals: 0,
                reason: failure,
            });
        } else {
            const stats = computeMotionCoverage(samples);
            results.push({
                sceneId: current.id,
                coverage: Math.round(stats.coverage * 1000) / 1000,
                movingIntervals: stats.movingIntervals,
                totalIntervals: stats.totalIntervals,
            });
        }
        sceneStart += duration;
    }

    return {
        status: 'pass',
        strict: false,
        intervalSec: step,
        scenes: results,
    };
}
