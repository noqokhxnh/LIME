import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    getLLMClient,
    resetLLMClient,
    setLLMClient,
    OpenAIClient,
    DeepSeekClient,
    GeminiClient,
    ClaudeClient,
    type LLMClient,
} from '../../src/llm/client.js';
import {
    generateScript,
    stripMarkdownJson,
    buildUserPrompt,
} from '../../src/pipeline/scriptGenerator.js';
import { resetConfig, type Config } from '../../src/config.js';
import { type videoRequest } from '../../src/llm/schema.js';

class MockLLMClient implements LLMClient {
    public provider = 'mock-llm';
    public calls: { systemPrompt: string; userPrompt: string }[] = [];
    public responses: (string | Error)[] = [];

    constructor(responses: (string | Error)[] = [], provider = 'mock-llm') {
        this.responses = [...responses];
        this.provider = provider;
    }

    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
        this.calls.push({ systemPrompt, userPrompt });
        const next = this.responses.shift();
        if (next instanceof Error) {
            throw next;
        }
        if (typeof next === 'string') {
            return next;
        }
        throw new Error('No more mock responses available');
    }
}

describe('Module 3: LLM Client & Script Generation (src/llm/client.ts, src/pipeline/scriptGenerator.ts)', () => {
    const originalEnv = { ...process.env };

    const validScriptObj = {
        id: 'vid-test-01',
        title: 'Video AI Demo',
        description: 'Mô tả kịch bản mẫu cho video',
        globalStyles: 'body { margin: 0; background: #000; }',
        globalSetupJs: 'console.log("ready");',
        scenes: [
            {
                id: 'scene_1',
                title: 'Mở màn',
                voiceOverText: 'Chào mừng các bạn đến với công nghệ tương lai.',
                visualDescription: 'Chữ phát sáng giữa màn hình',
                htmlCode: '<div class="intro">Chào mừng</div>',
                cssCode: '.intro { color: white; }',
                jsCode: 'gsap.from(".intro", { opacity: 0, duration: 1 });',
                transition: 'fade',
                backgroundColor: '#000000',
            },
        ],
        colorPalette: {
            primary: '#3b82f6',
            secondary: '#1d4ed8',
            accent: '#f59e0b',
            background: '#0f172a',
            text: '#ffffff',
        },
        fontFamily: 'Inter',
    };

    const validVideoRequest: videoRequest = {
        prompt: 'Video giới thiệu trí tuệ nhân tạo thế hệ mới',
        aspectRatio: '16:9',
        targetDurationSec: 30,
        language: 'vi',
        style: 'modern',
        customStyle: 'Hiệu ứng ánh sáng neon xanh dương',
    };

    beforeEach(() => {
        resetConfig();
        resetLLMClient();
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (originalEnv[key] !== undefined) {
                process.env[key] = originalEnv[key];
            } else {
                delete process.env[key];
            }
        }
        resetConfig();
        resetLLMClient();
    });

    describe('TC-LLM-001: Khởi tạo Client theo cấu hình Provider', () => {
        it('phải khởi tạo OpenAIClient khi LLM_Provider là openai', () => {
            process.env.LLM_Provider = 'openai';
            process.env.OpenAI_APIKEY = 'test-openai-key';
            resetConfig();
            resetLLMClient();

            const client = getLLMClient();
            assert.strictEqual(client.provider, 'openai');
            assert.ok(client instanceof OpenAIClient);
        });

        it('phải khởi tạo DeepSeekClient khi LLM_Provider là deepseek', () => {
            process.env.LLM_Provider = 'deepseek';
            process.env.DeepSeek_APIKEY = 'test-deepseek-key';
            resetConfig();
            resetLLMClient();

            const client = getLLMClient();
            assert.strictEqual(client.provider, 'deepseek');
            assert.ok(client instanceof DeepSeekClient);
        });

        it('phải khởi tạo GeminiClient khi LLM_Provider là gemini', () => {
            process.env.LLM_Provider = 'gemini';
            process.env.Gemini_APIKEY = 'test-gemini-key';
            resetConfig();
            resetLLMClient();

            const client = getLLMClient();
            assert.strictEqual(client.provider, 'gemini');
            assert.ok(client instanceof GeminiClient);
        });

        it('phải khởi tạo ClaudeClient khi LLM_Provider là claude', () => {
            process.env.LLM_Provider = 'claude';
            process.env.Claude_APIKEY = 'test-claude-key';
            resetConfig();
            resetLLMClient();

            const client = getLLMClient();
            assert.strictEqual(client.provider, 'claude');
            assert.ok(client instanceof ClaudeClient);
        });
    });

    describe('TC-LLM-002: Bắt lỗi khi thiếu API Key của Provider được chọn', () => {
        const mockConfigBase: Config = {
            PORT: 3000,
            NODE_ENV: 'development',
            LLM_Provider: 'openai',
            OpenAI_Model: 'gpt-5.3-codex',
            DeepSeek_Model: 'deepseek-4-flash',
            Gemini_Model: 'gemini-3.5-flash',
            Claude_Model: 'claude sonnet 4.5',
            TTS_Provider: 'edge',
            TTS_Voice: 'alloy',
            Default_FPS: 30,
            Default_Width: 1920,
            Default_Height: 1080,
        };

        it('phải ném Error khi OpenAIClient thiếu OpenAI_APIKEY', () => {
            assert.throws(
                () => new OpenAIClient(mockConfigBase),
                (err: Error) => {
                    assert.match(err.message, /OpenAI API key is required/);
                    return true;
                }
            );
        });

        it('phải ném Error khi DeepSeekClient thiếu DeepSeek_APIKEY', () => {
            assert.throws(
                () => new DeepSeekClient(mockConfigBase),
                (err: Error) => {
                    assert.match(err.message, /DeepSeek API key is required/);
                    return true;
                }
            );
        });

        it('phải ném Error khi GeminiClient thiếu Gemini_APIKEY', () => {
            assert.throws(
                () => new GeminiClient(mockConfigBase),
                (err: Error) => {
                    assert.match(err.message, /Gemini API key is required/);
                    return true;
                }
            );
        });

        it('phải ném Error khi ClaudeClient thiếu Claude_APIKEY', () => {
            assert.throws(
                () => new ClaudeClient(mockConfigBase),
                (err: Error) => {
                    assert.match(err.message, /Claude API key is required/);
                    return true;
                }
            );
        });
    });

    describe('TC-LLM-003: Bóc tách khối mã Markdown Code Block từ phản hồi LLM', () => {
        it('phải bóc tách thành công chuỗi JSON được bọc trong ```json ... ```', () => {
            const raw = '```json\n{"id": "sc-1", "title": "Test"}\n```';
            const clean = stripMarkdownJson(raw);
            assert.strictEqual(clean, '{"id": "sc-1", "title": "Test"}');
            assert.doesNotThrow(() => JSON.parse(clean));
        });

        it('phải bóc tách thành công chuỗi JSON được bọc trong ``` ... ``` (không có chữ json)', () => {
            const raw = '```\n{"id": "sc-2"}\n```';
            const clean = stripMarkdownJson(raw);
            assert.strictEqual(clean, '{"id": "sc-2"}');
            assert.doesNotThrow(() => JSON.parse(clean));
        });

        it('phải giữ nguyên chuỗi JSON thuần nếu không có code block markdown', () => {
            const raw = '{"id": "sc-3", "value": 123}';
            const clean = stripMarkdownJson(raw);
            assert.strictEqual(clean, raw);
            assert.doesNotThrow(() => JSON.parse(clean));
        });

        it('phải xử lý tốt trường hợp có khoảng trắng thừa ở đầu hoặc cuối', () => {
            const raw = '   \n```json\n{"id": "sc-4"}\n```\n   ';
            const clean = stripMarkdownJson(raw);
            assert.strictEqual(clean, '{"id": "sc-4"}');
        });
    });

    describe('TC-LLM-004: Cơ chế Self-Correction Retry (Thử lại khi gặp lỗi với Error Log)', () => {
        it('phải gửi kèm thông tin lỗi lần trước ở lần thử thứ 2 và thành công', async () => {
            // Lần 1: JSON hợp lệ nhưng thiếu trường scenes (vi phạm Zod schema)
            const invalidJson = JSON.stringify({
                id: 'bad-script',
                title: 'Bad',
                description: 'Missing scenes',
                globalStyles: '',
                globalSetupJs: '',
                // thiếu scenes
                colorPalette: validScriptObj.colorPalette,
            });

            // Lần 2: JSON hợp lệ hoàn chỉnh
            const validJson = `\`\`\`json\n${JSON.stringify(validScriptObj)}\n\`\`\``;

            const mockClient = new MockLLMClient([invalidJson, validJson]);
            setLLMClient(mockClient);

            const progressLogs: string[] = [];
            const script = await generateScript(validVideoRequest, (msg) => {
                progressLogs.push(msg);
            });

            // Kiểm tra số lần gọi đến LLM
            assert.strictEqual(mockClient.calls.length, 2, 'Phải gọi LLM đúng 2 lần');

            // Kiểm tra prompt lần 1 không có log lỗi
            assert.doesNotMatch(mockClient.calls[0].userPrompt, /Lần trước bị lỗi/);

            // Kiểm tra prompt lần 2 có đính kèm hướng dẫn sửa lỗi
            assert.match(
                mockClient.calls[1].userPrompt,
                /Lần trước bị lỗi, hãy sửa lỗi sau:/,
                'Prompt lần 2 phải chứa log lỗi lần 1'
            );

            // Kiểm tra callback onProgress
            assert.ok(
                progressLogs.some((log) => log.includes('Attempt 1 failed')),
                'onProgress phải ghi nhận Attempt 1 thất bại'
            );
            assert.ok(
                progressLogs.some((log) => log.includes('Attempt 2/3 - success')),
                'onProgress phải ghi nhận Attempt 2 thành công'
            );

            // Kiểm tra kết quả trả về
            assert.strictEqual(script.id, 'vid-test-01');
            assert.strictEqual(script.scenes.length, 1);
        });
    });

    describe('TC-LLM-005: Xử lý lỗi khi cả 3 lần thử đều thất bại', () => {
        it('phải ném Error thông báo hết số lần thử sau 3 attempt thất bại', async () => {
            const malformedJson = '{ "broken_json": true, '; // Cú pháp JSON lỗi

            const mockClient = new MockLLMClient([
                malformedJson,
                malformedJson,
                malformedJson,
            ]);
            setLLMClient(mockClient);

            const progressLogs: string[] = [];

            await assert.rejects(
                async () => {
                    await generateScript(validVideoRequest, (msg) => {
                        progressLogs.push(msg);
                    });
                },
                (err: Error) => {
                    assert.match(
                        err.message,
                        /Failed to generate script after 3 attempts. Last error:/
                    );
                    return true;
                },
                'Phải ném ngoại lệ khi cả 3 lần đều fail'
            );

            assert.strictEqual(mockClient.calls.length, 3, 'Phải thực hiện đúng 3 lần retry');
            assert.ok(progressLogs.some((log) => log.includes('Attempt 3 failed')));
        });
    });

    describe('Kiểm tra hàm tạo User Prompt (buildUserPrompt)', () => {
        it('phải tạo prompt đầy đủ các thông số yêu cầu từ người dùng', () => {
            const prompt = buildUserPrompt(validVideoRequest, '1920x1080');

            assert.match(prompt, /Topic\/Prompt: Video giới thiệu trí tuệ nhân tạo thế hệ mới/);
            assert.match(prompt, /Aspect Ratio: 16:9 \(1920x1080\)/);
            assert.match(prompt, /Target Duration: 30 seconds/);
            assert.match(prompt, /Language: vi/);
            assert.match(prompt, /Style: modern/);
            assert.match(prompt, /Custom Style Instructions: Hiệu ứng ánh sáng neon xanh dương/);
        });
    });
});
