import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, resetConfig, videoPreset, envSchema } from '../../src/config.js';

describe('Module 1: Config & Environment (src/config.ts)', () => {
    const originalEnv = { ...process.env };
    const CONFIG_ENV_KEYS = [
        'PORT',
        'NODE_ENV',
        'LLM_Provider',
        'LLM_PROVIDER',
        'NINEROUTER_BASE_URL',
        'NINEROUTER_API_KEY',
        'NINEROUTER_MODEL',
        'NineRouter_BaseURL',
        'NineRouter_APIKEY',
        'NineRouter_Model',
        'OpenAI_APIKEY',
        'OpenAI_Model',
        'DeepSeek_APIKEY',
        'DeepSeek_Model',
        'Gemini_APIKEY',
        'Gemini_Model',
        'Claude_APIKEY',
        'Claude_Model',
        'TTS_Provider',
        'TTS_Voice',
        'Elevenlabs_API_KEY',
        'Elevenlabs_Voice_ID',
        'OpenAI_TTS_Model',
        'Google_TTS_Model',
        'Google_TTS_APIKEY',
        'Default_FPS',
        'Default_Width',
        'Default_Height',
    ];

    function cleanConfigEnv(): void {
        for (const key of CONFIG_ENV_KEYS) {
            delete process.env[key];
        }
    }

    beforeEach(() => {
        resetConfig();
    });

    afterEach(() => {
        for (const key of CONFIG_ENV_KEYS) {
            if (originalEnv[key] !== undefined) {
                process.env[key] = originalEnv[key];
            } else {
                delete process.env[key];
            }
        }
        resetConfig();
    });

    describe('TC-CFG-001: Nạp cấu hình mặc định khi không có biến môi trường', () => {
        it('phải gán các giá trị mặc định chuẩn xác khi process.env trống', () => {
            cleanConfigEnv();
            resetConfig();

            const config = getConfig();

            assert.strictEqual(config.PORT, 3000, 'PORT mặc định phải là 3000');
            assert.strictEqual(config.NODE_ENV, 'development', 'NODE_ENV mặc định phải là development');
            assert.strictEqual(config.LLM_Provider, 'gemini', 'LLM_Provider mặc định phải là gemini');
            assert.strictEqual(config.TTS_Provider, 'edge', 'TTS_Provider mặc định phải là edge');
            assert.strictEqual(config.TTS_Voice, 'alloy', 'TTS_Voice mặc định phải là alloy');
            assert.strictEqual(config.Default_FPS, 30, 'Default_FPS mặc định phải là 30');
            assert.strictEqual(config.Default_Width, 1920, 'Default_Width mặc định phải là 1920');
            assert.strictEqual(config.Default_Height, 1080, 'Default_Height mặc định phải là 1080');
            assert.strictEqual(config.OpenAI_Model, 'gpt-5.3-codex');
            assert.strictEqual(config.DeepSeek_Model, 'deepseek-4-flash');
            assert.strictEqual(config.Gemini_Model, 'gemini-3.5-flash');
            assert.strictEqual(config.Claude_Model, 'claude sonnet 4.5');
            assert.strictEqual(config.OpenAI_APIKEY, undefined);
            assert.strictEqual(config.Gemini_APIKEY, undefined);
        });

        it('phải parse đúng các giá trị tùy chỉnh khi có trong process.env', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.PORT = '8080';
            process.env.NODE_ENV = 'production';
            process.env.LLM_Provider = 'openai';
            process.env.TTS_Provider = 'elevenlabs';
            process.env.Default_FPS = '60';

            const config = getConfig();

            assert.strictEqual(config.PORT, 8080);
            assert.strictEqual(config.NODE_ENV, 'production');
            assert.strictEqual(config.LLM_Provider, 'openai');
            assert.strictEqual(config.TTS_Provider, 'elevenlabs');
            assert.strictEqual(config.Default_FPS, 60);
        });

        it('phải parse đúng khi LLM_Provider là 9router', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.LLM_Provider = '9router';
            const config = getConfig();
            assert.strictEqual(config.LLM_Provider, '9router');
            assert.strictEqual(config.NineRouter_BaseURL, 'http://localhost:20128/v1');
            assert.strictEqual(config.NineRouter_Model, 'ag/gemini-3.8-flash-high');
        });
    });

    describe('TC-CFG-002: Bắt lỗi khi biến môi trường không đúng kiểu hoặc ngoài enum', () => {
        it('phải ném Error khi LLM_Provider không nằm trong enum hỗ trợ', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.LLM_Provider = 'unknown_ai';

            assert.throws(
                () => getConfig(),
                (err: Error) => {
                    assert.match(err.message, /Configuration error:/);
                    assert.match(err.message, /LLM_Provider/);
                    return true;
                },
                'Phải ném ngoại lệ khi LLM_Provider không hợp lệ'
            );
        });

        it('phải ném Error khi TTS_Provider không nằm trong enum hỗ trợ', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.TTS_Provider = 'invalid_tts';

            assert.throws(
                () => getConfig(),
                (err: Error) => {
                    assert.match(err.message, /Configuration error:/);
                    assert.match(err.message, /TTS_Provider/);
                    return true;
                },
                'Phải ném ngoại lệ khi TTS_Provider không hợp lệ'
            );
        });

        it('phải ném Error khi PORT không thể ép kiểu sang số hợp lệ', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.PORT = 'not-a-number';

            assert.throws(
                () => getConfig(),
                (err: Error) => {
                    assert.match(err.message, /Configuration error:/);
                    assert.match(err.message, /PORT/);
                    return true;
                },
                'Phải ném ngoại lệ khi PORT không phải là số'
            );
        });

        it('phải ném Error khi NODE_ENV không phải production hoặc development', () => {
            cleanConfigEnv();
            resetConfig();

            process.env.NODE_ENV = 'staging' as any;

            assert.throws(
                () => getConfig(),
                (err: Error) => {
                    assert.match(err.message, /Configuration error:/);
                    assert.match(err.message, /NODE_ENV/);
                    return true;
                },
                'Phải ném ngoại lệ khi NODE_ENV không hợp lệ'
            );
        });
    });

    describe('TC-CFG-003: Xác minh bảng Video Presets và tỷ lệ khung hình', () => {
        it('phải chứa đầy đủ các preset cần thiết (16:9, 9:16, 4:3, 1:1)', () => {
            const expectedKeys = ['16:9', '9:16', '4:3', '1:1'];
            const actualKeys = Object.keys(videoPreset);

            for (const key of expectedKeys) {
                assert.ok(actualKeys.includes(key), `Preset phải có key: ${key}`);
            }
        });

        it('phải định nghĩa đúng kích thước chiều rộng và chiều cao cho từng preset', () => {
            assert.deepStrictEqual(videoPreset['16:9'], {
                name: '16:9',
                width: 1920,
                height: 1080,
                label: '16:9',
            });

            assert.deepStrictEqual(videoPreset['9:16'], {
                name: '9:16',
                width: 1080,
                height: 1920,
                label: '9:16',
            });

            assert.deepStrictEqual(videoPreset['4:3'], {
                name: '4:3',
                width: 1440,
                height: 1920,
                label: '4:3',
            });

            assert.deepStrictEqual(videoPreset['1:1'], {
                name: '1:1',
                width: 1920,
                height: 1920,
                label: '1:1',
            });
        });
    });

    describe('TC-CFG-004: Kiểm tra tính chất Singleton Caching của getConfig()', () => {
        it('phải trả về cùng tham chiếu đối tượng trong các lần gọi liên tiếp', () => {
            cleanConfigEnv();
            resetConfig();
            process.env.PORT = '4000';

            const c1 = getConfig();
            assert.strictEqual(c1.PORT, 4000);

            // Thay đổi process.env sau khi đã nạp config lần đầu
            process.env.PORT = '9999';

            const c2 = getConfig();

            // Phải tham chiếu tới cùng 1 object (singleton)
            assert.strictEqual(c1, c2, 'getConfig() phải trả về cùng một instance cache');
            assert.strictEqual(c2.PORT, 4000, 'PORT không được thay đổi do đã được cache');
        });

        it('phải nạp lại cấu hình mới khi gọi resetConfig()', () => {
            cleanConfigEnv();
            resetConfig();
            process.env.PORT = '5000';

            const c1 = getConfig();
            assert.strictEqual(c1.PORT, 5000);

            // Thay đổi env và gọi resetConfig()
            process.env.PORT = '6000';
            resetConfig();

            const c2 = getConfig();
            assert.notStrictEqual(c1, c2, 'Sau khi resetConfig, phải tạo instance mới');
            assert.strictEqual(c2.PORT, 6000, 'Cấu hình mới phải phản ánh giá trị env mới');
        });
    });
});
