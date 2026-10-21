import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, 'index.json');
const PRESETS_DIR = join(__dirname, 'presets');

export interface StyleMetadata {
    slug: string;
    name_en: string;
    name_cn: string;
    category_en: string;
    category_cn: string;
    uses: string[];
}

/**
 * Đọc và trả về danh sách metadata của 51 style presets.
 */
export function listStyles(): StyleMetadata[] {
    const raw = readFileSync(INDEX_PATH, 'utf-8');
    return JSON.parse(raw) as StyleMetadata[];
}

/**
 * Đọc nội dung visual style prompt markdown tương ứng với slug.
 * Ném Error nếu slug không tồn tại trong thư viện presets.
 */
export function getStylePrompt(slug: string): string {
    if (!slug || typeof slug !== 'string') {
        throw new Error(`Invalid style preset slug: ${slug}`);
    }
    const presetPath = join(PRESETS_DIR, `${slug}.md`);
    if (!existsSync(presetPath)) {
        throw new Error(`Style preset not found for slug: ${slug}`);
    }
    return readFileSync(presetPath, 'utf-8');
}

/** Cache menu prompt để không re-format 51 entries mỗi lần build prompt. */
let _menuCache: string | null = null;

/**
 * Kiểm tra slug có tồn tại trong index.json (51 preset) — dùng để xác thực
 * slug do LLM trả về hoặc user ghim trước khi inject nội dung STYLE.md.
 */
export function isValidStyleSlug(slug: string): boolean {
    if (!slug || typeof slug !== 'string') return false;
    return listStyles().some((s) => s.slug === slug);
}

/**
 * Menu metadata gọn (slug — tên — category — use-case) để gửi cho LLM TỰ CHỌN 1 style
 * phù hợp với brief (triết lý: AI tự quyết, giống narrationMode/voice casting).
 * Chỉ chứa metadata, KHÔNG chứa nội dung STYLE.md (51 file full là quá lớn cho context).
 */
export function formatStyleMenuForPrompt(): string {
    if (_menuCache === null) {
        _menuCache = listStyles()
            .map(
                (s) =>
                    `- ${s.slug} — ${s.name_en} (${s.category_en}) — Uses: ${s.uses.slice(0, 4).join(', ')}`
            )
            .join('\n');
    }
    return _menuCache;
}

/**
 * Đóng gói nội dung STYLE.md của slug đã chọn thành một section hoàn chỉnh để inject
 * vào user prompt sinh script. Trả về chuỗi rỗng nếu slug không hợp lệ (lỗi pick
 * style không được làm hỏng pipeline sinh script).
 */
export function formatStyleSpecForPrompt(slug: string): string {
    if (!slug || typeof slug !== 'string') return '';
    let content: string;
    try {
        content = getStylePrompt(slug);
    } catch {
        return '';
    }
    const meta = listStyles().find((s) => s.slug === slug);
    return [
        `--- OPUSCAR VISUAL STYLE LAYER (slug: ${slug}${meta ? ` — ${meta.name_en}` : ''}) ---`,
        content.trim(),
        'NOTE: You MUST apply the style spec above as the DOMINANT visual veneer — typography, color logic, materials & rendering, motion quality and camera grammar. Where generic style instructions conflict, the opuscar spec wins; but JSON schema, narration word budget and production rules remain unchanged.',
    ].join('\n\n');
}
