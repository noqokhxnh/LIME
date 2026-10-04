export type BeatRole = 'hook' | 'problem' | 'insight' | 'proof' | 'cta' | 'any';

export type BlockCategory =
    | 'kinetic-type'
    | 'code'
    | 'dataviz'
    | 'device'
    | 'social'
    | 'transition'
    | 'lower-third'
    | 'ui'
    | 'cinematic'
    | 'explainer';

export type StyleAffinity = 'modern' | 'classic' | 'stickman' | 'minimal' | 'any';

export interface MotionBlock {
    id: string;
    name: string;
    description: string;
    category: BlockCategory;
    tags: string[];
    styleAffinity: StyleAffinity[];
    beatRole: BeatRole;
    /** true = implemented by window.__block(id, ...) */
    runtime: boolean;
    promptSnippet: string;
    paramsHint?: string;
}

export interface CinematicBlueprint {
    id: string;
    name: string;
    description: string;
    styleAffinity: StyleAffinity[];
    /** Suggested block ids per beat in order */
    suggestedBlocks: string[];
    beatPlan: string[];
    promptSnippet: string;
}

export interface CatalogResponse {
    blocks: MotionBlock[];
    blueprints: CinematicBlueprint[];
    coreBlockIds: string[];
}
