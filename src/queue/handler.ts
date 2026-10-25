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
import { videoRequestSchema, videoScriptSchema, type videoScript } from '../llm/schema.js';
import { isSafeJobId, safeJobDir } from './jobPaths.js';
import { resolveBgmPath } from '../security/uploadGuard.js';
import { resolve, sep } from 'node:path';

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

/**
 * Kiểm chứng lại dữ liệu job TẠI THỜI ĐIỂM DEQUEUE.
 *
 * Hàng đợi (Redis) không phải biên tin cậy: ai ghi được vào queue đều từng
 * có toàn quyền pipeline vì handler dùng nguyên văn request/script/
 * outputDir/bgmPath trong payload. Route tạo job đã validate + giam đường
 * dẫn, nhưng payload trong queue có thể bị chèn/sửa sau đó. Vì vậy handler
 * chuẩn hoá lại mọi trường trước khi chạy:
 * - jobId phải theo khuôn an toàn; outputDir suy lại từ jobId (chỉ chấp
 *   nhận thư mục trong tmp/ mà tên chứa jobId — khớp route `job-<id>` và
 *   CLI `cli-job-<id>`), ngoài ra rơi về safeJobDir.
 * - request/script parse lại bằng đúng zod schema của tầng route.
 * - bgmPath qua resolveBgmPath (giam trong tmp/|assets/).
 * Payload không hợp lệ → job fail với lỗi rõ ràng thay vì chạy bừa.
 */
export function revalidateJobData(data: JobData): JobData {
    if (!isSafeJobId(data?.jobId)) {
        throw new Error('JOB_REJECTED: jobId không hợp lệ trong payload hàng đợi');
    }
    const jobId = data.jobId;

    const request = videoRequestSchema.parse(data.request);
    const script = data.script ? videoScriptSchema.parse(data.script) : undefined;

    const fallbackDir = safeJobDir(jobId);
    let outputDir = fallbackDir ?? resolve(process.cwd(), 'tmp', `job-${jobId}`);
    if (typeof data.outputDir === 'string' && data.outputDir) {
        const root = resolve(process.cwd(), 'tmp');
        const candidate = resolve(data.outputDir);
        const base = candidate.split(sep).pop() ?? '';
        if (candidate.startsWith(root + sep) && base.includes(jobId)) {
            outputDir = candidate;
        }
    }

    const bgmPath = data.bgmPath ? (resolveBgmPath(data.bgmPath) ?? undefined) : undefined;
    const userId = typeof data.userId === 'string' && data.userId.length > 0 && data.userId.length <= 64
        ? data.userId
        : undefined;

    return { ...data, jobId, request, script, outputDir, bgmPath, userId };
}

export async function processVideoJob(data: JobData, updateProgress: (p: JobProgress) => Promise<void>): Promise<fullPipelineResult> {
    const clean = revalidateJobData(data);
    let script = clean.script;
    if (!script && clean.autoDirect) {
        script = await autoDirectScript(clean, updateProgress);
    }

    return await runFullPipeline({
        request: clean.request,
        script,
        bgmPath: clean.bgmPath,
        skipPreview: clean.skipPreview,
        outputDir: clean.outputDir,
        jobId: clean.jobId,
        seed: clean.seed,
        onProgress: (p) => {
            updateProgress(p).catch(err => console.error("Failed to update progress", err));
        }
    });
}
