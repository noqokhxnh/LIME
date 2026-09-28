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
