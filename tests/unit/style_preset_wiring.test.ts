/**
 * Test wiring (issue #105): 51 style preset opuscar (#104) phải được pipeline SINH SCRIPT
 * sử dụng thật sự — không chỉ nằm chết trong thư viện:
 *   1. Menu metadata (slug/category/use-case) đủ 51 slug để AI tự chọn theo brief.
 *   2. formatStyleSpecForPrompt(slug) đóng gói nguyên văn STYLE.md đã chọn để inject
 *      vào user prompt (trả rỗng an toàn khi slug không hợp lệ).
 *   3. pickStyleSlug() — lượt gọi LLM rẻ tiền tự chọn slug, chịu được nhiễu phản hồi
 *      (quotes, dấu chấm, câu đầy đủ) và không bao giờ throw (nếu lỗi → null).
 *   4. Chain E2E generateScript với LLM giả: prompt THỰC SỰ gửi cho LLM phải chứa
 *      style layer của slug, và script đầu ra được đóng dấu styleSlug để trace/HITL.
 *
 * Chạy được offline (LLM bằng stub qua setLLMClient), không gọi mạng thật.
 */
import { describe, it, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    listStyles,
    formatStyleMenuForPrompt,
    formatStyleSpecForPrompt,
} from '../../src/templates/styles/index.js';
import {
    pickStyleSlug,
    buildUserPrompt,
    generateScript,
} from '../../src/pipeline/scriptGenerator.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import type { videoRequest } from '../../src/llm/schema.js';

after(() => {
    mock.restoreAll();
    resetLLMClient();
});

describe('Opuscar style wiring (#105) — menu & spec formatter', () => {
    it('formatStyleMenuForPrompt liệt kê đủ 51 slug kèm category và use-case', () => {
        const menu = formatStyleMenuForPrompt();
        const lines = menu.split('\n').filter((l) => l.startsWith('- '));
        assert.equal(lines.length, 51, 'Menu phải có đúng 51 dòng preset');

        for (const style of listStyles()) {
            assert.ok(menu.includes(`- ${style.slug} —`), `Menu phải chứa slug ${style.slug}`);
            assert.ok(menu.includes(`(${style.category_en})`), `${style.slug} phải ghi kèm category`);
            assert.ok(menu.includes(style.uses[0]), `${style.slug} phải ghi kèm use-case`);
        }
    });

    it('formatStyleSpecForPrompt nhận slug hợp lệ → trả spec chứa nguyên văn STYLE.md', () => {
        const spec = formatStyleSpecForPrompt('dark-keynote');
        assert.ok(spec.startsWith('--- OPUSCAR VISUAL STYLE LAYER (slug: dark-keynote'), 'Phải mở đầu bằng header section');
        assert.match(spec, /^#\s+/m, 'Phải chứa nguyên văn (heading markdown của) STYLE.md');
        assert.ok(spec.includes('DOMINANT visual veneer'), 'Phải kèm NOTE áp dụng lớp veneer thống trị');
        const innerContent = spec.replace(/--- OPUSCAR VISUAL STYLE LAYER.*?---/, '').replace(/NOTE: You MUST[\s\S]*$/, '');
        assert.ok(innerContent.trim().length > 500, 'Nội dung STYLE.md chèn vào phải đầy đủ (>500 ký tự)');
    });

    it('formatStyleSpecForPrompt nhận slug không hợp lệ → trả chuỗi rỗng (không throw)', () => {
        assert.equal(formatStyleSpecForPrompt('no-such-slug'), '');
        assert.equal(formatStyleSpecForPrompt(''), '');
        assert.equal(formatStyleSpecForPrompt(undefined as unknown as string), '');
    });
});

describe('Opuscar style wiring (#105) — pickStyleSlug (AI tự chọn)', () => {
    const brief = 'Video giới thiệu app fintech: ngân hàng số, tài khoản miễn phí, biểu đồ chi tiêu thông minh.';

    function fakeLLM(reply: string): LLMClient {
        return {
            provider: 'mock',
            generate: async () => reply,
        };
    }

    it('Phản hồi sạch chỉ gồm slug → trả đúng slug', async () => {
        assert.equal(await pickStyleSlug(brief, fakeLLM('dark-keynote')), 'dark-keynote');
    });

    it('Chịu được nhiễu: quotes, dấu chấm, tiền tố kiểu "slug: ..."', async () => {
        assert.equal(await pickStyleSlug(brief, fakeLLM('"dark-keynote".')), 'dark-keynote');
        assert.equal(await pickStyleSlug(brief, fakeLLM('slug: dataviz — đây là lựa chọn tốt nhất')), 'dataviz');
    });

    it('Slug bịa ra không tồn tại trong thư viện → null, không đoán mò', async () => {
        assert.equal(await pickStyleSlug(brief, fakeLLM('totally-made-up-slug')), null);
        assert.equal(await pickStyleSlug(brief, fakeLLM('')), null);
    });

    it('Phản hồi đầy câu nhưng chứa slug hợp lệ → vẫn dò ra được', async () => {
        assert.equal(
            await pickStyleSlug(brief, fakeLLM('Tôi chọn hologram-hud vì fintech hợp phong cách HUD.')),
            'hologram-hud'
        );
    });

    it('LLM ném lỗi mạng → null, tuyệt đối không throw làm hỏng pipeline', async () => {
        const broken: LLMClient = {
            provider: 'mock',
            generate: async () => {
                throw new Error('network down');
            },
        };
        assert.equal(await pickStyleSlug(brief, broken), null);
    });
});

describe('Opuscar style wiring (#105) — buildUserPrompt inject STYLE.md', () => {
    const fintechRequest: videoRequest = {
        prompt: 'Video giới thiệu app fintech: ngân hàng số, tài khoản miễn phí, chi tiêu thông minh.',
        style: 'modern',
        styleSlug: 'dark-keynote',
        targetDurationSec: 30,
        language: 'vi',
    };

    it('User ghim styleSlug → prompt gửi LLM chứa header + nội dung STYLE.md của slug', () => {
        const prompt = buildUserPrompt(fintechRequest, '1920x1080');
        assert.match(prompt, /--- OPUSCAR VISUAL STYLE LAYER \(slug: dark-keynote/);
        assert.match(prompt, /DOMINANT visual veneer/);
    });

    it('Không có styleSlug → prompt giữ nguyên như cũ (không có opuscar layer)', () => {
        const { styleSlug: _omit, ...withoutSlug } = fintechRequest;
        const prompt = buildUserPrompt(withoutSlug as videoRequest, '1920x1080');
        assert.doesNotMatch(prompt, /OPUSCAR VISUAL STYLE LAYER/);
    });
});

describe('Opuscar style wiring (#105) — generateScript E2E (LLM giả)', () => {
    const fintechPrompt = 'Video giới thiệu app fintech: ngân hàng số, tài khoản miễn phí, chi tiêu thông minh.';

    const minimalScript = {
        id: 's1',
        title: 'Kịch bản fintech',
        description: 'Giới thiệu app ngân hàng số',
        globalStyles: 'body { margin: 0; font-family: Inter; }',
        globalSetupJs: '',
        scenes: [
            {
                id: 'sc1',
                title: 'Mở đầu',
                voiceOverText:
                    'Ngân hàng số giúp bạn mở tài khoản miễn phí chỉ trong một phút. Đăng ký ngay hôm nay và quản lý chi tiêu thông minh.',
                visualDescription: 'Bìa tối giản tông tối với logo app',
                htmlCode: '<div class="slide"><h1>Fintech App</h1></div>',
                cssCode: '.slide { width: 100%; height: 100%; }',
                jsCode: '',
                transition: 'fade',
                backgroundColor: '#000000',
            },
        ],
        boundaries: [],
        colorPalette: {
            primary: '#111111',
            secondary: '#222222',
            accent: '#333333',
            background: '#0b0f19',
            text: '#f8fafc',
        },
        fontFamily: 'Inter',
    };

    it('Brief fintech + LLM giả pick "dark-keynote" → prompt gửi LLM chứa style layer, script được đóng dấu styleSlug', async () => {
        const capturedPrompts: string[] = [];
        let callIndex = 0;
        const fake: LLMClient = {
            provider: 'mock',
            generate: async (systemPrompt: string, userPrompt: string) => {
                callIndex += 1;
                if (callIndex === 1) {
                    // Lượt 1 = pickStyleSlug: chốt slug
                    return 'dark-keynote';
                }
                // Lượt 2 = sinh kịch bản: ghi lại prompt THỰC SỰ gửi cho LLM
                capturedPrompts.push(userPrompt);
                return JSON.stringify(minimalScript);
            },
        };
        setLLMClient(fake);

        const script = await generateScript({
            prompt: fintechPrompt,
            style: 'modern',
            targetDurationSec: 30,
            language: 'vi',
        } as videoRequest);

        assert.equal(script.styleSlug, 'dark-keynote', 'Script phải được đóng dấu slug nổi bật');
        assert.equal(capturedPrompts.length, 1);
        assert.match(capturedPrompts[0], /OPUSCAR VISUAL STYLE LAYER \(slug: dark-keynote/);
        assert.match(capturedPrompts[0], /DOMINANT visual veneer/);
    });

    it('User ghim sẵn styleSlug → KHÔNG gọi lượt pick, prompt dùng đúng slug user chọn', async () => {
        let generateCallCount = 0;
        const fake: LLMClient = {
            provider: 'mock',
            generate: async (_systemPrompt: string, userPrompt: string) => {
                generateCallCount += 1;
                return JSON.stringify(minimalScript);
            },
        };
        setLLMClient(fake);

        const script = await generateScript({
            prompt: fintechPrompt,
            style: 'modern',
            styleSlug: 'woodcut',
            targetDurationSec: 30,
            language: 'vi',
        } as videoRequest);

        assert.equal(script.styleSlug, 'woodcut', 'Phải tôn trọng slug user ghim dù AI có thể chọn slug khác');
        assert.equal(generateCallCount, 1, 'Chỉ 1 lượt gọi LLM (sinh script), KHÔNG gọi lượt pick');
    });
});
