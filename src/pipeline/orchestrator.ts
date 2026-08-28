import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { videoPreset } from "@/config";
import { videoRequest, pipelineResult, pipelineProgess, progressCallback } from "@/llm/schema";
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

    const logProgress = (phase: pipelinePhase, msg: string, pct?: number) => {
        onProgress?.({ phase, message: msg, pct });
        timing[phase] = Date.now() - startTime;
    }
    mkdirSync(workDir, { recursive: true });

    let script: Script;
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
        logProgress("script-generation", "Generating script", 0);
        script = await generateScript(request.promt, { model: request.llmModel, onProgress: logProgress });
        timing["script-generation"] = Date.now() - phaseStart;

        phaseStart = Date.now();
        const estimateDuration = estimateDuration(script); // Tinh thoi gian tam thoi
        if (estimateDuration > request.targetDurationSec * 1.5) {
            throw new Error(`estimate duration too long, try again`);
        }

        phaseStart = Date.now();
        const tempAssembly = await assembleHTML(script, estimateDuration, preset.width, preset.height, workDir, (msg) => {
            logProgress("html-assembly", msg, 10);
        });
        timing["html-assembly"] = Date.now() - phaseStart;


        phaseStart = Date.now();
        const previewResult = await generatePreview(tempAssembly.htmlPath, estimateDuration, script.scence.map(s => s.id), preset.width, preset.height, workDir, (msg) => {
            logProgress("html-assembly", msg, 10);
        });
        timing["html-assembly"] = Date.now() - phaseStart;

    } catch (err) {
        logProgress("script-generation", "Failed to generate script", 100);
        throw err;
    }

}
