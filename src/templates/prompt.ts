import { CORE_BLOCK_IDS, coreBlocks } from './blocks/core.js';
import {
    getBlueprint,
    getBlocksForStyle,
    getMotionBlock,
    listBlueprints,
    listMotionBlocks,
} from './catalog.js';
import { formatStorySpinePrompt } from './storySpine.js';

export { formatStorySpinePrompt };

export function formatBlocksToolkitPrompt(style?: string): string {
    const coreSection = coreBlocks
        .map(
            (b) =>
                `- \`${b.id}\` (${b.name}): ${b.description}\n  Usage: ${b.promptSnippet}\n  Params: ${b.paramsHint || '{}'}`
        )
        .join('\n');

    const styleBlocks = getBlocksForStyle(style || 'modern')
        .filter((b) => !b.runtime)
        .slice(0, 12)
        .map((b) => `- \`${b.id}\`: ${b.promptSnippet}`)
        .join('\n');

    return `## MOTION BLOCKS TOOLKIT (window.__block)
Core runtime blocks (ALWAYS available after assemble — DO NOT reimplement their DOM):
${coreSection}

Example mount + animate inside scene jsCode:
\`\`\`javascript
(function() {
  const dur = {{SCENE_DURATION}};
  const tl = gsap.timeline();
  tl.to('#scene_1', { opacity: 1, duration: 0.4 }, 0);
  const mount = document.querySelector('#scene_1 .block-mount');
  const root = window.__block('bar-chart', mount, {
    title: 'Growth',
    items: [{ label: 'A', value: 40 }, { label: 'B', value: 78 }],
    suffix: '%'
  });
  window.__block.animate('bar-chart', root, tl, { at: 0.2, duration: Math.min(1.6, dur - 1), suffix: '%' });
  tl.to('#scene_1', { opacity: 0, duration: 0.45 }, Math.max(0, dur - 0.45));
  window.__registerScene('scene_1', tl, dur);
})();
\`\`\`

In htmlCode, provide an empty mount node, e.g. \`<div class="block-mount" style="width:100%;height:100%;"></div>\` plus optional short title anchors.

Additional catalog recipes for style "${style || 'modern'}":
${styleBlocks}

Core ids: ${CORE_BLOCK_IDS.join(', ')}`;
}

export function formatSelectedCatalogPrompt(options: {
    blueprintId?: string;
    motionBlockIds?: string[];
    style?: string;
}): string {
    const parts: string[] = [];

    if (options.blueprintId) {
        const bp = getBlueprint(options.blueprintId);
        if (bp) {
            parts.push(`## SELECTED CINEMATIC BLUEPRINT: ${bp.name} (\`${bp.id}\`)
${bp.description}
${bp.promptSnippet}
Beat plan:
${bp.beatPlan.map((b, i) => `${i + 1}. ${b}`).join('\n')}
Prefer blocks: ${bp.suggestedBlocks.join(', ')}`);
        } else {
            parts.push(`Requested blueprintId "${options.blueprintId}" was not found; fall back to default 5-beat spine.`);
        }
    }

    const ids = (options.motionBlockIds || []).filter(Boolean).slice(0, 8);
    if (ids.length) {
        const lines = ids.map((id) => {
            const block = getMotionBlock(id);
            if (!block) return `- \`${id}\`: (unknown — skip)`;
            return `- \`${block.id}\` [${block.runtime ? 'RUNTIME __block' : 'recipe'}]: ${block.promptSnippet}`;
        });
        parts.push(`## USER-SELECTED MOTION BLOCKS (prioritize these)\n${lines.join('\n')}`);
    }

    return parts.join('\n\n');
}

export function formatCatalogSummaryForPrompt(style?: string): string {
    const count = listMotionBlocks().length;
    const bpCount = listBlueprints().length;
    return `Catalog available: ${count} motion blocks, ${bpCount} cinematic blueprints. Style focus: ${style || 'modern'}.`;
}
