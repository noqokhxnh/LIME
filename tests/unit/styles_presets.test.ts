import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStyles, getStylePrompt } from '../../src/templates/styles/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = join(__dirname, '..', '..', 'src', 'templates', 'styles');
const PRESETS_DIR = join(STYLES_DIR, 'presets');
const INDEX_JSON_PATH = join(STYLES_DIR, 'index.json');

describe('Opuscar style presets loader & catalog (#104)', () => {
    it('index.json parse được và có đúng 51 entries', () => {
        const raw = readFileSync(INDEX_JSON_PATH, 'utf-8');
        const data = JSON.parse(raw);
        assert.ok(Array.isArray(data), 'index.json phải là một mảng');
        assert.equal(data.length, 51, 'Phải có đúng 51 entries');
    });

    it('slug trong index.json và các file trong presets/ khớp 2 chiều tuyệt đối', () => {
        const raw = readFileSync(INDEX_JSON_PATH, 'utf-8');
        const items = JSON.parse(raw) as Array<{ slug: string }>;
        const jsonSlugs = items.map((i) => i.slug);

        // Đảm bảo không trùng lặp slug trong index.json
        const uniqueJsonSlugs = new Set(jsonSlugs);
        assert.equal(uniqueJsonSlugs.size, 51, 'Không được có slug trùng lặp trong index.json');

        const presetFiles = readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.md'));
        assert.equal(presetFiles.length, 51, 'Thư mục presets/ phải có đúng 51 file .md');

        const fileSlugs = presetFiles.map((f) => f.replace(/\.md$/, ''));
        const fileSlugsSet = new Set(fileSlugs);

        // Chiều 1: Mọi slug trong index.json đều có file tương ứng
        for (const slug of jsonSlugs) {
            assert.ok(fileSlugsSet.has(slug), `Thiếu file preset cho slug: ${slug}`);
        }

        // Chiều 2: Mọi file trong presets/ đều có mặt trong index.json
        for (const slug of fileSlugs) {
            assert.ok(uniqueJsonSlugs.has(slug), `File preset ${slug}.md không có trong index.json`);
        }
    });

    it('listStyles() trả về đúng 51 items với cấu trúc metadata đầy đủ', () => {
        const styles = listStyles();
        assert.equal(styles.length, 51);

        for (const style of styles) {
            assert.ok(style.slug, 'Thiếu trường slug');
            assert.ok(style.name_en, `Thiếu trường name_en tại slug ${style.slug}`);
            assert.ok(style.name_cn, `Thiếu trường name_cn tại slug ${style.slug}`);
            assert.ok(style.category_en, `Thiếu trường category_en tại slug ${style.slug}`);
            assert.ok(style.category_cn, `Thiếu trường category_cn tại slug ${style.slug}`);
            assert.ok(Array.isArray(style.uses), `uses phải là mảng tại slug ${style.slug}`);
            assert.ok(style.uses.length > 0, `uses không được rỗng tại slug ${style.slug}`);
        }
    });

    it('getStylePrompt(slug) trả về nội dung prompt không rỗng với các slug mẫu', () => {
        const sampleSlugs = [
            'archive-lighttable',
            'cel-anime-80s',
            'hologram-hud',
            'papercut-red',
            'woodcut',
        ];

        for (const slug of sampleSlugs) {
            const prompt = getStylePrompt(slug);
            assert.equal(typeof prompt, 'string');
            assert.ok(prompt.trim().length > 100, `Nội dung prompt của ${slug} quá ngắn`);
            assert.match(prompt, /^#\s+/m, `Prompt của ${slug} phải bắt đầu bằng tiêu đề markdown`);
        }
    });

    it('getStylePrompt ném Error khi slug không tồn tại hoặc không hợp lệ', () => {
        assert.throws(() => {
            getStylePrompt('non-existent-slug-xyz');
        }, /Style preset not found/);

        assert.throws(() => {
            getStylePrompt('');
        }, /Invalid style preset slug/);
    });
});
