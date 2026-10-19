import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ARCHETYPES,
    dedupeVariants,
    pickVariants,
    scoreDraft,
    type ArchetypeKey,
} from '../../src/pipeline/scriptVariants.js';
import type { videoScript } from '../../src/llm/schema.js';

function fakeScript(voiceOverText: string, colorPalette = { primary: '#111111' }): videoScript {
    return {
        scenes: [{ id: 's1', voiceOverText }],
        colorPalette,
    } as unknown as videoScript;
}

describe('Module HITL: scriptVariants', () => {
    it('luôn trả về đúng số phương án và không lặp archetype', () => {
        const variants = pickVariants('Giới thiệu Hà Nội 3 cảnh', { purpose: 'explain' });
        assert.equal(variants.length, 3);
        const keys = variants.map(v => v.key);
        assert.equal(new Set(keys).size, 3);
    });

    it('cùng prompt + cùng rotation cho ra cùng bộ phương án (deterministic)', () => {
        const a = pickVariants('prompt ổn định', { purpose: 'persuade', rotation: 0 });
        const b = pickVariants('prompt ổn định', { purpose: 'persuade', rotation: 0 });
        assert.deepEqual(a.map(v => v.key), b.map(v => v.key));
    });

    it('tăng rotation sẽ đổi bộ phương án', () => {
        const prompt = 'prompt cần đổi bộ';
        const sets = new Set<string>();
        for (let rotation = 0; rotation < 4; rotation++) {
            sets.add(pickVariants(prompt, { purpose: 'story', rotation }).map(v => v.key).join(','));
        }
        assert.ok(sets.size > 1, 'rotation phải tạo ra nhiều hơn một bộ phương án');
    });

    it('mục đích khác nhau ưu tiên archetype khác nhau', () => {
        const explain = pickVariants('cùng prompt', { purpose: 'explain', rotation: 0 }).map(v => v.key);
        const story = pickVariants('cùng prompt', { purpose: 'story', rotation: 0 }).map(v => v.key);
        assert.notDeepEqual(explain, story);
    });

    it('mỗi archetype gắn style và blueprint riêng, không trùng nhau', () => {
        const styles = new Set(Object.values(ARCHETYPES).map(a => a.style));
        const blueprints = new Set(Object.values(ARCHETYPES).map(a => a.blueprintId));
        assert.equal(styles.size, 4);
        assert.equal(blueprints.size, 4);
    });

    it('brief của mỗi archetype phải khác nhau', () => {
        const keys = Object.keys(ARCHETYPES) as ArchetypeKey[];
        const briefs = new Set(keys.map(k => ARCHETYPES[k].brief));
        assert.equal(briefs.size, keys.length);
    });

    it('count = 1 chỉ trả về một phương án', () => {
        const variants = pickVariants('prompt ngắn', { count: 1 });
        assert.equal(variants.length, 1);
    });

    it('scoreDraft ưu tiên kịch bản gần mục tiêu thời lượng hơn', () => {
        const base = { targetDurationSec: 30, language: 'vi' };
        const onTarget = scoreDraft(fakeScript('một hai ba bốn năm sáu bảy tám chín mười'), base);
        const wayTooShort = scoreDraft(fakeScript('một'), base);
        assert.ok(onTarget.score > wayTooShort.score);
    });

    it('dedupeVariants loại phương án trùng palette và số cảnh', () => {
        const drafts = [
            { key: 'a', script: fakeScript('x', { primary: '#111111' }) },
            { key: 'b', script: fakeScript('y', { primary: '#111111' }) },
            { key: 'c', script: fakeScript('z', { primary: '#222222' }) },
        ];
        const result = dedupeVariants(drafts);
        assert.deepEqual(result.map(d => d.key), ['a', 'c']);
    });
});
