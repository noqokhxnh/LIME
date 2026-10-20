import { z } from "zod";
import { getLLMClient } from "@/llm/client";
import { stripMarkdownJson } from "./scriptGenerator.js";

/**
 * Ba câu hỏi làm rõ trước khi sinh kịch bản.
 *
 * Nguyên tắc thiết kế: chỉ hỏi những chiều mà câu trả lời thực sự đổi kịch bản.
 * Ba chiều ở đây là người xem, mục đích và cấu trúc lập luận — phong cách hình
 * ảnh đã do bước chọn phương án quyết định, hỏi thêm sẽ mâu thuẫn.
 */
export const AUDIENCE_IDS = ['dev', 'biz', 'student', 'general'] as const;
export const PURPOSE_IDS = ['explain', 'persuade', 'story', 'viral'] as const;
export const STRUCTURE_IDS = ['single', 'lenses', 'contradiction', 'belief'] as const;
export const CTA_IDS = ['none', 'follow', 'buy', 'share'] as const;

export type AudienceId = typeof AUDIENCE_IDS[number];
export type PurposeId = typeof PURPOSE_IDS[number];
export type StructureId = typeof STRUCTURE_IDS[number];
export type CtaId = typeof CTA_IDS[number];
export type QuestionId = 'audience' | 'purpose' | 'structure';

export interface ClarifyOption {
    id: string;
    label: string;
    hint: string;
    /** Câu chỉ dẫn tiêm vào prompt khi option này được chọn. */
    directive: string;
}

export interface ClarifyQuestion {
    id: QuestionId;
    label: string;
    options: ClarifyOption[];
}

export const CLARIFY_QUESTIONS: ClarifyQuestion[] = [
    {
        id: 'audience',
        label: 'Người xem là ai?',
        options: [
            {
                id: 'dev',
                label: 'Dev / kỹ thuật',
                hint: 'Được dùng thuật ngữ, ví dụ code, terminal, API.',
                directive: 'Người xem là dev/kỹ thuật: được dùng thuật ngữ chính xác, ví dụ code, terminal, tên công cụ.',
            },
            {
                id: 'biz',
                label: 'Dân văn phòng / quản lý',
                hint: 'Nói bằng kết quả: thời gian, chi phí, ROI.',
                directive: 'Người xem là dân văn phòng/quản lý: nói bằng kết quả đo được (thời gian, chi phí, ROI), tránh thuật ngữ kỹ thuật.',
            },
            {
                id: 'student',
                label: 'Học sinh / sinh viên',
                hint: 'Ví dụ đời thường, giọng gần gũi.',
                directive: 'Người xem là học sinh/sinh viên: dùng ví dụ đời thường, giọng gần gũi, không giả định kiến thức chuyên môn.',
            },
            {
                id: 'general',
                label: 'Công chúng phổ thông',
                hint: 'Ẩn dụ trực quan, mỗi cảnh một ý, không thuật ngữ.',
                directive: 'Người xem là công chúng phổ thông: ẩn dụ trực quan, mỗi cảnh một ý, tuyệt đối không dùng thuật ngữ chuyên ngành.',
            },
        ],
    },
    {
        id: 'purpose',
        label: 'Mục đích chính?',
        options: [
            {
                id: 'explain',
                label: 'Giải thích một khái niệm',
                hint: 'Trình bày trung tính, dễ hiểu.',
                directive: 'Mục đích: giải thích một khái niệm. Giữ giọng trung tính, ưu tiên sự rõ ràng hơn thuyết phục.',
            },
            {
                id: 'persuade',
                label: 'Thuyết phục',
                hint: 'Mỗi cảnh phải đẩy tới một kết luận.',
                directive: 'Mục đích: thuyết phục. Mỗi cảnh phải tiến một bước tới kết luận cuối; nêu bằng chứng trước khi kết luận.',
            },
            {
                id: 'story',
                label: 'Kể chuyện / gây cảm xúc',
                hint: 'Nhân vật, tình huống, cảm xúc.',
                directive: 'Mục đích: kể chuyện. Có nhân vật và diễn biến cảm xúc; hạn chế số liệu và lập luận khô.',
            },
            {
                id: 'viral',
                label: 'Gây tò mò / viral',
                hint: 'Hook mạnh, twist ở cuối.',
                directive: 'Mục đích: gây tò mò. Mở bằng một mệnh đề gây bất ngờ trong 2 giây đầu, giữ một câu hỏi mở tới cảnh cuối.',
            },
        ],
    },
    {
        id: 'structure',
        label: 'Cấu trúc lập luận?',
        options: [
            {
                id: 'single',
                label: 'Một lập luận sâu',
                hint: '3 cảnh, đào thật kỹ một ý.',
                directive: 'Cấu trúc: một lập luận duy nhất, đào sâu qua 3 cảnh. Không phân tán sang ý phụ.',
            },
            {
                id: 'lenses',
                label: 'Nhiều lăng kính song song',
                hint: '4–5 cảnh, mỗi cảnh một ngành/góc nhìn.',
                directive: 'Cấu trúc: nhiều lăng kính song song (4–5 cảnh), mỗi cảnh một ngành hoặc góc nhìn khác nhau, cảnh cuối tổng hợp.',
            },
            {
                id: 'contradiction',
                label: 'Chuỗi phản chứng',
                hint: 'Giả sử → hệ quả → mâu thuẫn → kết luận.',
                directive: 'Cấu trúc: chuỗi phản chứng. Giả sử điều ngược lại, suy ra hệ quả, chỉ ra mâu thuẫn, rồi kết luận.',
            },
            {
                id: 'belief',
                label: 'Đối chiếu niềm tin và đo lường',
                hint: 'Kể văn hoá, kết bằng tiêu chí khoa học.',
                directive: 'Cấu trúc: đối chiếu niềm tin phổ biến với dữ liệu đo lường được; kết bằng tiêu chí đánh giá rõ ràng.',
            },
        ],
    },
];

export interface ClarifyAnswers {
    audience: AudienceId;
    purpose: PurposeId;
    structure: StructureId;
    cta: CtaId;
}

export const clarifyAnswersSchema = z.object({
    audience: z.enum(AUDIENCE_IDS).optional(),
    purpose: z.enum(PURPOSE_IDS).optional(),
    structure: z.enum(STRUCTURE_IDS).optional(),
    cta: z.enum(CTA_IDS).optional(),
}).partial();

export type PartialClarifyAnswers = z.infer<typeof clarifyAnswersSchema>;

export type ClarifyConfidence = Record<QuestionId, number>;

export interface ClarifyResult {
    answers: ClarifyAnswers;
    confidence: ClarifyConfidence;
    /** 'llm' khi phân loại bằng model, 'heuristic' khi fallback. */
    source: 'llm' | 'heuristic';
    error?: string;
}

export const DEFAULT_ANSWERS: ClarifyAnswers = {
    audience: 'general',
    purpose: 'explain',
    structure: 'single',
    cta: 'none',
};

/** Câu nào đủ chắc thì UI thu gọn, không bắt người dùng bấm. */
export const CONFIDENCE_COLLAPSE_THRESHOLD = 0.8;

function clampConfidence(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
}

function pickId<T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] {
    return (allowed as readonly string[]).includes(String(value)) ? (String(value) as T[number]) : fallback;
}

/**
 * Suy đoán câu trả lời bằng keyword — chỉ dùng khi LLM lỗi.
 *
 * Cố ý trả confidence thấp để UI vẫn hiện câu hỏi: thà hỏi thừa còn hơn âm thầm
 * chọn sai hướng cho người dùng.
 */
export function heuristicAnswers(prompt: string): ClarifyResult {
    const p = prompt.toLowerCase();

    let purpose: PurposeId = 'explain';
    let purposeConfidence = 0.35;
    if (/chứng minh|thuyết phục|bán|giá|ưu đãi|dùng thử|mua|đăng ký/.test(p)) {
        purpose = 'persuade';
        purposeConfidence = 0.65;
    } else if (/kể chuyện|câu chuyện|cảm xúc|kỷ niệm|nhân vật/.test(p)) {
        purpose = 'story';
        purposeConfidence = 0.6;
    } else if (/viral|bí mật|sai lầm|gây sốc|tò mò/.test(p)) {
        purpose = 'viral';
        purposeConfidence = 0.6;
    }

    let audience: AudienceId = 'general';
    let audienceConfidence = 0.35;
    if (/\bcode\b|api|lập trình|dev|thuật toán|terminal/.test(p)) {
        audience = 'dev';
        audienceConfidence = 0.6;
    } else if (/doanh nghiệp|quản lý|chi phí|roi|nhân viên|văn phòng/.test(p)) {
        audience = 'biz';
        audienceConfidence = 0.6;
    } else if (/học sinh|sinh viên|trường|bài giảng|sinh viên/.test(p)) {
        audience = 'student';
        audienceConfidence = 0.6;
    }

    let structure: StructureId = 'single';
    let structureConfidence = 0.35;
    if (/vật lý|hoá học|hóa học|sinh học|góc độ|lăng kính|nhiều khía cạnh|so sánh/.test(p)) {
        structure = 'lenses';
        structureConfidence = 0.6;
    } else if (/chứng minh|phản chứng|giả sử|nếu .* thì|mâu thuẫn/.test(p)) {
        structure = 'contradiction';
        structureConfidence = 0.6;
    } else if (/lịch sử|niềm tin|văn hoá|văn hóa|truyền thống|tín ngưỡng/.test(p)) {
        structure = 'belief';
        structureConfidence = 0.55;
    }

    return {
        answers: { audience, purpose, structure, cta: 'none' },
        confidence: {
            audience: audienceConfidence,
            purpose: purposeConfidence,
            structure: structureConfidence,
        },
        source: 'heuristic',
    };
}

const CLASSIFY_SYSTEM_PROMPT = `Bạn là bộ phân loại yêu cầu làm video. Bạn KHÔNG viết kịch bản.
Chỉ trả về một object JSON hợp lệ, không markdown, không giải thích.`;

function buildClassifyPrompt(prompt: string): string {
    return `Yêu cầu video của người dùng:
"""
${prompt}
"""

Chọn đúng một đáp án cho mỗi chiều, chỉ dùng các id sau:
- audience: dev | biz | student | general
- purpose: explain | persuade | story | viral
- structure: single | lenses | contradiction | belief

Quy tắc confidence (0..1):
- 0.85–1.0: prompt nói rõ ràng.
- 0.5–0.8: suy ra được từ ngữ cảnh.
- 0.0–0.4: prompt không cung cấp thông tin.

Trả về đúng định dạng:
{"audience":{"value":"general","confidence":0.3},"purpose":{"value":"explain","confidence":0.5},"structure":{"value":"single","confidence":0.2}}`;
}

/**
 * Gọi LLM phân loại prompt thành ba câu trả lời kèm confidence.
 *
 * Luôn có fallback heuristic: bước này chỉ để gợi ý và thu gọn form, không được
 * phép chặn luồng tạo kịch bản.
 */
export async function inferAnswers(prompt: string, signal?: AbortSignal): Promise<ClarifyResult> {
    const fallback = heuristicAnswers(prompt);
    try {
        const llm = getLLMClient();
        // Lớp phân loại chỉ output JSON ngắn — caller không truyền signal thì tự
        // đặt timeout 3 phút để không treo vĩnh viễn khi upstream chậm (lỗi về fallback).
        const effectiveSignal = signal ?? AbortSignal.timeout(180_000);
        const raw = await llm.generate(CLASSIFY_SYSTEM_PROMPT, buildClassifyPrompt(prompt), effectiveSignal);
        const parsed = JSON.parse(stripMarkdownJson(raw)) as any;

        const answers: ClarifyAnswers = {
            audience: pickId(AUDIENCE_IDS, parsed?.audience?.value, fallback.answers.audience),
            purpose: pickId(PURPOSE_IDS, parsed?.purpose?.value, fallback.answers.purpose),
            structure: pickId(STRUCTURE_IDS, parsed?.structure?.value, fallback.answers.structure),
            cta: 'none',
        };

        return {
            answers,
            confidence: {
                audience: clampConfidence(parsed?.audience?.confidence, fallback.confidence.audience),
                purpose: clampConfidence(parsed?.purpose?.confidence, fallback.confidence.purpose),
                structure: clampConfidence(parsed?.structure?.confidence, fallback.confidence.structure),
            },
            source: 'llm',
        };
    } catch (error: any) {
        return { ...fallback, error: error?.message ?? String(error) };
    }
}

/** Hợp nhất câu trả lời người dùng đã chọn với gợi ý của AI. */
export function mergeAnswers(base: ClarifyAnswers, override?: PartialClarifyAnswers): ClarifyAnswers {
    return {
        audience: override?.audience ?? base.audience,
        purpose: override?.purpose ?? base.purpose,
        structure: override?.structure ?? base.structure,
        cta: override?.cta ?? base.cta,
    };
}

const OPTION_INDEX = new Map<string, ClarifyOption>(
    CLARIFY_QUESTIONS.flatMap(q => q.options.map(o => [`${q.id}:${o.id}`, o] as [string, ClarifyOption]))
);

function directiveFor(question: QuestionId, id: string): string | undefined {
    return OPTION_INDEX.get(`${question}:${id}`)?.directive;
}

/**
 * Sinh khối chỉ dẫn tiêm vào prompt, áp dụng cho CẢ BA phương án.
 *
 * Đây là phần "ràng buộc nội dung": người xem, mục đích và cấu trúc lập luận
 * phải giống nhau ở mọi phương án — chỉ cách trình bày là khác.
 */
export function buildAnswerDirectives(answers: ClarifyAnswers): string {
    const lines = [
        directiveFor('audience', answers.audience),
        directiveFor('purpose', answers.purpose),
        directiveFor('structure', answers.structure),
    ].filter((line): line is string => Boolean(line));

    if (answers.cta !== 'none') {
        const ctaText: Record<CtaId, string> = {
            none: '',
            follow: 'Cảnh cuối kêu gọi theo dõi/đăng ký kênh, ngắn và không phô trương.',
            buy: 'Cảnh cuối có lời kêu gọi mua/dùng thử, kèm lợi ích cụ thể. Không bịa giá nếu prompt không nêu.',
            share: 'Cảnh cuối khuyến khích chia sẻ, bằng một câu chốt gây tranh luận nhẹ.',
        };
        const cta = ctaText[answers.cta];
        if (cta) lines.push(cta);
    }

    if (!lines.length) return '';
    return `--- NGƯỜI XEM, MỤC ĐÍCH & CẤU TRÚC (BẮT BUỘC, ÁP DỤNG CHO MỌI CẢNH) ---
${lines.map(line => `- ${line}`).join('\n')}`;
}

/** Danh sách câu hỏi kèm trạng thái để UI quyết định ẩn/hiện. */
export interface ClarifyQuestionView extends ClarifyQuestion {
    selected: string;
    confidence: number;
    /** false = đủ chắc, UI thu gọn thành một dòng. */
    visible: boolean;
}

export function buildQuestionViews(result: ClarifyResult): ClarifyQuestionView[] {
    return CLARIFY_QUESTIONS.map(question => {
        const confidence = result.confidence[question.id] ?? 0;
        return {
            ...question,
            selected: result.answers[question.id],
            confidence,
            visible: confidence < CONFIDENCE_COLLAPSE_THRESHOLD,
        };
    });
}
