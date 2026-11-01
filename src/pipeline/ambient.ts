/**
 * Ambient / native move layer (#125).
 *
 * Preset §8 mô tả những chuyển động "bản chất vật liệu" (hơi nước bốc, giọt nhỏ,
 * đèn nhấp nháy, băng chuyền trôi, parallax, nhịp thở). Trước #125 LLM phải tự
 * viết tween cho từng thứ, phần lớn bỏ qua → phần tử vào xong đứng yên tuyệt đối.
 *
 * Ở đây mỗi move là **dữ liệu keyframe thuần theo chu kỳ**, không phải tween tích
 * luỹ. Pipeline serialize keyframe vào HTML và `__seekTo(t)` suy ra trạng thái tại
 * đúng t, nên tua qua lại không bao giờ trôi (seek purity) và không đụng vào
 * timeline của LLM.
 */

export const AMBIENT_MOVE_IDS = [
    'steam',
    'drip',
    'flicker',
    'drift',
    'parallax',
    'pulse',
] as const;

export type AmbientMove = (typeof AMBIENT_MOVE_IDS)[number];

/** Một mốc keyframe; `p` là pha 0..1 trong chu kỳ. */
export interface AmbientKey {
    p: number;
    x?: number;
    y?: number;
    scale?: number;
    opacity?: number;
    rotation?: number;
}

export interface AmbientTrack {
    /** Chu kỳ lặp (giây). */
    period: number;
    keys: AmbientKey[];
}

/** Khai báo của LLM trong `scene.ambient[]`. */
export interface AmbientSpec {
    move: AmbientMove;
    /** Selector trong phạm vi scene (vd `.steam`, `#cup-steam`). */
    target: string;
    /** 0..1, mặc định 0.6. */
    intensity?: number;
    /** Giây trong scene; mặc định 0. */
    from?: number;
    /** Giây trong scene; mặc định hết scene. */
    to?: number;
}

/** Khai báo đã resolve để serialize vào HTML. */
export interface ResolvedAmbient {
    move: AmbientMove;
    target: string;
    from: number;
    to: number;
    period: number;
    keys: AmbientKey[];
}

/** Mỗi scene tối đa 2 ambient move — nhiều hơn là trang trí lạm dụng. */
export const MAX_AMBIENT_PER_SCENE = 2;

const DEFAULT_INTENSITY = 0.6;

export function clamp01(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INTENSITY;
    return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * Dựng keyframe cho một move. Biên độ tỉ lệ với `intensity`; intensity = 0 vẫn
 * giữ trạng thái tĩnh (không nhảy), nên công thức là tuyến tính theo i.
 */
export function buildAmbientTrack(move: AmbientMove, intensity?: number): AmbientTrack {
    const i = clamp01(intensity);
    switch (move) {
        case 'steam':
            return {
                period: 2.4,
                keys: [
                    { p: 0, y: 0, scale: 0.9, opacity: 0 },
                    { p: 0.25, y: round(-8 * i), scale: 0.98, opacity: round(0.6 * i) },
                    { p: 0.6, y: round(-18 * i), scale: 1.08, opacity: round(0.35 * i) },
                    { p: 1, y: round(-26 * i), scale: 1.16, opacity: 0 },
                ],
            };
        case 'drip':
            return {
                period: 1.8,
                keys: [
                    { p: 0, y: 0, opacity: 1 },
                    { p: 0.85, y: round(38 * i), opacity: 0.9 },
                    { p: 1, y: round(44 * i), opacity: 0 },
                ],
            };
        case 'flicker':
            return {
                period: 0.16,
                keys: [
                    { p: 0, opacity: 1 },
                    { p: 0.5, opacity: round(1 - 0.45 * i) },
                    { p: 1, opacity: 1 },
                ],
            };
        case 'drift':
            return {
                period: 4.5,
                keys: [
                    { p: 0, x: round(-7 * i), y: 0 },
                    { p: 0.25, x: 0, y: round(-2 * i) },
                    { p: 0.5, x: round(7 * i), y: 0 },
                    { p: 0.75, x: 0, y: round(2 * i) },
                    { p: 1, x: round(-7 * i), y: 0 },
                ],
            };
        case 'parallax':
            return {
                period: 6,
                keys: [
                    { p: 0, x: round(-10 * i), y: round(-4 * i) },
                    { p: 0.5, x: round(10 * i), y: round(4 * i) },
                    { p: 1, x: round(-10 * i), y: round(-4 * i) },
                ],
            };
        case 'pulse':
            return {
                period: 1.3,
                keys: [
                    { p: 0, scale: 1 },
                    { p: 0.5, scale: round(1 + 0.06 * i) },
                    { p: 1, scale: 1 },
                ],
            };
        default:
            return { period: 1, keys: [{ p: 0 }, { p: 1 }] };
    }
}

/** Nội suy tuyến tính giữa hai keyframe (thuộc tính vắng mặt được giữ nguyên). */
function lerpKeys(a: AmbientKey, b: AmbientKey, t: number): AmbientKey {
    const out: AmbientKey = { p: 0 };
    const mix = (from: number | undefined, to: number | undefined): number | undefined => {
        if (from === undefined && to === undefined) return undefined;
        const start = from ?? to ?? 0;
        const end = to ?? from ?? 0;
        return round(start + (end - start) * t);
    };
    for (const prop of ['x', 'y', 'scale', 'opacity', 'rotation'] as const) {
        const value = mix(a[prop], b[prop]);
        if (value !== undefined) out[prop] = value;
    }
    return out;
}

/**
 * Trạng thái ambient tại thời điểm tuyệt đối `tSec` (giây trong scene).
 * Hàm thuần: cùng t luôn cho cùng kết quả, không phụ thuộc lần seek trước.
 */
export function getAmbientState(
    track: AmbientTrack,
    tSec: number
): AmbientKey {
    const period = track.period > 0 ? track.period : 1;
    const phase = ((tSec % period) + period) % period / period;
    const keys = track.keys;
    if (keys.length === 0) return { p: 0 };
    if (keys.length === 1) return { ...keys[0] };
    let prev = keys[0];
    let next = keys[keys.length - 1];
    for (let index = 1; index < keys.length; index += 1) {
        if (phase <= keys[index].p + 1e-9) {
            prev = keys[index - 1];
            next = keys[index];
            break;
        }
    }
    const span = next.p - prev.p;
    const local = span > 0 ? (phase - prev.p) / span : 0;
    return lerpKeys(prev, next, Math.min(1, Math.max(0, local)));
}

/**
 * Chuẩn hoá khai báo ambient của scene: cắt `from/to` vào [0, duration], bỏ mục
 * rỗng thời lượng, gắn keyframe. Mục không hợp lệ bị loại thay vì làm hỏng render.
 */
export function resolveAmbient(
    specs: AmbientSpec[] | undefined,
    duration: number
): ResolvedAmbient[] {
    if (!Array.isArray(specs) || specs.length === 0) return [];
    const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const resolved: ResolvedAmbient[] = [];

    for (const spec of specs.slice(0, MAX_AMBIENT_PER_SCENE)) {
        if (!spec || typeof spec.target !== 'string' || !spec.target.trim()) continue;
        if (!AMBIENT_MOVE_IDS.includes(spec.move)) continue;

        const from = Math.max(0, Math.min(total, spec.from ?? 0));
        const to = Math.max(0, Math.min(total, spec.to ?? total));
        if (to <= from) continue;

        const track = buildAmbientTrack(spec.move, spec.intensity);
        resolved.push({
            move: spec.move,
            target: spec.target.trim(),
            from: round(from),
            to: round(to),
            period: track.period,
            keys: track.keys,
        });
    }

    return resolved;
}

/**
 * Kiểm tra target của ambient có tồn tại trong code scene không.
 *
 * LLM có thể tạo phần tử bằng JS, nên chỉ báo lỗi khi token không xuất hiện ở
 * cả `htmlCode` lẫn `jsCode` — tránh chặn oan phần tử sinh động.
 */
export function findMissingAmbientTargets(
    scene: { htmlCode?: string; jsCode?: string; ambient?: AmbientSpec[] }
): string[] {
    const missing: string[] = [];
    const haystack = `${scene.htmlCode ?? ''}\n${scene.jsCode ?? ''}`;
    for (const spec of scene.ambient ?? []) {
        const token = spec.target.trim().replace(/^[.#]/, '');
        if (!token) continue;
        if (!haystack.includes(token)) missing.push(spec.target);
    }
    return missing;
}
