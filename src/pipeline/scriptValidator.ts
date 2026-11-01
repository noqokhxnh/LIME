import { ZodError } from 'zod';
import { videoScriptSchema, type videoScript } from '../llm/schema.js';
import { getStyleMotionSpec } from '../templates/styles/index.js';
import { findMissingAmbientTargets } from './ambient.js';

export interface ScriptValidationResult {
    valid: boolean;
    data?: videoScript;
    errors: string[];
    formattedErrorMessage?: string;
}

export interface ScriptValidationOptions {
    /**
     * Style preset đang dùng. Khi có, `scene.camera.move` phải nằm trong
     * camera grammar của preset (#123). Không truyền → bỏ qua (tương thích cũ).
     */
    styleSlug?: string | null;
}

/**
 * Format danh sách lỗi từ Zod issue thành chuỗi thông báo rõ ràng cho từng trường,
 * giúp LLM nhận diện chính xác trường nào bị lỗi để tự sửa chữa (self-correction).
 */
export function formatZodIssues(error: ZodError): string[] {
    return error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `- [Trường: ${path}]: ${issue.message}`;
    });
}

/**
 * Kiểm tra camera move của từng scene có thuộc grammar của preset không (#123).
 *
 * Preset parse được grammar (`source: 'preset'`) mới chấm; preset thiếu §6 dùng
 * vocabulary lõi nên mọi move hợp lệ theo schema đều pass.
 */
export function validateCameraGrammar(
    script: videoScript,
    styleSlug?: string | null
): string[] {
    if (!styleSlug) return [];
    const spec = getStyleMotionSpec(styleSlug);
    if (spec.camera.source !== 'preset') return [];

    const allowed = new Set(spec.camera.allowed);
    const errors: string[] = [];
    script.scenes.forEach((scene, index) => {
        const move = scene.camera?.move;
        if (!move || allowed.has(move)) return;
        errors.push(
            `- [Trường: scenes.${index}.camera.move]: Scene '${scene.id}' dùng camera move '${move}' không thuộc grammar của preset '${styleSlug}'. Move hợp lệ: ${spec.camera.allowed.join(', ')}.`
        );
    });
    return errors;
}

/**
 * Kiểm tra target của `scene.ambient[]` có thật trong code scene (#125).
 *
 * Chỉ báo khi selector không xuất hiện ở cả `htmlCode` lẫn `jsCode` — phần tử
 * do JS sinh động vẫn được chấp nhận.
 */
export function validateAmbientTargets(script: videoScript): string[] {
    const errors: string[] = [];
    script.scenes.forEach((scene, index) => {
        const missing = findMissingAmbientTargets(scene);
        if (missing.length === 0) return;
        errors.push(
            `- [Trường: scenes.${index}.ambient]: Scene '${scene.id}' khai ambient target ${missing
                .map((target) => `'${target}'`)
                .join(', ')} nhưng không tìm thấy trong htmlCode/jsCode.`
        );
    });
    return errors;
}

/**
 * Xác thực kịch bản video thô (từ phản hồi JSON của LLM) thông qua videoScriptSchema.
 * Đảm bảo các ràng buộc:
 * - Cấu trúc kịch bản đầy đủ
 * - Hợp đồng Boundary & Carry Plan (liên tục, đúng số lượng, hardCut có reason)
 * - Ràng buộc nhịp điệu Rhythm (max/min >= 4, near-still >= 1.5s, CV >= 0.3)
 * - Camera move thuộc grammar của style preset (#123, khi truyền `styleSlug`)
 */
export function validateScript(
    data: unknown,
    options?: ScriptValidationOptions
): ScriptValidationResult {
    const parseResult = videoScriptSchema.safeParse(data);
    if (!parseResult.success) {
        const errors = formatZodIssues(parseResult.error);
        const formattedErrorMessage = `Lỗi cấu trúc kịch bản (Validation Failed):\n${errors.join('\n')}`;
        return {
            valid: false,
            errors,
            formattedErrorMessage,
        };
    }

    const cameraErrors = validateCameraGrammar(parseResult.data, options?.styleSlug);
    if (cameraErrors.length > 0) {
        return {
            valid: false,
            errors: cameraErrors,
            formattedErrorMessage: `Lỗi camera grammar (Validation Failed):\n${cameraErrors.join('\n')}`,
        };
    }

    const ambientErrors = validateAmbientTargets(parseResult.data);
    if (ambientErrors.length > 0) {
        return {
            valid: false,
            errors: ambientErrors,
            formattedErrorMessage: `Lỗi ambient target (Validation Failed):\n${ambientErrors.join('\n')}`,
        };
    }

    return {
        valid: true,
        data: parseResult.data,
        errors: [],
    };
}
