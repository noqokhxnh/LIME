import { videoRequest, videoScript } from "@/llm/schema";
import { estimateDuration } from "./estimateDuration.js";
import { narrationWordFloor, narrationWordTarget } from "./scriptGenerator.js";

/**
 * Ba "phương án" mà người dùng chọn trước khi render.
 *
 * Mỗi archetype là một cách kể khác nhau thật sự — không chỉ đổi màu. Việc gán
 * cứng style + blueprint ở đây (thay vì để LLM tự chọn) là có chủ ý: nếu để LLM
 * chọn, cả ba phương án thường hội tụ về cùng một phong cách, làm mất ý nghĩa
 * của bước duyệt.
 */
export type ArchetypeKey = 'editorial' | 'data' | 'comic' | 'swiss';

export type VariantStyle = 'modern' | 'classic' | 'stickman' | 'minimal';

export interface ScriptVariantSpec {
    key: ArchetypeKey;
    /** Nhãn ngắn hiển thị trên rail chọn phương án. */
    label: string;
    /** Một dòng mô tả góc kể, hiển thị dưới nhãn. */
    hook: string;
    style: VariantStyle;
    blueprintId: string;
    /** Khối chỉ dẫn tiêm vào prompt, quyết định sự khác biệt giữa các phương án. */
    brief: string;
}

export const ARCHETYPES: Record<ArchetypeKey, ScriptVariantSpec> = {
    editorial: {
        key: 'editorial',
        label: 'Biên tập',
        hook: 'Kể như phóng sự — chi tiết cụ thể, nhịp chậm, giàu hình ảnh.',
        style: 'classic',
        blueprintId: 'documentary-editorial',
        brief: `--- VARIANT BRIEF: BIÊN TẬP / TÀI LIỆU ---
Bạn đang viết cho phong cách tạp chí - phóng sự tài liệu.
- Mở bằng một chi tiết cụ thể (một người, một thời điểm, một địa điểm). KHÔNG mở bằng định nghĩa hay "Trong video này...".
- Nhịp chậm: dùng nearStill cho cảnh đầu và cảnh cuối; chuyển cảnh fade.
- Chữ trên màn hình: 1 tiêu đề serif ≤ 5 từ + 1 trích dẫn ngắn hoặc mốc thời gian.
- CẤM: bảng số liệu, icon neon, hiệu ứng nảy, giọng hô hào.
- Giọng kể: điềm tĩnh, cụ thể, để chi tiết tự nói.`,
    },
    data: {
        key: 'data',
        label: 'Dữ liệu',
        hook: 'Mổ xẻ bằng con số — mỗi cảnh một mỏ neo số liệu.',
        style: 'modern',
        blueprintId: 'data-story',
        brief: `--- VARIANT BRIEF: DỮ LIỆU / ĐỒ THỊ ---
Bạn đang viết cho phong cách data-story.
- MỖI cảnh phải có đúng một mỏ neo số liệu (con số, %, tỉ lệ, mốc thời gian, so sánh định lượng).
- Nếu prompt không cung cấp số, tự suy ra một con số minh hoạ hợp lý và mô tả rõ trong visualDescription.
- Motion: ưu tiên counter-hero, bar-chart, line-graph; chuyển cảnh hardCut phải có reason.
- CẤM: ảnh minh hoạ cảm xúc, câu văn dài dòng, ẩn dụ trừu tượng.
- Giọng: dứt khoát, mỗi câu một ý, không tính từ thừa.`,
    },
    comic: {
        key: 'comic',
        label: 'Truyện tranh',
        hook: 'Một nhân vật người que, một hiểu lầm, một cú twist.',
        style: 'stickman',
        blueprintId: 'comic-explainer',
        brief: `--- VARIANT BRIEF: TRUYỆN TRANH / NGƯỜI QUE ---
Bạn đang viết cho phong cách comic explainer với nhân vật stickman.
- Tạo MỘT nhân vật xuyên suốt, đặt tên và cho nhân vật một mong muốn cụ thể.
- Cấu trúc: tình huống → hiểu lầm → cú twist → bài học.
- Thoại ngắn, ≤ 12 từ mỗi câu; ưu tiên speech-bubble-punch và comic-impact.
- Easing được phép nảy (back.out), tương phản mạnh.
- CẤM: giọng học thuật, số liệu dày đặc, hình nền gradient phức tạp.`,
    },
    swiss: {
        key: 'swiss',
        label: 'Tối giản',
        hook: 'Một luận điểm, ba cách nói, không gì thừa.',
        style: 'minimal',
        blueprintId: 'swiss-minimal-brief',
        brief: `--- VARIANT BRIEF: TỐI GIẢN THỤY SĨ ---
Bạn đang viết cho phong cách Swiss minimal.
- Chỉ MỘT luận điểm duy nhất, được lặp lại bằng ba cách khác nhau.
- Mỗi cảnh: 1 từ khoá in hoa + 1 dòng phụ ≤ 8 từ. Không đoạn văn trên màn hình.
- Nền trắng hoặc đen, một màu nhấn duy nhất, đường kẻ mảnh thay cho card bo góc.
- Motion: mask-reveal, chapter-index; tối đa 2 phần tử động mỗi cảnh.
- CẤM: gradient, đổ bóng, nhiều icon màu, hiệu ứng trang trí.`,
    },
};

/**
 * Thứ tự ưu tiên archetype theo mục đích người dùng chọn.
 *
 * Mục đích không chỉ tiêm text vào prompt — nó còn quyết định phương án nào
 * xuất hiện trước. Nhờ vậy cùng một prompt, chọn "kể chuyện" và "viral" cho ra
 * hai bộ phương án khác nhau, chứ không chỉ khác vài chữ.
 */
const PURPOSE_PRIORITY: Record<string, ArchetypeKey[]> = {
    explain: ['data', 'swiss', 'editorial', 'comic'],
    persuade: ['data', 'editorial', 'swiss', 'comic'],
    story: ['editorial', 'comic', 'data', 'swiss'],
    viral: ['comic', 'data', 'editorial', 'swiss'],
};

const DEFAULT_PRIORITY: ArchetypeKey[] = ['editorial', 'data', 'comic', 'swiss'];

/** FNV-1a 32-bit, đồng bộ với rng.ts để cùng prompt luôn ra cùng bộ phương án. */
function hashString(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export interface PickVariantsOptions {
    /** Mục đích người dùng chọn (explain | persuade | story | viral). */
    purpose?: string;
    /** Xoay bộ phương án — mỗi lần bấm "Đổi bộ" tăng thêm 1. */
    rotation?: number;
    /** Số phương án cần trả về (1..3, mặc định 3). */
    count?: number;
}

/**
 * Chọn tập phương án cho một prompt.
 *
 * Prompt hash giúp hai prompt khác nhau (cùng mục đích) nhận bộ phương án khác
 * nhau, còn `rotation` cho phép người dùng xoay vòng khi không ưng bộ đầu.
 * Luôn trả về các archetype phân biệt — không bao giờ lặp.
 */
export function pickVariants(prompt: string, options: PickVariantsOptions = {}): ScriptVariantSpec[] {
    const count = Math.min(3, Math.max(1, Math.floor(options.count ?? 3)));
    const priority = PURPOSE_PRIORITY[options.purpose ?? ''] ?? DEFAULT_PRIORITY;
    const offset = (hashString(prompt) + Math.max(0, Math.floor(options.rotation ?? 0))) % priority.length;

    const ordered = [...priority.slice(offset), ...priority.slice(0, offset)];
    return ordered.slice(0, count).map((key) => ARCHETYPES[key]);
}

export interface DraftScore {
    score: number;
    reason: string;
}

/**
 * Chấm điểm một kịch bản để chế độ "Để AI quyết hết" tự chọn phương án.
 *
 * Cố ý dùng công thức deterministic thay vì gọi LLM làm giám khảo: rẻ, nhanh,
 * và giải thích được cho người dùng. Hai tiêu chí duy nhất là độ khớp thời
 * lượng và độ đầy đủ của lời thoại — đúng hai thứ khiến video ra lệch mục tiêu.
 */
export function scoreDraft(script: videoScript, request: Pick<videoRequest, 'targetDurationSec' | 'language' | 'ttsProvider'>): DraftScore {
    const target = request.targetDurationSec;
    const estimated = estimateDuration(script, { language: request.language });
    const total = estimated.totalDurationSec;

    const words = script.scenes.reduce(
        (sum, scene) => sum + (scene.voiceOverText?.trim().split(/\s+/).filter(Boolean).length ?? 0),
        0
    );
    const wordTarget = narrationWordTarget(target, request.language, request.ttsProvider);
    const wordFloor = narrationWordFloor(target, request.language, request.ttsProvider);

    let score = 0;
    const durationGap = Math.abs(total - target) / target;
    score -= durationGap;
    score -= Math.abs(words - wordTarget) / Math.max(wordTarget, 1) * 0.5;
    if (total > target * 1.15) score -= 0.5;
    if (total < target * 0.85) score -= 0.3;
    if (words < wordFloor) score -= 0.3;

    const reason = `${total.toFixed(1)}s/${target}s · ${words}/${wordTarget} từ`;
    return { score: Number(score.toFixed(4)), reason };
}

/**
 * Loại phương án trùng nhau về palette + số cảnh.
 *
 * LLM đôi khi trả ba kịch bản gần giống hệt dù brief khác nhau; giữ lại cả ba
 * chỉ làm người dùng mất thời gian đọc.
 */
export function dedupeVariants<T extends { script: videoScript }>(drafts: T[]): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const draft of drafts) {
        const palette = Object.values(draft.script.colorPalette ?? {}).join('|').toLowerCase();
        const signature = `${draft.script.scenes.length}:${palette}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        result.push(draft);
    }
    return result;
}
