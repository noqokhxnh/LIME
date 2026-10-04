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
 * Allocate approximate scene counts across the 5 beats for a target duration.
 */
export function allocateBeats(targetDurationSec: number, sceneCountHint?: number): string[] {
    const scenes = sceneCountHint ?? Math.max(5, Math.min(8, Math.round(targetDurationSec / 4)));
    // Ensure at least one scene per beat when possible
    if (scenes <= 5) {
        return STORY_BEATS.map((b) => b.id);
    }
    const plan: string[] = ['hook', 'problem', 'insight', 'proof', 'cta'];
    let remaining = scenes - 5;
    const expandOrder = ['insight', 'proof', 'problem', 'hook'];
    let i = 0;
    while (remaining > 0) {
        plan.splice(plan.indexOf(expandOrder[i % expandOrder.length]) + 1, 0, expandOrder[i % expandOrder.length]);
        remaining--;
        i++;
    }
    return plan;
}

export function formatStorySpinePrompt(targetDurationSec: number): string {
    const plan = allocateBeats(targetDurationSec);
    const beatLines = STORY_BEATS.map(
        (b, idx) =>
            `${idx + 1}. **${b.name}** (${b.timeHint}): ${b.goal}\n   Suggested blocks: ${b.suggestedBlockTypes.join(', ')}`
    ).join('\n');

    return `## CINEMATIC STORY SPINE (5 Beats — MANDATORY STRUCTURE)
Distribute ~${targetDurationSec}s across these narrative beats. Suggested scene beat order: ${plan.join(' → ')}.
Map each scene's visualDescription to exactly one beat role.

${beatLines}

Rules:
- Scene 1 MUST be a Hook (kinetic/impact), not a soft intro paragraph.
- Final scene MUST land a CTA / brand beat.
- Prefer runtime helpers window.__block(...) for complex UI instead of hand-rolling DOM.`;
}
