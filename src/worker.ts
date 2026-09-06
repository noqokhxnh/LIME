import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "./config.js";
import { jobsStore } from "./jobsStore.js";
import { generateScript } from "./pipeline/scriptGenerator.js";
import { runFullPipeline } from "./pipeline/orchestrator.js";
import { join } from "node:path";

const config = getConfig();
const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

console.log("Worker started, connecting to Redis:", config.REDIS_URL);

export const draftWorker = new Worker("script-draft", async (job: Job) => {
    const jobRecord = await jobsStore.get(job.id!);
    if (!jobRecord) throw new Error("Job not found in store");

    try {
        jobRecord.status = 'running';
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);

        const script = await generateScript(jobRecord.request);
        
        jobRecord.status = 'draft';
        jobRecord.script = script;
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);
        
        return script;
    } catch (err: any) {
        jobRecord.status = 'failed';
        jobRecord.error = err.message;
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);
        throw err;
    }
}, { connection });

export const videoWorker = new Worker("video-generation", async (job: Job) => {
    const jobRecord = await jobsStore.get(job.id!);
    if (!jobRecord) throw new Error("Job not found in store");

    const { script, bgmPath, skipPreview } = job.data;
    const outputDir = join(process.cwd(), "tmp", `job-${job.id!}`);

    try {
        jobRecord.status = 'running';
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);

        const result = await runFullPipeline({
            request: jobRecord.request,
            script: script,
            bgmPath: bgmPath,
            skipPreview: skipPreview,
            outputDir: outputDir,
            onProgress: async (p) => {
                jobRecord.progress = p;
                jobRecord.updatedAt = new Date().toISOString();
                await jobsStore.set(job.id!, jobRecord);
            }
        });

        jobRecord.status = 'completed';
        jobRecord.result = result;
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);
        
        return result;
    } catch (err: any) {
        jobRecord.status = 'failed';
        jobRecord.error = err.message;
        jobRecord.updatedAt = new Date().toISOString();
        await jobsStore.set(job.id!, jobRecord);
        throw err;
    }
}, { connection });

draftWorker.on("completed", (job) => console.log(`[DraftWorker] Job ${job.id} completed.`));
draftWorker.on("failed", (job, err) => console.error(`[DraftWorker] Job ${job?.id} failed:`, err));

videoWorker.on("completed", (job) => console.log(`[VideoWorker] Job ${job.id} completed.`));
videoWorker.on("failed", (job, err) => console.error(`[VideoWorker] Job ${job?.id} failed:`, err));
