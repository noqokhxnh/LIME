/**
 * Test timeout lượt gọi LLM (#108): provider có lúc upstream treo hoặc sinh cực
 * chậm — nếu không có AbortSignal, 1 lượt kẹt giữ route /api/script/draft treo
 * vĩnh viễn ở "Đang viết 3 phương án…". Yêu cầu:
 *   1. pickStyleSlug hết timeout → null (graceful), pipeline vẫn chạy.
 *   2. generateScript hết timeout → ném LLMTimedOutError NGAY, không retry 3 lần
 *      (retry chỉ đốt thêm ~20 phút vì upstream vẫn chậm/treo).
 *
 * Chạy offline: LLM giả "treo" chỉ reject khi AbortSignal báo hết hạn.
 */
import { describe, it, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    generateScript,
    pickStyleSlug,
    STYLE_PICK_TIMEOUT_MS,
    SCRIPT_GENERATE_TIMEOUT_MS,
} from '../../src/pipeline/scriptGenerator.js';
import { setLLMClient, resetLLMClient, type LLMClient } from '../../src/llm/client.js';
import type { videoRequest } from '../../src/llm/schema.js';

after(() => {
    mock.restoreAll();
    resetLLMClient();
});

/** LLM giả không bao giờ tự resolve — chỉ reject với TimeoutError khi signal abort. */
function hangingLLM(): LLMClient & { calls: number } {
    const client = {
        calls: 0,
        provider: 'mock' as const,
        generate(_system: string, _user: string, signal?: AbortSignal): Promise<string> {
            client.calls++;
            return new Promise<string>((_, reject) => {
                signal?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
                });
            });
        },
    };
    return client as LLMClient & typeof client;
}

describe('LLM call timeout (#108) — hằng số đủ rộng nhưng có bến', () => {
    it('pick ngắn hơn sinh script; sinh script ≥ 300s cho output lớn trên upstream chậm', () => {
        assert.ok(STYLE_PICK_TIMEOUT_MS < SCRIPT_GENERATE_TIMEOUT_MS);
        assert.ok(STYLE_PICK_TIMEOUT_MS <= 60_000, 'pick ≤ 60s (output chỉ vài token)');
        assert.ok(SCRIPT_GENERATE_TIMEOUT_MS >= 300_000, 'script ≥ 300s');
    });
});

describe('LLM call timeout (#108) — pickStyleSlug graceful', () => {
    it('Hết timeout → trả null, gọi đúng 1 lượt, không treo', async () => {
        const llm = hangingLLM();
        const t0 = Date.now();
        const slug = await pickStyleSlug('brief ngắn', llm, undefined, 50);
        assert.equal(slug, null, 'lỗi mọi đường về null (nguyên tắc #105)');
        assert.ok(Date.now() - t0 < 5_000, 'phải trả về gần như ngay, không chờ 45s mặc định');
        assert.equal(llm.calls, 1);
    });
});

describe('LLM call timeout (#108) — generateScript không retry khi timeout', () => {
    const request: videoRequest = {
        prompt: 'Video giới thiệu app fintech: ngân hàng số, tài khoản miễn phí.',
        style: 'modern',
        targetDurationSec: 30,
        language: 'vi',
        aspectRatio: '16:9',
    } as videoRequest;

    it('Hết timeout → ném LLMTimedOutError ngay, đúng 2 lượt LLM (pick + script), không đốt attempt', async () => {
        const llm = hangingLLM();
        setLLMClient(llm);
        const t0 = Date.now();
        await assert.rejects(
            generateScript(request, () => {}, undefined, undefined, undefined, {
                pickTimeoutMs: 30,
                scriptTimeoutMs: 40,
            }),
            (err: any) => err.name === 'LLMTimedOutError'
        );
        assert.ok(Date.now() - t0 < 5_000, 'phải thất bại nhanh thay vì treo 3×420s');
        assert.equal(llm.calls, 2, '1 lượt pick (về null) + 1 lượt script (timeout) — không retry');
    });
});
