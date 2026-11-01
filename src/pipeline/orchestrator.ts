import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 } from "uuid";
import { videoPreset, resolveResolution } from "@/config";
import { videoRequest, pipelineResult, pipelineProgess, progressCallback, pipelinePhase, videoScript, AudioResult, checkRhythm } from "@/llm/schema";
import { generateScript } from "./scriptGenerator";
import { estimateDuration } from "./estimateDuration";
import { assembleHTML } from "./assembleHtml.js";
import { buildSceneImageMap } from "./footage.js";
import { generatePreviews, PreviewResult } from "./preview";
import { synthesizeAudio } from "./audioSysnthesis.js";
import { renderVideo } from "./renderer.js";
import { hashString32, parseSeedSafe } from "./rng.js";
import { runOracleQa, type QAReport, type DOMSampler, type BatchDOMSampler, type AudioStats } from "./oracleQa.js";
import { extractTimelineEventsFromHtml } from "./sfxSynth.js";
import { mixAudioPipeline } from "./audioMixer.js";

export interface orchestratorOptions {
    request: videoRequest;
    script?: videoScript;
    bgmPath?: string;
    skipPreview?: boolean;
    skipRender?: boolean;
    skipQa?: boolean;
    forceRender?: boolean;
    requireApprovalOnWarn?: boolean;
    maxQaAttempts?: number;
    onProgress?: progressCallback;
    outputDir?: string;
    jobId?: string;
    seed?: number;
    domSampler?: DOMSampler;
    batchDomSampler?: BatchDOMSampler;
    audioAnalyzer?: (audioPath: string) => Promise<AudioStats>;
    /**
     * Bỏ qua hiệu ứng shutter motion blur trong khâu render (Spec D)
     */
    skipShutterBlur?: boolean;
    /**
     * Số lượng mẫu sub-frame (K) cho shutter motion blur (Spec D, mặc định 8)
     */
    shutterSamples?: number;
    /**
     * Bỏ qua track SFX trong chuỗi hòa âm (Spec E)
     */
    skipSfx?: boolean;
    /**
     * Âm lượng track SFX (Spec E)
     */
    sfxVolume?: number;
    /**
     * Biến vi phạm lint GSAP (#41) thành fail thay vì warn-only. Mặc định tắt
     * trong giai đoạn hiệu chuẩn; env `LIME_GSAP_LINT_STRICT=1` cũng bật.
     */
    gsapLintStrict?: boolean;
    /**
     * Biến vi phạm bố cục (#111) thành fail thay vì warn-only. Mặc định tắt;
     * env `LIME_COMPOSITION_STRICT=1` cũng bật.
     */
    compositionStrict?: boolean;
}

export interface fullPipelineResult extends pipelineResult {
    jobId: string;
    seed: number;
    workDir: string;
    preview?: PreviewResult;
    audio: AudioResult;
    finalHtmlPath: string;
    timing: Record<string, number>;
    qaStatus?: 'pass' | 'warn' | 'fail' | 'skipped' | 'qa_failed';
    qaReport?: QAReport;
}

export async function runFullPipeline(option: orchestratorOptions): Promise<fullPipelineResult> {
    const { request, script: inputScript, bgmPath, skipPreview, onProgress, outputDir } = option;

    const jobId = option.jobId ?? v4();
    const defaultSeed = hashString32(jobId);
    const seed = parseSeedSafe(option.seed ?? request.seed, defaultSeed);
    const workDir = outputDir ?? join(process.cwd(), "tmp", `job-${jobId}`);

    if (existsSync(workDir)) {
        rmSync(workDir, { recursive: true, force: true });
    }

    const preset = resolveResolution(request.aspectRatio, request.format);
    const fps = 30;
    const timing: Record<string, number> = {};
    const startTime = Date.now();

    const logProgress = (phase: pipelinePhase, progress: number, msg: string) => {
        onProgress?.({ phase, progress, message: msg });
        timing[phase] = Date.now() - startTime;
    };
    mkdirSync(workDir, { recursive: true });

    const maxQaAttempts = inputScript ? 1 : (option.maxQaAttempts ?? 3);
    let attempt = 1;
    let qaFeedback: string | undefined = undefined;
    let qaReport: QAReport | undefined;
    let qaStatus: 'pass' | 'warn' | 'fail' | 'skipped' | undefined;
    let currentSeed = seed;

    let script: videoScript = inputScript!;
    let previews: PreviewResult | undefined;
    let audio: AudioResult | undefined;

    // phase 1: gen script
    // phase 2: estimate duration
    // phase 3: assemble html tam thoi de preview
    // phase 4: show screen shot
    // phase 5: audio synthesis
    // phase 6: re-assemble html with actual duration
    // phase 4.5: oracle QA (validate before expensive rendering)
    // phase 7: render video
    // phase 8: mux final mp4
    try {
        while (attempt <= maxQaAttempts) {
            currentSeed = attempt === 1 ? seed : parseSeedSafe(seed + attempt - 1, seed + attempt - 1);

            let phaseStart = Date.now();
            if (inputScript) {
                logProgress("script_generation", 10, "Sử dụng kịch bản đã có sẵn");
                script = inputScript;
                timing["script_generation"] = 0;
            } else {
                logProgress("script_generation", 0, attempt === 1 ? "Generating script" : `Đang tạo lại kịch bản (Lần thử ${attempt}/${maxQaAttempts})`);
                script = await generateScript(
                    request,
                    (msg: string) => {
                        logProgress("script_generation", 10, msg);
                    },
                    qaFeedback
                );
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

            // phase 2.5: footage — gắn ảnh stock thật cho scene có footageQuery.
            // Chưa cấu hình PIXABAY_API_KEY hoặc API lỗi thì imageMap rỗng, job chạy như cũ.
            let imageMap: Record<string, string[]> = {};
            try {
                imageMap = await buildSceneImageMap(script, {
                    orientation: preset.width >= preset.height ? "horizontal" : "vertical",
                    onProgress: (msg) => logProgress("html_assembly", 18, msg),
                });
            } catch (footageErr: any) {
                logProgress("html_assembly", 18, `Warning: footage fetch skipped: ${footageErr?.message || footageErr}`);
            }

            // phase 3: assemble html tam thoi de preview
            phaseStart = Date.now();
            logProgress("html_assembly", 20, "Assembling temporary HTML bundle");
            const tempAssembly = await assembleHTML(
                script,
                estimated.sceneDurations,
                preset.width,
                preset.height,
                workDir,
                (msg) => logProgress("html_assembly", 25, msg),
                {
                    seed: currentSeed,
                    jobId,
                    format: request.format,
                    safeArea: request.safeArea,
                    karaoke: request.karaoke,
                    imageMap,
                }
            );
            timing["html_assembly"] = Date.now() - phaseStart;

            // phase 4: generate preview thumbnails
            if (!skipPreview) {
                phaseStart = Date.now();
                logProgress("preview", 30, "Generating scene preview screenshots");
                try {
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
                } catch (previewErr: any) {
                    logProgress("preview", 35, `Warning: Scene preview generation skipped: ${previewErr?.message || previewErr}`);
                }
                timing["preview"] = Date.now() - phaseStart;
            }

            // phase 5: audio synthesis — TTS từng scene, duration đo bằng ffprobe là nguồn sự thật
            phaseStart = Date.now();
            logProgress("audio_synthesis", 45, "Synthesizing voice-over audio");
            audio = await synthesizeAudio({
                script,
                outputDir: workDir,
                bgmPath: undefined, // BGM được hòa âm ở bước mixAudioPipeline với Ducking & Reverb
                voice: request.voice,
                ttsProvider: request.ttsProvider,
                language: request.language,
                targetDurationSec: request.targetDurationSec,
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
                (msg) => logProgress("html_assembly", 75, msg),
                {
                    seed: currentSeed,
                    jobId,
                    wordTimings: audio.wordTimings,
                    format: request.format,
                    safeArea: request.safeArea,
                    karaoke: request.karaoke,
                    imageMap,
                }
            );
            timing["html_assembly"] = Date.now() - phaseStart;

            // phase 6.5: Spec E - Chuỗi hòa âm 5 bước (Voice, SFX, BGM Ducking -6dB, Reverb, Master -16 LUFS)
            phaseStart = Date.now();
            logProgress("audio_synthesis", 76, "Đang hòa âm chuỗi Spec E (SFX, Ducking BGM, Shared Reverb, Master LUFS)");

            let events: any[] = [];
            if (!option.skipSfx) {
                try {
                    events = await extractTimelineEventsFromHtml(join(workDir, "index.html"));
                } catch (evtErr: any) {
                    console.warn(`[Orchestrator] Không thể trích xuất events từ HTML: ${evtErr?.message || evtErr}`);
                    events = [];
                }
            }

            const voicePath = existsSync(join(workDir, "full_voice.mp3"))
                ? join(workDir, "full_voice.mp3")
                : audio.mixAudioPath;

            const mixerResult = await mixAudioPipeline({
                voicePath,
                events,
                bgmPath,
                outputDir: workDir,
                durationSec: audio.totalDurationSec,
                skipSfx: option.skipSfx,
                sfxVolume: option.sfxVolume,
                seed: currentSeed,
                onProgress: (msg) => {
                    logProgress("audio_synthesis", 76, msg);
                },
            });

            audio.mixAudioPath = mixerResult.mixAudioPath;
            audio.sfxPath = mixerResult.sfxPath;
            audio.hasSfx = mixerResult.hasSfx;
            audio.loudness = mixerResult.loudness;
            timing["audio_mix"] = Date.now() - phaseStart;

            // Phase 4.5: Oracle QA (Kiểm định chất lượng tự động trước render)
            if (option.skipQa) {
                qaStatus = 'skipped';
                logProgress("oracle_qa", 78, "Bỏ qua kiểm định chất lượng Oracle QA theo cấu hình skipQa");
            } else {
                phaseStart = Date.now();
                logProgress("oracle_qa", 77, `Đang chạy kiểm định chất lượng Oracle QA (Lần thử ${attempt}/${maxQaAttempts})`);

                qaReport = await runOracleQa({
                    script,
                    htmlPath: join(workDir, "index.html"),
                    audioResult: audio,
                    width: preset.width,
                    height: preset.height,
                    fps,
                    seed: currentSeed,
                    jobId,
                    attempt,
                    domSampler: option.domSampler,
                    batchDomSampler: option.batchDomSampler,
                    audioAnalyzer: option.audioAnalyzer,
                    hasShutterBlur: option.skipShutterBlur ? false : undefined,
                    tempo: request.tempo,
                    targetDurationSec: request.targetDurationSec,
                    gsapLintStrict: option.gsapLintStrict,
                    compositionStrict: option.compositionStrict,
                });
                timing["oracle_qa"] = Date.now() - phaseStart;
                qaStatus = qaReport.qaStatus;

                /** Ghi qa_report.json để nội dung luôn khớp với kết luận cuối cùng. */
                const persistQaReport = () => {
                    try {
                        writeFileSync(
                            join(workDir, "qa_report.json"),
                            JSON.stringify(qaReport, null, 2),
                            "utf-8"
                        );
                    } catch (reportErr: any) {
                        console.warn(`[Orchestrator] Không thể ghi file qa_report.json: ${reportErr.message}`);
                    }
                };

                persistQaReport();

                if (qaStatus === 'fail') {
                    if (attempt < maxQaAttempts && !inputScript) {
                        qaFeedback = qaReport.errors.join("; ");
                        const retryMsg = `[Oracle QA Thất bại] Lần thử ${attempt}/${maxQaAttempts} không đạt: ${qaFeedback}. Đang tự động tạo lại kịch bản với seed mới ${currentSeed + 1}...`;
                        console.warn(`[Orchestrator] ${retryMsg}`);
                        logProgress("oracle_qa", 78, retryMsg);
                        attempt++;
                        continue;
                    } else {
                        // Hết số lần retry: vẫn render tiếp để người dùng có video, nhưng
                        // KHÔNG hạ cấp kết luận — báo cáo giữ nguyên 'fail' / valid: false và
                        // được đánh dấu degraded để lộ rõ đây là bản render suy giảm chất lượng.
                        // Nhờ vậy job vẫn vào trạng thái qa_failed (admin thấy và retry được)
                        // mà vẫn có file video để đối chiếu.
                        const degradeMsg = `[Oracle QA] Kịch bản không đạt chuẩn sau ${attempt} lần thử: ${qaReport.errors.join("; ")}. Vẫn render tiếp ở dạng suy giảm chất lượng (degraded).`;
                        console.warn(`[Orchestrator] ${degradeMsg}`);
                        logProgress("oracle_qa", 79, degradeMsg);
                        qaStatus = "fail";
                        qaReport.degraded = true;
                        qaReport.warnings = [
                            ...(qaReport.warnings || []),
                            `[QA retry exhausted] Đã render tiếp dù QA thất bại sau ${attempt} lần thử.`,
                        ];
                        persistQaReport();
                        break;
                    }
                } else if (qaStatus === 'warn') {
                    const warnMsg = `[Oracle QA Cảnh báo] Kịch bản đạt nhưng có lưu ý: ${qaReport.warnings.join("; ")}`;
                    console.warn(`[Orchestrator] ${warnMsg}`);
                    logProgress("oracle_qa", 78, warnMsg);

                    if (option.requireApprovalOnWarn && !option.forceRender) {
                        logProgress("oracle_qa", 79, "Kịch bản có cảnh báo: Chờ người dùng phê duyệt trước khi render video");
                        return {
                            jobId,
                            seed: currentSeed,
                            workDir,
                            videoPath: "",
                            durationSec: audio.totalDurationSec,
                            scences: script.scenes,
                            resolution: `${preset.width}x${preset.height}`,
                            timing,
                            preview: previews,
                            audio,
                            finalHtmlPath: join(workDir, "index.html"),
                            qaStatus: 'warn',
                            qaReport,
                        };
                    } else {
                        logProgress("oracle_qa", 78, `Hoàn tất Oracle QA: ĐẠT CÓ LƯU Ý (Carry score: ${Math.round(qaReport.carryScore * 100)}%)`);
                    }
                } else {
                    logProgress("oracle_qa", 78, `Hoàn tất Oracle QA: ĐẠT CHUẨN (Carry score: ${Math.round(qaReport.carryScore * 100)}%)`);
                }
            }

            // Kịch bản đạt yêu cầu hoặc đã vượt qua kiểm định QA, thoát vòng lặp retry
            break;
        }

        // phase 7: render video frames & mux final MP4
        const videoPath = join(workDir, "final_video.mp4");
        if (!option.skipRender) {
            let phaseStart = Date.now();
            logProgress("render", 80, "Rendering video frames and muxing MP4");
            await renderVideo({
                htmlPath: join(workDir, "index.html"),
                audioPath: audio!.mixAudioPath,
                outputPath: videoPath,
                width: preset.width,
                height: preset.height,
                fps,
                durationSec: audio!.totalDurationSec,
                onProgress: (msg, pct) => {
                    const scaled = pct !== undefined ? Math.round(80 + pct * 0.19) : 85;
                    logProgress("render", scaled, msg);
                },
                watermark: request.watermark,
                skipShutterBlur: option.skipShutterBlur,
                shutterSamples: option.shutterSamples,
                seed: currentSeed,
            });
            timing["render"] = Date.now() - phaseStart;
        }

        return {
            jobId,
            seed: currentSeed,
            workDir,
            videoPath,
            durationSec: audio!.totalDurationSec,
            scences: script.scenes,
            resolution: `${preset.width}x${preset.height}`,
            timing,
            preview: previews,
            audio: audio!,
            finalHtmlPath: join(workDir, "index.html"),
            qaStatus: qaStatus ?? (option.skipQa ? 'skipped' : 'pass'),
            qaReport,
        };
    } catch (err: any) {
        logProgress("script_generation", 100, `Pipeline failed: ${err.message}`);
        throw err;
    }
}
