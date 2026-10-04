import type { MotionBlock } from '../types.js';

export const CORE_BLOCK_IDS = [
    'kinetic-type',
    'code-diff',
    'bar-chart',
    'device-showcase',
    'chat-exchange',
] as const;

export type CoreBlockId = (typeof CORE_BLOCK_IDS)[number];

export const coreBlocks: MotionBlock[] = [
    {
        id: 'kinetic-type',
        name: 'Kinetic Type Beats',
        description: 'Chữ giật nhấn theo từ, word-swap, typewriter có con trỏ.',
        category: 'kinetic-type',
        tags: ['typography', 'hook', 'title'],
        styleAffinity: ['modern', 'classic', 'minimal', 'any'],
        beatRole: 'hook',
        runtime: true,
        promptSnippet:
            'Mount with window.__block("kinetic-type", mountEl, { text, kicker, mode:"stagger-words"|"typewriter"|"word-swap", words?, accent }). Animate via window.__block.animate("kinetic-type", root, tl, { at, duration }).',
        paramsHint: '{ text, kicker?, mode?, words?, accent? }',
    },
    {
        id: 'code-diff',
        name: 'Code Diff / Terminal',
        description: 'IDE macOS chrome với dòng add/del và syntax highlight.',
        category: 'code',
        tags: ['developer', 'ide', 'diff'],
        styleAffinity: ['modern', 'minimal', 'any'],
        beatRole: 'insight',
        runtime: true,
        promptSnippet:
            'Mount with window.__block("code-diff", mountEl, { title, lines:[{text, kind:"add"|"del"|"code"|"comment"}] }). Animate with __block.animate("code-diff", root, tl).',
        paramsHint: '{ title?, lines:[{text, kind}] }',
    },
    {
        id: 'bar-chart',
        name: 'Bar Chart / Count-up',
        description: 'Biểu đồ cột + số nhảy theo thời lượng scene.',
        category: 'dataviz',
        tags: ['chart', 'metrics', 'proof'],
        styleAffinity: ['modern', 'classic', 'minimal', 'any'],
        beatRole: 'proof',
        runtime: true,
        promptSnippet:
            'Mount with window.__block("bar-chart", mountEl, { title, items:[{label,value}], max?, accent?, suffix? }). Animate with __block.animate("bar-chart", root, tl, { duration, suffix:"%" }).',
        paramsHint: '{ title?, items:[{label,value}], max?, accent?, suffix? }',
    },
    {
        id: 'device-showcase',
        name: 'Device Surface Showcase',
        description: 'Mockup phone/laptop 3D nghiêng hiển thị UI demo.',
        category: 'device',
        tags: ['product', 'mockup', '3d'],
        styleAffinity: ['modern', 'minimal', 'any'],
        beatRole: 'insight',
        runtime: true,
        promptSnippet:
            'Mount with window.__block("device-showcase", mountEl, { device:"phone"|"laptop", headline, sub, screenHtml? }). Animate with __block.animate("device-showcase", root, tl).',
        paramsHint: '{ device?, headline?, sub?, screenHtml? }',
    },
    {
        id: 'chat-exchange',
        name: 'Chat Exchange',
        description: 'Hội thoại bubble user/assistant xuất hiện lần lượt.',
        category: 'social',
        tags: ['chat', 'ai', 'conversation'],
        styleAffinity: ['modern', 'stickman', 'any'],
        beatRole: 'problem',
        runtime: true,
        promptSnippet:
            'Mount with window.__block("chat-exchange", mountEl, { messages:[{role:"user"|"assistant", text}] }). Animate with __block.animate("chat-exchange", root, tl).',
        paramsHint: '{ messages:[{role,text}] }',
    },
];
