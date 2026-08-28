import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { videoPreset } from "@/config";
import { videoRequest, pipelineResult, pipelineProgess, progressCallback, pipelinePhase, videoScript } from "@/llm/schema";
import { generateScript } from "./scriptGenerator";

export interface orchestratorOptions {
    request: videoRequest;
    bgmPath?: string;
    skipPreview?: boolean;
    onProgress?: progressCallback;
    outputDir?: string;
}

export interface fullPipelineResult extends pipelineResult {
    jobId: string;
    workDir: string;
    // preview?: previewResult;
    timing: Record<string, number>;

}
export async function runFullPipeline(option: orchestratorOptions): Promise<fullPipelineResult> {
    const { request, bgmPath, skipPreview, onProgress, outputDir } = option;

    const jobId = v4();
    const workDir = outputDir ?? join(process.cwd(), "temp", `job-${jobId}`);

    if (existsSync(workDir)) {
        rmSync(workDir, { recursive: true, force: true });
    }

    const preset = videoPreset[request.aspectRatio];
    const fps = 30;
    const timing: Record<string, number> = {};
    const startTime = Date.now();

    const logProgress = (phase: pipelinePhase, progress: number, msg: string) => {
        onProgress?.({ phase, progress, message: msg });
        timing[phase] = Date.now() - startTime;
    }
    mkdirSync(workDir, { recursive: true });

    let script: videoScript;
    // phase 1: gen script 
    // phase 2: estimate duration 
    // phase 3: assemble html tam thoi de preview
    // phase 4: show screen shot 
    // if user comfirm 
    // phase 5: audio sysnthesis
    // phase 6: re-assemble html with actual duration
    // phase 7: render video
    // phase 8: mux final mp4
    try {
        let phaseStart = Date.now();
        logProgress("script_generation", 0, "Generating script");
        script = await generateScript(request, (msg: string) => {
            logProgress("script_generation", 10, msg);
        });
        timing["script_generation"] = Date.now() - phaseStart;

        phaseStart = Date.now();
        logProgress("estimate_duration", 10, "Estimating duration")
        const estimateDuration = estimateDuration(script); // Tinh thoi gian tam thoi
        if (estimateDuration > request.targetDurationSec * 1.5) {
            throw new Error(`estimate duration too long, try again`);
        }

        phaseStart = Date.now();
        const tempAssembly = await assembleHTML(script, estimateDuration, preset.width, preset.height, workDir, (msg) => {
            logProgress("html_assembly", 20, msg);
        });
        timing["html-assembly"] = Date.now() - phaseStart;


        phaseStart = Date.now();
        const previewResult = await generatePreview(tempAssembly.htmlPath, estimateDuration, script.scence.map(s => s.id), preset.width, preset.height, workDir, (msg) => {
            logProgress("html_assembly", 30, msg);
        });
        timing["html-assembly"] = Date.now() - phaseStart;

        // user accepted
        // phase 5: audio sysnthesis
        // phase 6: re-assemble html with actual duration
        // phase 7: render video
        // phase 8: mux final mp4

        return {
            jobId,
            workDir,
            videoPath: join(workDir, 'final_video.mp4'),
            durationSec: estimateDuration,
            scences: script.scenes,
            resolution: `${preset.width}x${preset.height}`,
            preview: previewResult,
            timing: timing,
        };
    } catch (err) {
        logProgress("script_generation", 100, "Failed to generate script");
        throw err;
    }
}
