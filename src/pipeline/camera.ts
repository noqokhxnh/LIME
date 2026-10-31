/**
 * Camera layer (#122).
 *
 * Camera là một lớp **do pipeline thi hành**, không phải tween do LLM tự viết.
 * LLM chỉ khai `scene.camera = { move, intensity }`; `assembleHtml` biến khai báo
 * đó thành một `fromTo` trên master timeline (đang paused) tại `startTime` của
 * scene với `ease: 'none'`, nên tua tới thời điểm bất kỳ luôn cho cùng một khung
 * hình — đúng contract seek-safe của Spec B.
 *
 * Vocabulary ở đây là **lõi**, dùng chung cho mọi preset. Từ #123 trở đi, preset
 * có thể giới hạn tập move được phép qua `cameraGrammar`.
 */

export const CAMERA_MOVE_IDS = [
    'locked',
    'push-in',
    'pull-back',
    'pan-left',
    'pan-right',
    'tilt-up',
    'tilt-down',
] as const;

export type CameraMove = (typeof CAMERA_MOVE_IDS)[number];

export interface CameraSpec {
    move: CameraMove;
    /**
     * Cường độ 0..1. 0 = gần như đứng yên, 1 = move tối đa. Mặc định 0.5 —
     * đủ thấy chuyển động nhưng không gây chóng mặt.
     */
    intensity?: number;
}

export interface CameraTransform {
    scale: number;
    xPercent: number;
    yPercent: number;
}

export interface CameraTween {
    from: CameraTransform;
    to: CameraTransform;
}

/** Camera đã resolve, sẵn sàng serialize vào HTML/QA report. */
export interface ResolvedCamera extends CameraTween {
    move: CameraMove;
    intensity: number;
}

export const DEFAULT_CAMERA_INTENSITY = 0.5;

/**
 * Biên độ tối đa ở intensity = 1. Giữ nhỏ có chủ đích: camera move trong video
 * giải thích/landing phải tinh tế, không phải zoom kiểu slideshow.
 */
export const MAX_CAMERA_SCALE_DELTA = 0.12;
export const MAX_CAMERA_PAN_PERCENT = 6;
export const MAX_CAMERA_TILT_PERCENT = 6;

const IDENTITY: CameraTransform = { scale: 1, xPercent: 0, yPercent: 0 };

function clamp01(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_CAMERA_INTENSITY;
    }
    return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

function transform(scale = 1, xPercent = 0, yPercent = 0): CameraTransform {
    return {
        scale: round4(scale),
        xPercent: round4(xPercent),
        yPercent: round4(yPercent),
    };
}

/**
 * Tính cặp transform đầu/cuối cho một move. Hàm thuần, không phụ thuộc DOM.
 *
 * Quy ước hướng: move mô tả **camera di chuyển**, nên nội dung dịch ngược lại.
 * `pan-left` (camera sang trái) ⇒ scene trôi sang phải (`xPercent` dương).
 */
export function getCameraTween(spec: CameraSpec): CameraTween {
    const intensity = clamp01(spec.intensity);
    const scaleDelta = MAX_CAMERA_SCALE_DELTA * intensity;
    const pan = MAX_CAMERA_PAN_PERCENT * intensity;
    const tilt = MAX_CAMERA_TILT_PERCENT * intensity;

    switch (spec.move) {
        case 'push-in':
            return { from: transform(), to: transform(1 + scaleDelta) };
        case 'pull-back':
            return { from: transform(1 + scaleDelta), to: transform() };
        case 'pan-left':
            return { from: transform(), to: transform(1, pan) };
        case 'pan-right':
            return { from: transform(), to: transform(1, -pan) };
        case 'tilt-up':
            return { from: transform(), to: transform(1, 0, tilt) };
        case 'tilt-down':
            return { from: transform(), to: transform(1, 0, -tilt) };
        case 'locked':
        default:
            return { from: transform(), to: transform() };
    }
}

/**
 * Chuẩn hoá khai báo camera của scene. Scene không khai → `locked` (không đổi
 * hành vi so với kịch bản cũ).
 */
export function resolveCamera(spec?: CameraSpec | null): ResolvedCamera {
    const move: CameraMove = spec?.move ?? 'locked';
    const intensity = clamp01(spec?.intensity);
    const { from, to } = getCameraTween({ move, intensity });
    return { move, intensity, from, to };
}

/** `true` khi camera thực sự làm khung hình thay đổi (cần gắn tween). */
export function isMovingCamera(camera: ResolvedCamera): boolean {
    if (camera.move === 'locked') return false;
    return (
        camera.from.scale !== camera.to.scale ||
        camera.from.xPercent !== camera.to.xPercent ||
        camera.from.yPercent !== camera.to.yPercent
    );
}
