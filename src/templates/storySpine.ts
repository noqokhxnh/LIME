export interface StoryBeat {
    id: 'hook' | 'problem' | 'insight' | 'proof' | 'cta';
    name: string;
    timeHint: string;
    goal: string;
    suggestedBlockTypes: string[];
}

export const STORY_BEATS: StoryBeat[] = [
    {
        id: 'hook',
        name: 'Hook',
        timeHint: '0–3s (or first scene)',
        goal: 'Immediate attention: kinetic type, shocking number, or paradoxical question. No long explanation.',
        suggestedBlockTypes: ['kinetic-type', 'counter-hero', 'glitch-title', 'zoom-punch'],
    },
    {
        id: 'problem',
        name: 'Problem / Conflict',
        timeHint: 'early-middle',
        goal: 'Show the pain / friction visually (chat frustration, X-mark, comparison of bad status quo).',
        suggestedBlockTypes: ['chat-exchange', 'problem-x-mark', 'comparison-split', 'notification-cascade'],
    },
    {
        id: 'insight',
        name: 'Core Insight / Solution',
        timeHint: 'middle',
        goal: 'Reveal the key idea, product, or method (code-diff, device UI, flowchart).',
        suggestedBlockTypes: ['code-diff', 'device-showcase', 'flowchart-vertical', 'solution-check'],
    },
    {
        id: 'proof',
        name: 'Proof / Data',
        timeHint: 'late-middle',
        goal: 'Evidence via charts, metrics, timeline, or social proof — not more narration paragraphs on screen.',
        suggestedBlockTypes: ['bar-chart', 'metric-ribbon', 'line-graph', 'data-callout'],
    },
    {
        id: 'cta',
        name: 'Action / CTA',
        timeHint: 'final scene',
        goal: 'Clear call-to-action + brand lockup. Short on-screen CTA ≤ 5 words.',
        suggestedBlockTypes: ['cta-banner', 'logo-outro', 'brand-lockup', 'price-tag-pop'],
    },
];

/**
 * Priority-compressed spines when scene budget is below 5 beats.
 * Always keep Hook first and CTA last when more than one scene.
 */
const COMPRESSED_SPINES: Record<number, string[]> = {
    1: ['hook'],
    2: ['hook', 'cta'],
    3: ['hook', 'insight', 'cta'],
    4: ['hook', 'problem', 'insight', 'cta'],
};

/**
 * Allocate narrative beats for a target duration / scene budget.
 * Does NOT force 5 scenes for short videos — compresses the spine instead.
 */
export function allocateBeats(targetDurationSec: number, sceneCountHint?: number): string[] {
    const estimated = Math.max(1, Math.min(8, Math.round(targetDurationSec / 4) || 1));
    const scenes = Math.max(1, Math.floor(sceneCountHint ?? estimated));

    if (scenes < 5) {
        return COMPRESSED_SPINES[scenes] || COMPRESSED_SPINES[1];
    }

    const plan: string[] = ['hook', 'problem', 'insight', 'proof', 'cta'];
    let remaining = scenes - 5;
    const expandOrder = ['insight', 'proof', 'problem', 'hook'];
    let i = 0;
    while (remaining > 0) {
        const beat = expandOrder[i % expandOrder.length];
        plan.splice(plan.lastIndexOf(beat) + 1, 0, beat);
        remaining--;
        i++;
    }
    return plan;
}

export function formatStorySpinePrompt(targetDurationSec: number, sceneCountHint?: number): string {
    const plan = allocateBeats(targetDurationSec, sceneCountHint);
    const beatLines = STORY_BEATS.map(
        (b, idx) =>
            `${idx + 1}. **${b.name}** (${b.timeHint}): ${b.goal}\n   Suggested blocks: ${b.suggestedBlockTypes.join(', ')}`
    ).join('\n');

    return `## CINEMATIC STORY SPINE (adapt to scene count)
Full 5-beat vocabulary (use what fits the budget):
${beatLines}

For ~${targetDurationSec}s, prefer about ${plan.length} scene(s) in this beat order: ${plan.join(' → ')}.
Map each scene's visualDescription to exactly one beat role from the plan above.
If the video is short (2–4 scenes), compress — do NOT invent filler scenes just to hit all 5 beats.

Rules:
- Scene 1 MUST be a Hook (kinetic/impact), not a soft intro paragraph.
- Final scene MUST land a CTA / brand beat (unless the video is a single Hook-only scene).
- Prefer runtime helpers window.__block(...) for complex UI instead of hand-rolling DOM.`;
}
