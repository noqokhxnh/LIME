import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    formatStyleSpecForPrompt,
    getStyleMotionSpec,
} from '../../src/templates/styles/index.js';
import {
    formatStyleMotionPrompt,
    mapCameraLabel,
    parseStyleMotionSpec,
} from '../../src/templates/styles/motionGrammar.js';
import { validateCameraGrammar, validateScript } from '../../src/pipeline/scriptValidator.js';
import type { videoScript } from '../../src/llm/schema.js';

const ALL_MOVES = [
    'locked',
    'push-in',
    'pull-back',
    'pan-left',
    'pan-right',
    'tilt-up',
    'tilt-down',
];

function makeScript(
    moves: Array<string | undefined>,
    styleSlug?: string
): videoScript {
    return {
        id: 'grammar-fixture',
        title: 'Grammar fixture',
        description: '',
        globalStyles: '',
        globalSetupJs: '',
        scenes: moves.map((move, i) => ({
            id: `scene_${i + 1}`,
            title: `Scene ${i + 1}`,
            voiceOverText: 'Một câu thoại ngắn.',
            visualDescription: '',
            htmlCode: `<div id="scene_${i + 1}"></div>`,
            cssCode: '',
            jsCode: '',
            transition: 'none',
            backgroundColor: '#000',
            duration: i === 0 ? 2 : 8,
            nearStill: i === 1 ? { from: 1, to: 3 } : undefined,
            camera: move ? { move, intensity: 0.5 } : undefined,
        })),
        boundaries: moves.slice(1).map((_, i) => ({
            id: `b${i + 1}`,
            fromScene: `scene_${i + 1}`,
            toScene: `scene_${i + 2}`,
            carry: { element: 'div', mechanism: 'morph' as const },
        })),
        colorPalette: {
            primary: '#000',
            secondary: '#111',
            accent: '#222',
            background: '#333',
            text: '#fff',
        },
        fontFamily: 'Inter',
        styleSlug,
    } as unknown as videoScript;
}

describe('motion grammar parser (#123)', () => {
    it('midcentury-toon: parse được camera, motion quality và native moves', () => {
        const spec = getStyleMotionSpec('midcentury-toon');
        assert.equal(spec.camera.source, 'preset');
        assert.deepEqual(spec.camera.allowed, ALL_MOVES);
        assert.ok(spec.camera.moves.length >= 10);
        assert.equal(spec.nativeMoves.length, 5);
        assert.deepEqual(spec.motionQuality.fps, [12, 24]);
        assert.ok(spec.motionQuality.rules.length >= 4);
        // Bảng có move pipeline không thi hành được → core rỗng nhưng vẫn giữ label.
        assert.ok(spec.camera.moves.some((m) => m.core.length === 0));
        // Đoạn prose dưới bảng phải thành framing rule.
        assert.match(spec.camera.framing ?? '', /1\/3 frame height/);
        assert.match(spec.camera.transitions ?? '', /no dissolves/i);
    });

    it('urban-sketch: framing/transitions tách đúng từ đoạn prose', () => {
        const spec = getStyleMotionSpec('urban-sketch');
        assert.equal(spec.camera.source, 'preset');
        assert.deepEqual(spec.camera.allowed, ALL_MOVES);
        assert.match(spec.camera.framing ?? '', /subjects/i);
        assert.match(spec.camera.transitions ?? '', /no dissolves/i);
        assert.ok(spec.nativeMoves.some((m) => m.title.toLowerCase().includes('line before colour')));
        // "Fits content like:" phải được tách thành danh sách use-case.
        assert.ok(spec.nativeMoves.every((m) => m.fits.length > 0));
    });

    it('scifi-toon: grammar hẹp — không cho pull-back hay tilt', () => {
        const spec = getStyleMotionSpec('scifi-toon');
        assert.equal(spec.camera.source, 'preset');
        assert.ok(spec.camera.allowed.includes('push-in'));
        assert.ok(spec.camera.allowed.includes('pan-left'));
        assert.ok(spec.camera.allowed.includes('locked'));
        assert.equal(spec.camera.allowed.includes('pull-back'), false);
        assert.equal(spec.camera.allowed.includes('tilt-up'), false);
        assert.equal(spec.camera.allowed.includes('tilt-down'), false);
    });

    it('brick-toy: không map được push-in từ bảng/prose', () => {
        const spec = getStyleMotionSpec('brick-toy');
        assert.equal(spec.camera.source, 'preset');
        assert.equal(spec.camera.allowed.includes('push-in'), false);
        assert.ok(spec.camera.allowed.includes('pull-back'));
        assert.ok(spec.camera.allowed.includes('locked'));
    });

    it('preset thiếu §6 → fallback vocabulary lõi, không crash', () => {
        const spec = parseStyleMotionSpec(
            '# Test\n\n## 5. Motion quality\n\n- 12 fps.\n\n## 7. Sound palette\n\n- none.\n'
        );
        assert.equal(spec.camera.source, 'fallback');
        assert.deepEqual(spec.camera.allowed, ALL_MOVES);
    });

    it('bảng không map được move nào → fallback thay vì chặn oan', () => {
        const spec = parseStyleMotionSpec(
            [
                '## 6. Camera grammar',
                '',
                '| Move | What it expresses | Can serve |',
                '|---|---|---|',
                '| Iris through a medallion | the number is the door | a step change |',
                '| Round call-out | context and detail | a hand action |',
                '',
                '## 7. Sound palette',
            ].join('\n')
        );
        assert.equal(spec.camera.source, 'fallback');
        assert.deepEqual(spec.camera.allowed, ALL_MOVES);
        assert.equal(spec.camera.moves.length, 2);
    });

    it('mapCameraLabel hiểu hướng và không nhầm pull-out thành pan', () => {
        assert.deepEqual(mapCameraLabel('Pan left across the room'), ['pan-left']);
        assert.deepEqual(mapCameraLabel('Pan right'), ['pan-right']);
        assert.deepEqual(mapCameraLabel('Crane up'), ['tilt-up']);
        assert.deepEqual(mapCameraLabel('Tilt down the shafts'), ['tilt-down']);
        assert.deepEqual(mapCameraLabel('Whip pull-out in one beat'), ['pull-back']);
        assert.deepEqual(mapCameraLabel('Locked frontal wide'), ['locked']);
        assert.deepEqual(mapCameraLabel('Push into a single glyph'), ['push-in']);
        assert.deepEqual(mapCameraLabel('Turntable (azimuth sweep)'), ['pan-left', 'pan-right']);
    });
});

describe('formatStyleMotionPrompt (#123)', () => {
    it('nêu rõ allow-list và bảng map move của preset', () => {
        const block = formatStyleMotionPrompt(getStyleMotionSpec('scifi-toon'), 'scifi-toon');
        assert.match(block, /STYLE MOTION GRAMMAR \(enforced — scifi-toon\)/);
        assert.match(block, /Allowed scene\.camera\.move: locked, push-in, pan-left, pan-right\./);
        assert.match(block, /Very slow push-in on a still two-shot → push-in/);
        assert.match(block, /Native moves for this preset:/);
    });

    it('formatStyleSpecForPrompt chèn khối grammar sau nội dung preset', () => {
        const prompt = formatStyleSpecForPrompt('midcentury-toon');
        assert.match(prompt, /OPUSCAR VISUAL STYLE LAYER/);
        assert.match(prompt, /STYLE MOTION GRAMMAR \(enforced — midcentury-toon\)/);
        assert.match(prompt, /Every scene\.camera\.move MUST be in the allowed list/);
    });
});

describe('validateScript — camera grammar (#123)', () => {
    it('move ngoài grammar của preset bị từ chối kèm danh sách hợp lệ', () => {
        const result = validateScript(makeScript(['pull-back', 'push-in']), {
            styleSlug: 'scifi-toon',
        });
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /scenes\.0\.camera\.move/);
        assert.match(result.errors[0], /'pull-back' không thuộc grammar của preset 'scifi-toon'/);
        assert.match(result.errors[0], /Move hợp lệ: locked, push-in, pan-left, pan-right/);
    });

    it('move trong grammar thì pass', () => {
        const result = validateScript(makeScript(['push-in', 'pan-left']), {
            styleSlug: 'scifi-toon',
        });
        assert.equal(result.valid, true);
        assert.equal(result.errors.length, 0);
    });

    it('báo đủ mọi scene vi phạm', () => {
        const result = validateScript(makeScript(['pull-back', 'tilt-up']), {
            styleSlug: 'scifi-toon',
        });
        assert.equal(result.valid, false);
        assert.equal(result.errors.length, 2);
    });

    it('không truyền styleSlug → bỏ qua grammar (tương thích cũ)', () => {
        const result = validateScript(makeScript(['pull-back', 'tilt-up']));
        assert.equal(result.valid, true);
    });

    it('styleSlug không tồn tại → fallback, không chặn', () => {
        const result = validateScript(makeScript(['pull-back', 'tilt-up']), {
            styleSlug: 'khong-ton-tai',
        });
        assert.equal(result.valid, true);
    });

    it('scene không khai camera → mặc định locked, luôn hợp lệ', () => {
        const script = makeScript([undefined, undefined]);
        assert.deepEqual(validateCameraGrammar(script, 'scifi-toon'), []);
        assert.equal(validateScript(script, { styleSlug: 'scifi-toon' }).valid, true);
    });

    it('preset có grammar đầy đủ cho phép cả 7 move', () => {
        for (const move of ALL_MOVES) {
            const result = validateScript(makeScript([move, 'locked']), {
                styleSlug: 'midcentury-toon',
            });
            assert.equal(result.valid, true, `move ${move} phải hợp lệ với midcentury-toon`);
        }
    });
});
