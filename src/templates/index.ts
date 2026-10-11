import { CORE_BLOCK_IDS, coreBlocks } from './blocks/core.js';
import {
    cinematicBlueprints,
    getBlocksForStyle,
    getBlueprint,
    getMotionBlock,
    listBlueprints,
    listMotionBlocks,
    motionBlocks,
} from './catalog.js';
import {
    formatBlocksToolkitPrompt,
    formatCatalogSummaryForPrompt,
    formatSelectedCatalogPrompt,
    formatStorySpinePrompt,
} from './prompt.js';
import { BLOCK_HELPERS_JS } from './runtime/blockHelpers.js';
import { allocateBeats, STORY_BEATS } from './storySpine.js';
import type { CatalogResponse } from './types.js';

export type {
    BeatRole,
    BlockCategory,
    CatalogResponse,
    CinematicBlueprint,
    MotionBlock,
    StyleAffinity,
} from './types.js';

export {
    allocateBeats,
    BLOCK_HELPERS_JS,
    cinematicBlueprints,
    CORE_BLOCK_IDS,
    coreBlocks,
    formatBlocksToolkitPrompt,
    formatCatalogSummaryForPrompt,
    formatSelectedCatalogPrompt,
    formatStorySpinePrompt,
    getBlocksForStyle,
    getBlueprint,
    getMotionBlock,
    listBlueprints,
    listMotionBlocks,
    motionBlocks,
    STORY_BEATS,
};

export function getCatalog(): CatalogResponse {
    return {
        blocks: listMotionBlocks(),
        blueprints: listBlueprints(),
        coreBlockIds: [...CORE_BLOCK_IDS],
    };
}
