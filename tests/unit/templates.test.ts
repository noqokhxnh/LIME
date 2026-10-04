import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CORE_BLOCK_IDS,
    getCatalog,
    listBlueprints,
    listMotionBlocks,
    formatBlocksToolkitPrompt,
    formatStorySpinePrompt,
    formatSelectedCatalogPrompt,
    BLOCK_HELPERS_JS,
} from '../../src/templates/index.js';

describe('Templates catalog (#43)', () => {
    it('có ít nhất 50 motion blocks', () => {
        assert.ok(listMotionBlocks().length >= 50, `got ${listMotionBlocks().length}`);
    });

    it('có đủ 5 core runtime blocks', () => {
        const ids = new Set(listMotionBlocks().filter((b) => b.runtime).map((b) => b.id));
        for (const id of CORE_BLOCK_IDS) {
            assert.ok(ids.has(id), `missing runtime block ${id}`);
        }
    });

    it('getCatalog trả về blocks + blueprints + coreBlockIds', () => {
        const catalog = getCatalog();
        assert.ok(catalog.blocks.length >= 50);
        assert.ok(catalog.blueprints.length >= 1);
        assert.deepEqual(catalog.coreBlockIds, [...CORE_BLOCK_IDS]);
    });

    it('blueprints có suggestedBlocks và promptSnippet', () => {
        for (const bp of listBlueprints()) {
            assert.ok(bp.id);
            assert.ok(bp.promptSnippet.length > 10);
            assert.ok(Array.isArray(bp.suggestedBlocks));
            assert.ok(bp.beatPlan.length >= 3);
        }
    });

    it('formatStorySpinePrompt và formatBlocksToolkitPrompt không rỗng', () => {
        const spine = formatStorySpinePrompt(20);
        const toolkit = formatBlocksToolkitPrompt('modern');
        assert.match(spine, /CINEMATIC STORY SPINE/);
        assert.match(spine, /Hook/);
        assert.match(toolkit, /window\.__block/);
        assert.match(toolkit, /kinetic-type/);
        assert.match(toolkit, /bar-chart/);
    });

    it('formatSelectedCatalogPrompt ưu tiên blueprint + block ids', () => {
        const text = formatSelectedCatalogPrompt({
            blueprintId: 'faceless-explainer',
            motionBlockIds: ['kinetic-type', 'bar-chart'],
            style: 'modern',
        });
        assert.match(text, /faceless-explainer|Faceless Explainer/);
        assert.match(text, /kinetic-type/);
        assert.match(text, /bar-chart/);
    });

    it('BLOCK_HELPERS_JS chứa window.__block và 5 core names', () => {
        assert.match(BLOCK_HELPERS_JS, /window\.__block\s*=\s*function/);
        assert.match(BLOCK_HELPERS_JS, /__block\.animate/);
        for (const id of CORE_BLOCK_IDS) {
            assert.ok(BLOCK_HELPERS_JS.includes(id), `helpers missing ${id}`);
        }
    });
});
