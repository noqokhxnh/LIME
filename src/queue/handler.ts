import { JobData, JobProgress } from './interfaces.js';
import { runFullPipeline, type fullPipelineResult } from '../pipeline/orchestrator.js';

export async function processVideoJob(data: JobData, updateProgress: (p: JobProgress) => Promise<void>): Promise<fullPipelineResult> {
    return await runFullPipeline({
        request: data.request,
        script: data.script,
        bgmPath: data.bgmPath,
        skipPreview: data.skipPreview,
        outputDir: data.outputDir,
        onProgress: (p) => {
            updateProgress(p).catch(err => console.error("Failed to update progress", err));
        }
    });
}
