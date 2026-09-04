import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import {
    generateSecMsGecToken,
    sanitizeXmlText,
    buildSpeechConfigFrame,
    buildSsmlFrame,
    parseFrameHeaders,
    looksLikeEdgeVoice,
    resolveEdgeVoice,
    probeDuration,
    concatAudios,
    mixBgm,
    generateSilence,
    getTTSClient,
    resetTTSClient,
    setTTSClient,
    EdgeTTSClient,
    OpenAITTSClient,
    GoogleTTSClient,
    ElevenLabsTTSClient,
    synthesizeAudio,
    type TTSClient,
} from '../../src/pipeline/audioSysnthesis.js';
import { resetConfig, type Config } from '../../src/config.js';
import { type videoScript } from '../../src/llm/schema.js';

class MockAudioTTSClient implements TTSClient {
    readonly provider = 'mock-tts';
    public synthesizedTexts: string[] = [];

    async synthesize(
        text: string,
        outputPath: string,
        _options?: { voice?: string; language?: string; signal?: AbortSignal }
    ): Promise<void> {
        this.synthesizedTexts.push(text);
        // Tạo file âm thanh giả lập 1.5s bằng generateSilence
        await generateSilence(outputPath, 1.5);
    }
}

describe('Module 5: Audio Synthesis TTS & FFmpeg (src/pipeline/audioSysnthesis.ts)', () => {
    let testTempDir: string;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        resetConfig();
        resetTTSClient();
        testTempDir = mkdtempSync(join(tmpdir(), 'audio-test-'));
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
        resetTTSClient();
        if (existsSync(testTempDir)) {
            rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    describe('TC-TTS-001: Thuật toán tạo Token Sec-MS-GEC của Edge TTS', () => {
        it('phải trả về chuỗi 64 ký tự hex viết hoa', () => {
            const token = generateSecMsGecToken();
            assert.match(token, /^[A-F0-9]{64}$/, 'Token phải gồm 64 ký tự SHA-256 hex viết hoa');
        });

        it('phải tạo token giống hệt nhau trong cùng cửa sổ 5 phút', () => {
            // Căn chỉnh baseTime tại mốc đầu cửa sổ 5 phút (300 giây)
            const baseSeconds = 1772600000 - (1772600000 % 300);
            const baseTime = baseSeconds * 1000;
            const timeInSameWindow = baseTime + 60_000; // sau 1 phút (vẫn trong cùng cửa sổ 5 phút)

            const token1 = generateSecMsGecToken(baseTime);
            const token2 = generateSecMsGecToken(timeInSameWindow);

            assert.strictEqual(token1, token2, 'Token trong cùng block 5 phút phải giống hệt nhau');
        });

        it('phải tạo token khác nhau khi vượt sang cửa sổ 5 phút tiếp theo', () => {
            const baseSeconds = 1772600000 - (1772600000 % 300);
            const baseTime = baseSeconds * 1000;
            const timeNextWindow = baseTime + 360_000; // sau 6 phút (sang cửa sổ tiếp theo)

            const token1 = generateSecMsGecToken(baseTime);
            const token2 = generateSecMsGecToken(timeNextWindow);

            assert.notStrictEqual(token1, token2, 'Token ở 2 block 5 phút khác nhau phải khác nhau');
        });
    });

    describe('TC-TTS-002: Làm sạch ký tự điều khiển và Escape XML trong SSML', () => {
        it('phải thay thế control characters và escape XML (&, <, >)', () => {
            const raw = 'AI & Deep Learning <2026>\x0B';
            const sanitized = sanitizeXmlText(raw);

            // \x0B (vertical tab) chuyển thành dấu cách, & -> &amp;, < -> &lt;, > -> &gt;
            assert.strictEqual(sanitized, 'AI &amp; Deep Learning &lt;2026&gt; ');
        });

        it('phải đóng gói đúng cấu trúc SSML qua buildSsmlFrame', () => {
            const frame = buildSsmlFrame('Xin chào & hẹn gặp lại <AI>', 'vi-VN-HoaiMyNeural');

            assert.match(frame, /Path:ssml/);
            assert.match(frame, /Content-Type:application\/ssml\+xml/);
            assert.match(frame, /<voice name='vi-VN-HoaiMyNeural'>/);
            assert.match(frame, /Xin chào &amp; hẹn gặp lại &lt;AI&gt;/);
        });

        it('phải tạo frame cấu hình Speech Config chính xác', () => {
            const frame = buildSpeechConfigFrame();

            assert.match(frame, /Path:speech\.config/);
            assert.match(frame, /audio-24khz-48kbitrate-mono-mp3/);
            assert.match(frame, /Content-Type:application\/json/);
        });
    });

    describe('TC-TTS-003: Xử lý đóng gói WebSocket Frames và phân tích Headers', () => {
        it('phải phân tích chính xác headers và body từ frame dạng text', () => {
            const sampleFrame =
                'X-RequestId:req-12345\r\n' +
                'Path:turn.end\r\n' +
                'Content-Type:text/plain\r\n\r\n' +
                '{"status":"completed"}';

            const { headers, body } = parseFrameHeaders(sampleFrame);

            assert.strictEqual(headers['x-requestid'], 'req-12345');
            assert.strictEqual(headers['path'], 'turn.end');
            assert.strictEqual(headers['content-type'], 'text/plain');
            assert.strictEqual(body, '{"status":"completed"}');
        });

        it('phải nhận diện đúng định dạng Edge voice name', () => {
            assert.strictEqual(looksLikeEdgeVoice('vi-VN-HoaiMyNeural'), true);
            assert.strictEqual(looksLikeEdgeVoice('en-US-AriaNeural'), true);
            assert.strictEqual(looksLikeEdgeVoice('alloy'), false);
            assert.strictEqual(looksLikeEdgeVoice('custom_voice'), false);
        });

        it('phải tự động phân giải giọng Edge phù hợp với ngôn ngữ', () => {
            assert.strictEqual(resolveEdgeVoice(undefined, 'vi'), 'vi-VN-HoaiMyNeural');
            assert.strictEqual(resolveEdgeVoice(undefined, 'en'), 'en-US-AriaNeural');
            assert.strictEqual(resolveEdgeVoice(undefined, 'ja'), 'ja-JP-NanamiNeural');
            assert.strictEqual(resolveEdgeVoice('vi-VN-NamMinhNeural', 'vi'), 'vi-VN-NamMinhNeural');
        });
    });

    describe('TC-TTS-004: Tự động tạo file im lặng (generateSilence)', () => {
        it('phải tạo file MP3 im lặng có thời lượng chuẩn xác qua ffmpeg', async () => {
            const silencePath = join(testTempDir, 'silence_2s.mp3');
            await generateSilence(silencePath, 2.0);

            assert.ok(existsSync(silencePath), 'File im lặng phải tồn tại');
            const duration = await probeDuration(silencePath);

            // Đo độ lệch cho phép ±0.15s
            assert.ok(
                Math.abs(duration - 2.0) < 0.15,
                `Thời lượng file im lặng phải xấp xỉ 2.0s (thực tế: ${duration}s)`
            );
        });
    });

    describe('TC-TTS-005: Đo thời lượng âm thanh thực tế với probeDuration (ffprobe)', () => {
        it('phải đo chính xác thời lượng của file âm thanh MP3', async () => {
            const samplePath = join(testTempDir, 'sample_3s.mp3');
            await generateSilence(samplePath, 3.0);

            const duration = await probeDuration(samplePath);
            assert.ok(
                Math.abs(duration - 3.0) < 0.15,
                `ffprobe phải trả về xấp xỉ 3.0s (thực tế: ${duration}s)`
            );
        });

        it('phải ném lỗi khi đường dẫn file không tồn tại', async () => {
            const nonExistentPath = join(testTempDir, 'not_found.mp3');
            await assert.rejects(
                async () => {
                    await probeDuration(nonExistentPath);
                },
                /ffprobe failed/
            );
        });
    });

    describe('TC-TTS-006: Ghép nối các file âm thanh (concatAudios)', () => {
        it('phải ghép nối nhiều file MP3 thành một file tổng có thời lượng bằng tổng các file con', async () => {
            const file1 = join(testTempDir, 'part1.mp3');
            const file2 = join(testTempDir, 'part2.mp3');
            const concatOut = join(testTempDir, 'concat_out.mp3');

            await generateSilence(file1, 1.2);
            await generateSilence(file2, 1.8);

            await concatAudios([file1, file2], concatOut);

            assert.ok(existsSync(concatOut), 'File ghép nối phải được tạo thành công');
            const totalDuration = await probeDuration(concatOut);

            // Tổng thời lượng dự kiến: 1.2 + 1.8 = 3.0s (dung sai ±0.25s)
            assert.ok(
                Math.abs(totalDuration - 3.0) < 0.25,
                `Thời lượng ghép nối phải ~3.0s (thực tế: ${totalDuration}s)`
            );
        });

        it('phải copy file trực tiếp khi chỉ có đúng 1 file đầu vào', async () => {
            const file1 = join(testTempDir, 'single.mp3');
            const singleOut = join(testTempDir, 'single_out.mp3');

            await generateSilence(file1, 1.0);
            await concatAudios([file1], singleOut);

            assert.ok(existsSync(singleOut));
            const duration = await probeDuration(singleOut);
            assert.ok(Math.abs(duration - 1.0) < 0.15);
        });
    });

    describe('TC-TTS-007: Trộn nhạc nền BGM (mixBgm)', () => {
        it('phải trộn nhạc nền với lời đọc và giữ thời lượng bằng thời lượng lời đọc (duration=first)', async () => {
            const voicePath = join(testTempDir, 'voice_3s.mp3');
            const bgmPath = join(testTempDir, 'bgm_1s.mp3');
            const mixOut = join(testTempDir, 'final_mix.mp3');

            await generateSilence(voicePath, 3.0);
            await generateSilence(bgmPath, 1.0); // BGM ngắn hơn sẽ được lặp qua -stream_loop -1

            await mixBgm(voicePath, bgmPath, mixOut, 0.15);

            assert.ok(existsSync(mixOut), 'File mix phải được tạo');
            const mixDuration = await probeDuration(mixOut);

            // Thời lượng phải theo file voice (~3.0s)
            assert.ok(
                Math.abs(mixDuration - 3.0) < 0.25,
                `Thời lượng file mix phải theo voice (~3.0s, thực tế: ${mixDuration}s)`
            );
        });
    });

    describe('TC-TTS-008: Quy trình synthesizeAudio toàn trình và hỗ trợ AbortSignal', () => {
        const mockScript: videoScript = {
            id: 'script-audio-01',
            title: 'Kịch bản âm thanh',
            description: 'Test toàn trình âm thanh',
            globalStyles: '',
            globalSetupJs: '',
            scenes: [
                {
                    id: 'scene-1',
                    title: 'Scene Có Lời Thoại',
                    voiceOverText: 'Đây là lời thoại thứ nhất.',
                    visualDescription: '',
                    htmlCode: '',
                    cssCode: '',
                    jsCode: '',
                    transition: 'none',
                    backgroundColor: '#000',
                },
                {
                    id: 'scene-2',
                    title: 'Scene Im Lặng',
                    voiceOverText: '', // Chuỗi rỗng -> tạo silence
                    visualDescription: '',
                    htmlCode: '',
                    cssCode: '',
                    jsCode: '',
                    transition: 'fade',
                    backgroundColor: '#000',
                },
            ],
            colorPalette: {
                primary: '#000',
                secondary: '#111',
                accent: '#222',
                background: '#333',
                text: '#fff',
            },
            fontFamily: 'Inter',
        };

        it('phải tổng hợp âm thanh toàn trình, tự sinh file silence cho scene không lời thoại và ghép track', async () => {
            const mockTTS = new MockAudioTTSClient();
            setTTSClient(mockTTS);

            const outDir = join(testTempDir, 'synth_job');
            const progressLogs: string[] = [];

            const result = await synthesizeAudio({
                script: mockScript,
                outputDir: outDir,
                onProgress: (msg) => progressLogs.push(msg),
            });

            // Kiểm tra các file và durations
            assert.strictEqual(Object.keys(result.audioFiles).length, 2);
            assert.strictEqual(Object.keys(result.scencesDuration).length, 2);
            assert.ok(result.scencesDuration['scene-1'] > 0);
            assert.ok(result.scencesDuration['scene-2'] > 0);
            assert.ok(result.totalDurationSec > 0);

            // File full_voice.mp3 phải tồn tại
            assert.ok(existsSync(result.mixAudioPath));

            // TTS client chỉ được gọi cho scene-1 có lời thoại
            assert.strictEqual(mockTTS.synthesizedTexts.length, 1);
            assert.strictEqual(mockTTS.synthesizedTexts[0], 'Đây là lời thoại thứ nhất.');

            // onProgress phải ghi nhận xử lý cả 2 scene
            assert.ok(progressLogs.some((l) => l.includes('Scene 1/2')));
            assert.ok(progressLogs.some((l) => l.includes('Scene 2/2') || l.includes('không có lời thoại')));
        });

        it('phải ngắt tác vụ ngay lập tức khi AbortSignal được kích hoạt', async () => {
            const mockTTS = new MockAudioTTSClient();
            setTTSClient(mockTTS);

            const controller = new AbortController();
            controller.abort(); // Hủy ngay từ đầu

            const outDir = join(testTempDir, 'synth_abort');

            await assert.rejects(
                async () => {
                    await synthesizeAudio({
                        script: mockScript,
                        outputDir: outDir,
                        signal: controller.signal,
                    });
                },
                (err: Error) => {
                    assert.strictEqual(err.name, 'AbortError');
                    return true;
                }
            );
        });

        it('phải ném Error khi script không có scene nào', async () => {
            const emptyScript: videoScript = {
                ...mockScript,
                scenes: [],
            };

            await assert.rejects(
                async () => {
                    await synthesizeAudio({
                        script: emptyScript,
                        outputDir: testTempDir,
                    });
                },
                /Script has no scenes to synthesize/
            );
        });
    });

    describe('Factory & Provider Clients', () => {
        const mockConfig: Config = {
            PORT: 3000,
            NODE_ENV: 'development',
            LLM_Provider: 'gemini',
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

        it('phải khởi tạo đúng client theo cấu hình TTS_Provider', () => {
            process.env.TTS_Provider = 'edge';
            resetConfig();
            resetTTSClient();
            assert.strictEqual(getTTSClient().provider, 'edge');

            process.env.TTS_Provider = 'openai';
            process.env.OpenAI_APIKEY = 'mock-key';
            resetConfig();
            resetTTSClient();
            assert.strictEqual(getTTSClient().provider, 'openai');

            process.env.TTS_Provider = 'google';
            process.env.Google_TTS_APIKEY = 'mock-key';
            resetConfig();
            resetTTSClient();
            assert.strictEqual(getTTSClient().provider, 'google');

            process.env.TTS_Provider = 'elevenlabs';
            process.env.Elevenlabs_API_KEY = 'mock-key';
            resetConfig();
            resetTTSClient();
            assert.strictEqual(getTTSClient().provider, 'elevenlabs');
        });

        it('phải ném Error khi các provider bên thứ 3 thiếu API Key khi gọi synthesize', async () => {
            const openAiClient = new OpenAITTSClient(mockConfig);
            await assert.rejects(
                async () => openAiClient.synthesize('test', join(testTempDir, 'dummy.mp3')),
                /OpenAI TTS requires OPENAI_API_KEY/
            );

            const googleClient = new GoogleTTSClient(mockConfig);
            await assert.rejects(
                async () => googleClient.synthesize('test', join(testTempDir, 'dummy.mp3')),
                /Google TTS requires GOOGLE_TTS_API_KEY/
            );

            const elevenLabsClient = new ElevenLabsTTSClient(mockConfig);
            await assert.rejects(
                async () => elevenLabsClient.synthesize('test', join(testTempDir, 'dummy.mp3')),
                /ElevenLabs TTS requires ELEVENLABS_API_KEY/
            );
        });
    });
});
