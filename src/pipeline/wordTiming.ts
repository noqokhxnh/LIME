/**
 * Module xử lý word-level timing cho phụ đề Karaoke (Spec G)
 * Cung cấp:
 * 1. Interface WordTiming: { word, startMs, endMs }
 * 2. Phân tích word boundaries từ metadata của TTS provider (ví dụ Edge TTS)
 * 3. Thuật toán fallback phân bổ từ theo độ dài ký tự khi TTS không trả về word-level timestamps
 * 4. Hàm kiểm tra độ lệch onset dung sai (tolerance <= 120ms)
 */

export interface WordTiming {
    word: string;
    startMs: number;
    endMs: number;
}

export type SceneWordTimings = Record<string, WordTiming[]>;

/**
 * Phân tích metadata WordBoundary từ WebSocket frame của Edge TTS.
 * Đơn vị thời gian trong Edge TTS là 100ns ticks (10,000 ticks = 1 ms).
 */
export function parseEdgeWordBoundaries(metadataJson: string): WordTiming[] {
    try {
        const parsed = JSON.parse(metadataJson);
        const list = parsed.Metadata || [];
        const result: WordTiming[] = [];

        for (const item of list) {
            if (item.Type === "WordBoundary" && item.Data) {
                const word = item.Data.text?.Text || "";
                const offsetTicks = Number(item.Data.Offset ?? 0);
                const durationTicks = Number(item.Data.Duration ?? 0);
                const startMs = Math.round(offsetTicks / 10000);
                const endMs = startMs + Math.round(durationTicks / 10000);

                if (word.trim().length > 0) {
                    result.push({
                        word: word.trim(),
                        startMs,
                        endMs,
                    });
                }
            }
        }
        return result;
    } catch {
        return [];
    }
}

/**
 * Thuật toán Fallback: Phân bổ các từ trên tổng thời lượng TTS đo được
 * theo trọng số độ dài ký tự của từng từ (có xét thêm khoảng nghỉ nhẹ sau dấu câu).
 * Đảm bảo các từ liên tục, không chồng chéo, onset khớp trong khoảng kỳ vọng.
 */
export function computeFallbackWordTimings(text: string, durationSec: number): WordTiming[] {
    if (!text || durationSec <= 0) return [];
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const weights = words.map((w) => {
        let wt = Math.max(1, w.length);
        if (/[,.!?;:]$/.test(w)) {
            wt += 1.2; // Dấu ngắt câu có khoảng nghỉ nhẹ
        }
        return wt;
    });

    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    const totalMs = Math.round(durationSec * 1000);

    const result: WordTiming[] = [];
    let currentMs = 0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const isLast = i === words.length - 1;
        const dur = isLast ? (totalMs - currentMs) : Math.round((weights[i] / totalWeight) * totalMs);
        const startMs = currentMs;
        const endMs = Math.min(totalMs, currentMs + Math.max(1, dur));

        result.push({
            word,
            startMs,
            endMs,
        });

        currentMs = endMs;
    }

    return result;
}

/**
 * Kiểm tra xem danh sách word onset thực tế có nằm trong dung sai ±toleranceMs (mặc định 120ms)
 * so với dữ liệu chuẩn hay không.
 */
export function checkWordOnsetTolerance(
    actual: WordTiming[],
    expected: WordTiming[],
    toleranceMs: number = 120
): { valid: boolean; maxDiffMs: number; diffs: number[] } {
    if (actual.length !== expected.length) {
        return { valid: false, maxDiffMs: Infinity, diffs: [] };
    }

    const diffs: number[] = [];
    let maxDiffMs = 0;

    for (let i = 0; i < actual.length; i++) {
        const diff = Math.abs(actual[i].startMs - expected[i].startMs);
        diffs.push(diff);
        if (diff > maxDiffMs) {
            maxDiffMs = diff;
        }
    }

    return {
        valid: maxDiffMs <= toleranceMs,
        maxDiffMs,
        diffs,
    };
}
