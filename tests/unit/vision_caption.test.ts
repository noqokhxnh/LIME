import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCaption } from '../../src/llm/vision.js';

// ============================================================
// UNIT TEST MODULE: VISION CAPTION (#103) — src/llm/vision.ts
// parseCaption: parse JSON từ text mô hình vision trả về, chịu
// markdown fence + text thừa quanh JSON.
// ============================================================

describe('Module: vision caption (#103) — parseCaption', () => {
    it('parse JSON thuần', () => {
        const c = parseCaption('{"description":"Cảnh hoàng hôn trên biển","tags":["hoàng hôn","biển"]}');
        assert.equal(c.description, 'Cảnh hoàng hôn trên biển');
        assert.deepEqual(c.tags, ['hoàng hôn', 'biển']);
    });

    it('bóc markdown fence ```json', () => {
        const c = parseCaption('```json\n{"description":"Logo sản phẩm","tags":["logo","thương hiệu"]}\n```');
        assert.equal(c.description, 'Logo sản phẩm');
        assert.deepEqual(c.tags, ['logo', 'thương hiệu']);
    });

    it('chịu text thừa quanh JSON', () => {
        const c = parseCaption('Đây là kết quả: {"description":"Video quay phố đêm","tags":["phố đêm","ánh sáng"]} cảm ơn');
        assert.equal(c.description, 'Video quay phố đêm');
        assert.deepEqual(c.tags, ['phố đêm', 'ánh sáng']);
    });

    it('tags dạng chuỗi phân cách dấu phẩy cũng parse được', () => {
        const c = parseCaption('{"description":"Cô gái đứng bên hồ","tags":"cô gái, hồ, thiên nhiên"}');
        assert.equal(c.description, 'Cô gái đứng bên hồ');
        assert.deepEqual(c.tags, ['cô gái', 'hồ', 'thiên nhiên']);
    });

    it('cắt tags quá 10 phần tử', () => {
        const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
        const c = parseCaption(JSON.stringify({ description: 'd', tags }));
        assert.equal(c.tags.length, 10);
    });

    it('ném lỗi khi text không phải JSON', () => {
        assert.throws(() => parseCaption('không có json ở đây'));
    });

    it('ném lỗi khi description rỗng và tags rỗng', () => {
        assert.throws(() => parseCaption('{"description":"","tags":[]}'));
    });
});
