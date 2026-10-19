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
