import { processVideoJob } from './queue/handler.js';
import { videoRequestSchema } from './llm/schema.js';
import { v4 } from 'uuid';
import { join } from 'node:path';
import { initDatabase } from './database/index.js';

async function runCli() {
    const args = process.argv.slice(2);
    const options: Record<string, string> = {};
    
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            options[key] = args[i + 1];
            i++;
        }
    }

    if (!options.prompt) {
        console.error("Usage: npm run cli -- --prompt \"your prompt here\" [--duration 15] [--aspectRatio 16:9]");
        process.exit(1);
    }

    await initDatabase();

    const request = videoRequestSchema.parse({
        prompt: options.prompt,
        targetDurationSec: options.duration ? parseInt(options.duration, 10) : 15,
        aspectRatio: options.aspectRatio || '16:9'
    });

    const jobId = v4();
    const outputDir = join(process.cwd(), 'tmp', `cli-job-${jobId}`);

    console.log(`Starting CLI job ${jobId}...`);

    try {
        const result = await processVideoJob({
            jobId,
            request,
            outputDir,
        }, async (progress) => {
            console.log(`[Progress] ${progress.phase}: ${progress.message} (${Math.round(progress.progress * 100)}%)`);
        });

        console.log("Job completed successfully!");
        console.log(`Video saved to: ${result.videoPath}`);
        process.exit(0);
    } catch (err: any) {
        console.error("Job failed:", err);
        process.exit(1);
    }
}

runCli();
