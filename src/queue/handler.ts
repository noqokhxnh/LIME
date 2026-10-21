import { JobData, JobProgress } from './interfaces.js';
import { runFullPipeline, type fullPipelineResult } from '../pipeline/orchestrator.js';
import {
    DEFAULT_ANSWERS,
    buildAnswerDirectives,
    clarifyAnswersSchema,
    inferAnswers,
    mergeAnswers,
    type ClarifyAnswers,
} from '../pipeline/clarify.js';
import { dedupeVariants, pickVariants, scoreDraft } from '../pipeline/scriptVariants.js';
import { generateScript } from '../pipeline/scriptGenerator.js';
import { type videoScript } from '../llm/schema.js';

/**
 * Chế độ "Để AI quyết hết".
 *
 * Trả lời 3 câu làm rõ → sinh 3 phương án song song → chọn phương án khớp thời
 * lượng và ngân sách từ nhất. Không tốn thêm LLM call cho bước chọn: công thức
 * deterministic đủ tốt và còn giải thích được cho người dùng.
 */
export async function autoDirectScript(
    data: JobData,
    updateProgress: (p: JobProgress) => Promise<void>
): Promise<videoScript> {
    const request = data.request;

    let provided: ReturnType<typeof clarifyAnswersSchema.parse> = {};
    try {
        provided = clarifyAnswersSchema.parse(data.autoAnswers ?? {});
    } catch {
        provided = {};
    }

    const needsInference = !(provided.audience && provided.purpose && provided.structure);
    if (needsInference) {
        await updateProgress({
            phase: 'script_generation',
            progress: 2,
            message: 'AI đang đọc yêu cầu và chọn hướng kể…',
        });
    }
    const inference = needsInference ? await inferAnswers(request.prompt) : null;
    const answers: ClarifyAnswers = mergeAnswers(inference?.answers ?? DEFAULT_ANSWERS, provided);

    const directives = buildAnswerDirectives(answers);
    const variants = pickVariants(request.prompt, {
        purpose: answers.purpose,
        rotation: data.variantRotation ?? 0,
        count: 3,
    });

    await updateProgress({
        phase: 'script_generation',
        progress: 4,
        message: `AI đang viết ${variants.length} phương án: ${variants.map(v => v.label).join(' · ')}`,
    });

    const settled = await Promise.allSettled(
        variants.map(variant =>
            generateScript(
                request,
                (msg: string) => {
                    updateProgress({ phase: 'script_generation', progress: 6, message: msg }).catch(() => { });
                },
                undefined,
                variant,
                directives
            )
        )
    );

    const drafts = settled.flatMap((entry, index) => {
        if (entry.status !== 'fulfilled') return [];
        const variant = variants[index];
        const { score, reason } = scoreDraft(entry.value, request);
        return [{ variant, script: entry.value, score, reason }];
    });

    const unique = dedupeVariants(drafts).sort((a, b) => b.score - a.score);
    if (!unique.length) {
        const details = settled
            .filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
            .map(entry => entry.reason?.message ?? String(entry.reason))
            .slice(0, 2)
            .join(' | ');
        throw new Error(`Không tạo được phương án nào. ${details}`.trim());
    }

    const best = unique[0];
    await updateProgress({
        phase: 'script_generation',
        progress: 10,
        message: `AI chọn phương án "${best.variant.label}" — ${best.reason}`,
    });

    return best.script;
}

export async function processVideoJob(data: JobData, updateProgress: (p: JobProgress) => Promise<void>): Promise<fullPipelineResult> {
    let script = data.script;
    if (!script && data.autoDirect) {
        script = await autoDirectScript(data, updateProgress);
    }

    return await runFullPipeline({
        request: data.request,
        script,
        bgmPath: data.bgmPath,
        skipPreview: data.skipPreview,
        outputDir: data.outputDir,
        jobId: data.jobId,
        seed: data.seed,
        onProgress: (p) => {
            updateProgress(p).catch(err => console.error("Failed to update progress", err));
        }
    });
}
