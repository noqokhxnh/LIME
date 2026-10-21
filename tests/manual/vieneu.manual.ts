/**
 * KIỂM TRA THỦ CÔNG — không phải test tự động.
 *
 * Trước đây file này nằm ở `tests/integration/vieneu.test.ts` nhưng không hề có `assert`:
 * nó chỉ gọi TTS rồi ghi log, nên luôn "pass" kể cả khi service không tồn tại (đã từng
 * in ra `ENOTFOUND lime_vieneu_tts` mà bộ test vẫn xanh). Đuôi `*.manual.ts` giúp
 * `scripts/run-unit-tests.ts` không coi đây là test và không đưa vào nhóm nào.
 *
 * Cách chạy (cần service VieNeu-TTS đang chạy, xem `docker-compose.yml`):
 *   docker compose up -d vieneu-tts
 *   npx tsx tests/manual/vieneu.manual.ts
 */
import { createTTSClient } from '../../src/pipeline/audioSysnthesis.js';
import { existsSync, statSync } from 'node:fs';

async function test() {
    console.log('Testing createTTSClient with provider vieneu...');
    const client = createTTSClient('vieneu');
    console.log('Client provider:', client.provider);
    const outPath = 'tmp/test_vieneu_docker.mp3';
    const text = 'Xin chào, đây là kiểm tra tích hợp VieNeu-TTS client trong VidTML qua Docker.';
    const t0 = Date.now();
    await client.synthesize(text, outPath, { voice: 'Mai Anh' });
    const elapsed = Date.now() - t0;
    console.log(`Synthesis completed in ${elapsed}ms`);
    console.log(`File generated: ${existsSync(outPath)}, size: ${statSync(outPath).size} bytes`);

    console.log('Testing fallback when an invalid voice ID (e.g. ElevenLabs ID) is passed...');
    const outFallbackPath = 'tmp/test_vieneu_fallback.mp3';
    await client.synthesize('Kiểm tra fallback giọng đọc.', outFallbackPath, { voice: 'CQAD6iKxS73fEAGjSwt5' });
    console.log(`Fallback file generated: ${existsSync(outFallbackPath)}, size: ${statSync(outFallbackPath).size} bytes`);
}

test().catch(console.error);
