import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { videoPreset } from "@/config";
import { videoRequest, pipelineResult, pipelineProgess, progressCallback, pipelinePhase, videoScript, AudioResult } from "@/llm/schema";
import { generateScript } from "./scriptGenerator";
import { estimateDuration } from "./estimateDuration";
import { assembleHTML } from "./asembleHml";
import { generatePreviews, PreviewResult } from "./preview";
import { synthesizeAudio } from "./audioSysnthesis";

export interface orchestratorOptions {
    request: videoRequest;
    script?: videoScript;
    bgmPath?: string;
    skipPreview?: boolean;
    onProgress?: progressCallback;
    outputDir?: string;
}

export interface fullPipelineResult extends pipelineResult {
    jobId: string;
    workDir: string;
    preview?: PreviewResult;
    audio: AudioResult;
    finalHtmlPath: string;
    timing: Record<string, number>;
}

export async function runFullPipeline(option: orchestratorOptions): Promise<fullPipelineResult> {
    const { request, script: inputScript, bgmPath, skipPreview, onProgress, outputDir } = option;

    const jobId = v4();
    const workDir = outputDir ?? join(process.cwd(), "tmp", `job-${jobId}`);

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
    };
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
        if (inputScript) {
            logProgress("script_generation", 10, "Sử dụng kịch bản đã có sẵn");
            script = inputScript;
            timing["script_generation"] = 0;
        } else {
            logProgress("script_generation", 0, "Generating script");
            script = await generateScript(request, (msg: string) => {
                logProgress("script_generation", 10, msg);
            });
            timing["script_generation"] = Date.now() - phaseStart;
        }

        phaseStart = Date.now();
        logProgress("estimate_duration", 15, "Estimating duration");
        const estimated = estimateDuration(script, { language: request.language });
        if (estimated.totalDurationSec > request.targetDurationSec * 1.5) {
            throw new Error(
                `Estimated duration (${estimated.totalDurationSec}s) exceeds target (${request.targetDurationSec}s) by more than 50%`
            );
        }
        timing["estimate_duration"] = Date.now() - phaseStart;

        // phase 3: assemble html tam thoi de preview
        phaseStart = Date.now();
        logProgress("html_assembly", 20, "Assembling temporary HTML bundle");
        const tempAssembly = await assembleHTML(
            script,
            estimated.sceneDurations,
            preset.width,
            preset.height,
            workDir,
            (msg) => logProgress("html_assembly", 25, msg)
        );
        timing["html_assembly"] = Date.now() - phaseStart;

        // phase 4: generate preview thumbnails
        let previews: PreviewResult | undefined;
        if (!skipPreview) {
            phaseStart = Date.now();
            logProgress("preview", 30, "Generating scene preview screenshots");
            previews = await generatePreviews({
                htmlPath: tempAssembly.htmlPath,
                script,
                durations: estimated.sceneDurations,
                width: preset.width,
                height: preset.height,
                outputDir: join(workDir, "previews"),
                onProgress: (msg, prog) => {
                    const scaledProg = prog !== undefined ? Math.round(30 + (prog * 0.15)) : 35;
                    logProgress("preview", scaledProg, msg);
                },
            });
            timing["preview"] = Date.now() - phaseStart;
        }

        // phase 5: audio synthesis — TTS từng scene, duration đo bằng ffprobe là nguồn sự thật
        phaseStart = Date.now();
        logProgress("audio_synthesis", 45, "Synthesizing voice-over audio");
        const audio = await synthesizeAudio({
            script,
            outputDir: workDir,
            bgmPath,
            language: request.language,
            onProgress: (msg, prog) => {
                const scaledProg = prog !== undefined ? Math.round(45 + prog * 0.2) : 50;
                logProgress("audio_synthesis", scaledProg, msg);
            },
        });
        timing["audio_synthesis"] = Date.now() - phaseStart;

        // phase 6: re-assemble HTML với duration thực từ audio 
        phaseStart = Date.now();
        logProgress("html_assembly", 70, "Re-assembling HTML with actual durations");
        await assembleHTML(
            script,
            audio.scencesDuration,
            preset.width,
            preset.height,
            workDir,
            (msg) => logProgress("html_assembly", 75, msg)
        );
        timing["html_assembly"] = Date.now() - phaseStart;

        return {
            jobId,
            workDir,
            videoPath: join(workDir, "final_video.mp4"),
            durationSec: audio.totalDurationSec,
            scences: script.scenes,
            resolution: `${preset.width}x${preset.height}`,
            timing,
            preview: previews,
            audio,
            finalHtmlPath: join(workDir, "index.html"),
        };
    } catch (err: any) {
        logProgress("script_generation", 100, `Pipeline failed: ${err.message}`);
        throw err;
    }
}
