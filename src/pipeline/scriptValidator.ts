import { ZodError } from 'zod';
import { videoScriptSchema, type videoScript } from '../llm/schema.js';

export interface ScriptValidationResult {
    valid: boolean;
    data?: videoScript;
    errors: string[];
    formattedErrorMessage?: string;
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
 * Xác thực kịch bản video thô (từ phản hồi JSON của LLM) thông qua videoScriptSchema.
 * Đảm bảo các ràng buộc:
 * - Cấu trúc kịch bản đầy đủ
 * - Hợp đồng Boundary & Carry Plan (liên tục, đúng số lượng, hardCut có reason)
 * - Ràng buộc nhịp điệu Rhythm (max/min >= 4, near-still >= 1.5s, CV >= 0.3)
 */
export function validateScript(data: unknown): ScriptValidationResult {
    const parseResult = videoScriptSchema.safeParse(data);
    if (parseResult.success) {
        return {
            valid: true,
            data: parseResult.data,
            errors: [],
        };
    }

    const errors = formatZodIssues(parseResult.error);
    const formattedErrorMessage = `Lỗi cấu trúc kịch bản (Validation Failed):\n${errors.join('\n')}`;

    return {
        valid: false,
        errors,
        formattedErrorMessage,
    };
}
