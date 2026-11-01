import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCliArgs, buildCliRequestInput } from '../../src/cli.js';
import { videoRequestSchema } from '../../src/llm/schema.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runCli(args: string[]) {
    return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 60_000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
}

describe('CLI — tham so bat buoc va mac dinh', () => {
    it('parseCliArgs tach --key value và chấp nhận --flag không có value', () => {
        const options = parseCliArgs(['--prompt', 'video quán cà phê', '--duration', '20', '--help']);
        assert.deepStrictEqual(options, {
            prompt: 'video quán cà phê',
            duration: '20',
            help: 'true',
        });
    });

    it('buildCliRequestInput điền style mặc định modern (lỗi cũ: CLI không truyền style)', () => {
        const input = buildCliRequestInput({ prompt: 'Một video giới thiệu quán cà phê' });
        assert.strictEqual(input.style, 'modern');
        assert.strictEqual(input.tempo, 'auto');
        assert.strictEqual(input.targetDurationSec, 15);
        assert.strictEqual(input.aspectRatio, '16:9');
    });

    it('payload CLI parse được bằng videoRequestSchema — đây là chỗ CLI từng fail', () => {
        const parsed = videoRequestSchema.safeParse(
            buildCliRequestInput({ prompt: 'Một video giới thiệu quán cà phê', duration: '20', tempo: 'slow' })
        );
        assert.strictEqual(parsed.success, true);
        if (parsed.success) {
            assert.strictEqual(parsed.data.style, 'modern');
            assert.strictEqual(parsed.data.tempo, 'slow');
            assert.strictEqual(parsed.data.targetDurationSec, 20);
        }
    });

    it('--help in usage có --style và --tempo, thoát 0', () => {
        const res = runCli(['--help']);
        assert.strictEqual(res.status, 0, res.stderr);
        assert.match(res.stdout, /--style/);
        assert.match(res.stdout, /--tempo/);
    });

    it('style không hợp lệ bị chặn trước khi khởi tạo DB, thoát 1', () => {
        const res = runCli(['--prompt', 'Một video giới thiệu quán cà phê', '--style', 'khong-ton-tai']);
        assert.strictEqual(res.status, 1);
        assert.match(res.stderr, /Tham so khong hop le/);
        assert.match(res.stderr, /style/);
    });
});
