import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import { autoDirectScript } from '../../src/queue/handler.js';
import type { JobData } from '../../src/queue/interfaces.js';

const WORDS_BY_BRIEF: Record<string, number> = {
    'BIÊN TẬP': 10,
    'DỮ LIỆU': 55,
    'TRUYỆN TRANH': 30,
    'TỐI GIẢN': 8,
};

class AutoDirectLLM implements LLMClient {
    readonly provider = 'mock-llm';
    public generated: Array<{ brief: string; words: number }> = [];
    public classifyCalls = 0;

    async generate(_system: string, user: string): Promise<string> {
        if (user.includes('Chọn đúng một đáp án cho mỗi chiều')) {
            this.classifyCalls++;
            return JSON.stringify({
                audience: { value: 'general', confidence: 0.6 },
                purpose: { value: 'persuade', confidence: 0.9 },
                structure: { value: 'lenses', confidence: 0.6 },
            });
        }

        const brief = Object.keys(WORDS_BY_BRIEF).find(key => user.includes(key)) ?? 'DỮ LIỆU';
        const words = WORDS_BY_BRIEF[brief];
        this.generated.push({ brief, words });
        // Từ thuần chữ, không chèn số: bộ ước lượng cộng thêm thời gian cho chữ số
        // nên "tu12" sẽ bị tính thành nhiều từ hơn thực tế.
        const text = Array.from({ length: words }, () => 'hà').join(' ');

        return JSON.stringify({
            id: `script-${brief}`,
            title: brief,
            description: '',
            globalStyles: '',
            globalSetupJs: '',
            scenes: [{
                id: 'scene-1',
                title: 'Scene 1',
                voiceOverText: text,
                visualDescription: '',
                htmlCode: '<div></div>',
                cssCode: '',
                jsCode: '',
                transition: 'fade',
                backgroundColor: '#000000',
            }],
            boundaries: [],
            colorPalette: {
                primary: `#${brief.length}00000`,
                secondary: '#111111',
                accent: '#222222',
                background: '#333333',
                text: '#ffffff',
            },
            fontFamily: 'Inter',
        });
    }
}

function jobData(overrides: Partial<JobData> = {}): JobData {
    return {
        jobId: 'auto-1',
        request: {
            prompt: 'Giới thiệu Hà Nội trong 3 cảnh: Hồ Gươm, phố cổ, ẩm thực',
            aspectRatio: '16:9',
            targetDurationSec: 20,
            language: 'vi',
            style: 'modern',
        } as any,
        outputDir: '/tmp/opencode/auto-direct-test',
        autoDirect: true,
        ...overrides,
    };
}

describe('Module HITL: chế độ Để AI quyết hết', () => {
    let llm: AutoDirectLLM;

    before(() => {
        llm = new AutoDirectLLM();
        setLLMClient(llm);
    });

    after(() => resetLLMClient());

    it('tự chọn phương án gần thời lượng mục tiêu nhất', async () => {
        const messages: string[] = [];
        const script = await autoDirectScript(jobData(), async (progress) => {
            messages.push(progress.message);
        });

        assert.ok(llm.generated.length >= 2);
        // 55 từ là phương án gần mốc 20s nhất trong bộ mock.
        const expectedWords = Math.min(...llm.generated.map(g => Math.abs(g.words - 55)));
        const chosen = llm.generated.find(g => Math.abs(g.words - 55) === expectedWords);
        assert.ok(chosen);
        assert.equal(script.scenes[0].voiceOverText.split(' ').length, chosen.words);

        assert.ok(messages.some(m => m.includes('AI chọn phương án')));
        assert.ok(messages.some(m => m.includes('viết 3 phương án')));
    });

    it('dùng answers có sẵn thì không gọi LLM phân loại', async () => {
        const before = llm.classifyCalls;
        await autoDirectScript(
            jobData({ autoAnswers: { audience: 'dev', purpose: 'explain', structure: 'single' } }),
            async () => { }
        );
        assert.equal(llm.classifyCalls, before);
    });

    it('báo lỗi rõ ràng khi cả ba phương án đều thất bại', async () => {
        setLLMClient({
            provider: 'broken',
            generate: async (_s: string, user: string) => {
                if (user.includes('Chọn đúng một đáp án')) {
                    return JSON.stringify({
                        audience: { value: 'general', confidence: 0.9 },
                        purpose: { value: 'explain', confidence: 0.9 },
                        structure: { value: 'single', confidence: 0.9 },
                    });
                }
                throw new Error('LLM down');
            },
        } as LLMClient);

        await assert.rejects(
            () => autoDirectScript(jobData(), async () => { }),
            /Không tạo được phương án nào/
        );

        setLLMClient(llm);
    });
});
