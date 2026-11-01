import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSceneImageMap } from '../../src/pipeline/footage.js';
import { videoScriptSchema, type videoScript } from '../../src/llm/schema.js';

const JPEG_BYTES = Buffer.alloc(32 * 1024, 7); // đủ lớn qua MIN_IMAGE_BYTES

function makeScript(scenes: Array<Record<string, unknown>>): videoScript {
    return {
        id: 'vid_test',
        title: 'Test',
        description: 'Test script',
        globalStyles: '',
        globalSetupJs: '',
        colorPalette: { primary: '#000', secondary: '#111', accent: '#222', background: '#000', text: '#fff' },
        scenes: scenes.map((s, i) => ({
            id: `scene_${i + 1}`,
            title: `Scene ${i + 1}`,
            voiceOverText: 'hello',
            visualDescription: 'desc',
            htmlCode: '<div class="scene"></div>',
            cssCode: '',
            jsCode: '',
            transition: 'fade',
            backgroundColor: '#000000',
            ...s,
        })),
    } as unknown as videoScript;
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
    const calls: string[] = [];
    const fn = (async (url: unknown) => {
        const u = String(url);
        calls.push(u);
        return handler(u);
    }) as unknown as typeof fetch;
    return { fn, calls };
}

function pixabayOk() {
    return fakeFetch((url) => {
        if (url.startsWith('https://pixabay.com/api/')) {
            return new Response(
                JSON.stringify({
                    totalHits: 1,
                    hits: [{ largeImageURL: 'https://cdn.pixabay.com/photo/test.jpg', pageURL: 'https://pixabay.com/photos/1/' }],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        }
        return new Response(JPEG_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
}

describe('footage fetcher (Pixabay)', () => {
    it('không có API key thì trả map rỗng và không gọi mạng', async () => {
        const { fn, calls } = fakeFetch(() => {
            throw new Error('không được gọi fetch khi thiếu key');
        });
        const map = await buildSceneImageMap(makeScript([{ footageQuery: 'coffee shop' }]), { apiKey: '', fetchFn: fn });
        assert.deepEqual(map, {});
        assert.equal(calls.length, 0);
    });

    it('scene không có footageQuery thì bỏ qua dù có key', async () => {
        const { fn, calls } = pixabayOk();
        const dir = await mkdtemp(join(tmpdir(), 'footage-test-'));
        try {
            const map = await buildSceneImageMap(makeScript([{}, {}]), { apiKey: 'k', fetchFn: fn, cacheDir: dir });
            assert.deepEqual(map, {});
            assert.equal(calls.length, 0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('gắn data URI cho scene có footageQuery và dùng cache ở lần gọi thứ hai', async () => {
        const { fn, calls } = pixabayOk();
        const dir = await mkdtemp(join(tmpdir(), 'footage-test-'));
        try {
            const script = makeScript([{ footageQuery: 'coffee shop' }]);
            const first = await buildSceneImageMap(script, { apiKey: 'k', fetchFn: fn, cacheDir: dir });
            assert.equal(first['scene_1']?.length, 1);
            assert.ok(first['scene_1'][0].startsWith('data:image/jpeg;base64,'));
            const apiCalls = () => calls.filter((u) => u.startsWith('https://pixabay.com/api/')).length;
            assert.equal(apiCalls(), 1);
            const second = await buildSceneImageMap(script, { apiKey: 'k', fetchFn: fn, cacheDir: dir });
            assert.deepEqual(second, first);
            assert.equal(apiCalls(), 1, 'lần hai phải trúng cache 24h, không gọi API nữa');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('API lỗi thì nuốt lỗi, trả map rỗng, không ném exception', async () => {
        const { fn } = fakeFetch(() => new Response('boom', { status: 500 }));
        const dir = await mkdtemp(join(tmpdir(), 'footage-test-'));
        try {
            const map = await buildSceneImageMap(makeScript([{ footageQuery: 'coffee shop' }]), {
                apiKey: 'k',
                fetchFn: fn,
                cacheDir: dir,
            });
            assert.deepEqual(map, {});
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('schema giữ lại footageQuery sau khi parse', () => {
        const parsed = videoScriptSchema.parse(makeScript([{ footageQuery: 'barista pouring latte art' }]) as unknown as object);
        assert.equal(parsed.scenes[0].footageQuery, 'barista pouring latte art');
    });
});
