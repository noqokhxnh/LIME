import { processVideoJob } from './queue/handler.js';
import { videoRequestSchema } from './llm/schema.js';
import { v4 } from 'uuid';
import { join } from 'node:path';
import { initDatabase } from './database/index.js';

const USAGE = `Usage: npm run cli -- --prompt "your prompt here" [options]

Options:
  --prompt <text>          Brief cho video (bat buoc)
  --duration <sec>         Thoi luong muc tieu, 10-300 (mac dinh 15)
  --aspectRatio <ratio>    16:9 | 9:16 | 1:1 | 4:3 (mac dinh 16:9)
  --style <style>          modern | classic | stickman | minimal (mac dinh modern)
  --tempo <tempo>          auto | fast | balanced | slow (mac dinh auto)
  --voice <name>           Ten giong doc (mac dinh cua pipeline)
  --ttsProvider <id>       edge | elevenlabs | openai | google | vieneu
  --help                   In huong dan nay`;

/** Tach `--key value` thanh object. `--flag` (khong co value) => "true". */
export function parseCliArgs(argv: string[]): Record<string, string> {
    const options: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            options[key] = 'true';
        } else {
            options[key] = next;
            i++;
        }
    }
    return options;
}

/**
 * Dung payload cho `videoRequestSchema` tu CLI options.
 *
 * Truoc day CLI khong truyen `style` (bat buoc trong schema) nen moi lan chay
 * deu fail ngay o buoc parse. Nay style mac dinh `modern`, va tempo/voice/
 * ttsProvider duoc chuyen tiep thay vi bi bo roi.
 */
export function buildCliRequestInput(options: Record<string, string>) {
    return {
        prompt: options.prompt,
        targetDurationSec: options.duration ? Number.parseInt(options.duration, 10) : 15,
        aspectRatio: options.aspectRatio || '16:9',
        style: options.style || 'modern',
        tempo: options.tempo || 'auto',
        ...(options.voice ? { voice: options.voice } : {}),
        ...(options.ttsProvider ? { ttsProvider: options.ttsProvider } : {}),
    };
}

async function runCli() {
    const options = parseCliArgs(process.argv.slice(2));

    if (options.help === 'true') {
        console.log(USAGE);
        process.exit(0);
    }

    if (!options.prompt) {
        console.error(`Thieu --prompt.\n\n${USAGE}`);
        process.exit(1);
    }

    // Validate TRUOC khi khoi tao DB de loi tham so khong keo theo ket nối
    // Postgres/Redis va de thong bao loi de doc cho nguoi dung.
    const parsed = videoRequestSchema.safeParse(buildCliRequestInput(options));
    if (!parsed.success) {
        console.error('Tham so khong hop le:');
        for (const issue of parsed.error.issues) {
            console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
        }
        console.error(`\n${USAGE}`);
        process.exit(1);
    }
    const request = parsed.data;

    await initDatabase();

    const jobId = v4();
    const outputDir = join(process.cwd(), 'tmp', `cli-job-${jobId}`);

    console.log(`Starting CLI job ${jobId}...`);
    console.log(`  prompt: ${request.prompt}`);
    console.log(`  ${request.aspectRatio} · ${request.targetDurationSec}s · style=${request.style} · tempo=${request.tempo}`);

    try {
        const result = await processVideoJob({
            jobId,
            request,
            outputDir,
        }, async (progress) => {
            console.log(`[Progress] ${progress.phase}: ${progress.message} (${Math.round(progress.progress * 100)}%)`);
        });

        console.log('Job completed successfully!');
        console.log(`Video saved to: ${result.videoPath}`);
        process.exit(0);
    } catch (err: any) {
        console.error('Job failed:', err);
        process.exit(1);
    }
}

// Chi tu chay khi duoc goi truc tiep (cho phep import ham de test).
if (process.argv[1] && process.argv[1].endsWith('cli.ts')) {
    runCli();
}
