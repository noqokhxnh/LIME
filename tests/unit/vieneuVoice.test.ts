import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    findVieNeuPreset,
    resolveVieNeuVoice,
    VieNeuTTSClient,
    VIENEU_PRESET_VOICES,
} from '../../src/pipeline/audioSysnthesis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

type CapturedRequest = { url: string; body: any };

/** Thay fetch toàn cục để bắt request mà KHÔNG gọi mạng thật. */
function withFetchStub(run: (sent: CapturedRequest[]) => Promise<void>): Promise<void> {
    const original = globalThis.fetch;
    const sent: CapturedRequest[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
        sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new ArrayBuffer(8),
            text: async () => '',
        } as any;
    }) as typeof fetch;
    return run(sent).finally(() => {
        globalThis.fetch = original;
    });
}

describe('VieNeu voice resolution & passthrough', () => {
    it('giữ đúng giọng hợp lệ người dùng chọn (Trúc Ly) thay vì ép về mặc định', () => {
        assert.strictEqual(resolveVieNeuVoice('Trúc Ly', 'Minh Quân'), 'Trúc Ly');
        assert.strictEqual(findVieNeuPreset('trúc ly')?.id, 'Trúc Ly');
    });

    it('fallback về giọng cấu hình khi yêu cầu không hợp lệ, và về Minh Quân khi cùng không hợp lệ', () => {
        assert.strictEqual(resolveVieNeuVoice('CQAD6iKxS73fEAGjSwt5', 'Mai Anh'), 'Mai Anh');
        assert.strictEqual(resolveVieNeuVoice(undefined, 'không-tồn-tại'), 'Minh Quân');
        assert.strictEqual(resolveVieNeuVoice(undefined, undefined), 'Minh Quân');
    });

    it('mọi id preset đều tra ngược được (không phân biệt hoa thường, có/không dấu cách)', () => {
        for (const preset of VIENEU_PRESET_VOICES) {
            assert.strictEqual(findVieNeuPreset(preset.id)?.id, preset.id);
        }
    });

    it('synthesize gửi đúng voice đã chọn trong body tới microservice', async () => {
        const outDir = join(REPO_ROOT, 'tmp', 'test-vieneu-voice');
        mkdirSync(outDir, { recursive: true });
        const client = new VieNeuTTSClient({
            VIENEU_TTS_URL: 'http://127.0.0.1:9',
            TTS_Voice: 'Minh Quân',
        } as any);

        await withFetchStub(async (sent) => {
            await client.synthesize('Xin chào', join(outDir, 'a.mp3'), { voice: 'Trúc Ly' });
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].url, 'http://127.0.0.1:9/api/tts');
            assert.strictEqual(sent[0].body.voice, 'Trúc Ly');
        });

        rmSync(outDir, { recursive: true, force: true });
    });
});

describe('VieNeu microservice giữ đúng giọng (guard nguồn server.py)', () => {
    const serverPy = readFileSync(join(REPO_ROOT, 'services', 'vieneu-tts', 'server.py'), 'utf-8');

    it('lấy danh sách giọng từ list_preset_voices() — nguồn sự thật của engine', () => {
        assert.match(serverPy, /list_preset_voices\(\)/);
    });

    it('KHÔNG còn dùng getattr(engine, "available_voices", ...) — thuộc tính không tồn tại khiến luôn về mặc định', () => {
        assert.doesNotMatch(serverPy, /available_voices\s*=\s*\{[^}]*getattr\(engine,\s*"available_voices"/);
    });

    it('chỉ chuyển sang giọng mặc định khi giọng yêu cầu không có trong danh sách', () => {
        assert.match(serverPy, /req_voice\s+in\s+available_voices/);
    });
});
