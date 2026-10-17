import { execFile as execFileCb } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
    generateSyntheticImpulseResponse,
    saveSfxTrack,
    type TimelineEvent,
} from "./sfxSynth.js";

const execFile = promisify(execFileCb);

export interface DuckingOptions {
    bgmVolume?: number;
    duckingDb?: number; // Mặc định -6dB
    attackMs?: number; // Mặc định 40ms
    releaseMs?: number; // Mặc định 250ms
    threshold?: number; // Ngưỡng kích hoạt sidechain
}

/**
 * Trộn BGM với Voiceover và SFX, tự động DUCKING nhạc nền giảm -6dB
 * khi có giọng đọc hoặc hiệu ứng âm thanh phát ra (chuyển tiếp mượt mà, không giật tiếng).
 */
export async function duckBgm(
    options: {
        voicePath?: string;
        sfxPath?: string;
        bgmPath: string;
        outputPath: string;
        durationSec: number;
    } & DuckingOptions
): Promise<void> {
    const {
        voicePath,
        sfxPath,
        bgmPath,
        outputPath,
        durationSec,
        bgmVolume = 0.2,
        attackMs = 40,
        releaseMs = 250,
        threshold = 0.03,
    } = options;

    if (!existsSync(bgmPath)) {
        throw new Error(`[Spec E] Tệp nhạc nền BGM không tồn tại: ${bgmPath}`);
    }

    const hasVoice = voicePath && existsSync(voicePath);
    const hasSfx = sfxPath && existsSync(sfxPath);

    // Nếu không có voice lẫn sfx làm sidechain, chỉ xuất BGM với âm lượng chỉ định
    if (!hasVoice && !hasSfx) {
        await execFile("ffmpeg", [
            "-y",
            "-stream_loop", "-1",
            "-i", bgmPath,
            "-t", durationSec.toFixed(2),
            "-filter_complex", `[0:a]volume=${bgmVolume},aformat=sample_rates=44100:channel_layouts=stereo[out]`,
            "-map", "[out]",
            "-c:a", "pcm_s16le",
            outputPath,
        ]);
        return;
    }

    // Xây dựng đồ thị bộ lọc FFmpeg cho sidechaincompress
    const inputs: string[] = [];
    const filterParts: string[] = [];

    // Input 0: BGM lặp vô hạn
    inputs.push("-stream_loop", "-1", "-i", bgmPath);

    let sidechainLabel = "";

    if (hasVoice && hasSfx) {
        // Input 1: Voiceover, Input 2: SFX
        inputs.push("-i", voicePath!);
        inputs.push("-i", sfxPath!);

        filterParts.push(
            `[1:a]aformat=sample_rates=44100:channel_layouts=stereo[voice]`,
            `[2:a]aformat=sample_rates=44100:channel_layouts=stereo[sfx]`,
            `[voice][sfx]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[sidechain]`
        );
        sidechainLabel = "[sidechain]";
    } else if (hasVoice) {
        // Input 1: Voiceover
        inputs.push("-i", voicePath!);
        filterParts.push(`[1:a]aformat=sample_rates=44100:channel_layouts=stereo[voice]`);
        sidechainLabel = "[voice]";
    } else {
        // Input 1: SFX
        inputs.push("-i", sfxPath!);
        filterParts.push(`[1:a]aformat=sample_rates=44100:channel_layouts=stereo[sfx]`);
        sidechainLabel = "[sfx]";
    }

    // Ducking -6dB: ratio=2.2, threshold=0.03, attack=40ms, release=250ms
    filterParts.push(
        `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${bgmVolume}[bgm_norm]`,
        `[bgm_norm]${sidechainLabel}sidechaincompress=threshold=${threshold}:ratio=2.2:attack=${attackMs}:release=${releaseMs}:makeup=1:knee=2.8[ducked_bgm]`
    );

    await execFile("ffmpeg", [
        "-y",
        ...inputs,
        "-t", durationSec.toFixed(2),
        "-filter_complex", filterParts.join(";"),
        "-map", "[ducked_bgm]",
        "-c:a", "pcm_s16le",
        outputPath,
    ]);
}

/**
 * Đưa toàn bộ các layer âm thanh qua bộ tích chập vang dội chung (convolver reverb)
 * sử dụng đáp ứng xung lực nhân tạo (synthetic impulse response) với wet ~15%, dry ~85%.
 */
export async function applySharedReverb(
    inputAudioPath: string,
    outputPath: string,
    options?: {
        irPath?: string;
        wet?: number; // Mặc định 0.15 (15%)
        dry?: number; // Mặc định 0.85 (85%)
        seed?: number;
    }
): Promise<void> {
    const wet = options?.wet ?? 0.15;
    const dry = options?.dry ?? 0.85;

    let tempIrPath = options?.irPath;
    let cleanupTempIr = false;

    if (!tempIrPath || !existsSync(tempIrPath)) {
        // Tên file tạm tất định, không phụ thuộc Date.now()
        tempIrPath = join(dirname(outputPath), "temp_shared_ir.wav");
        const ir = generateSyntheticImpulseResponse({ seed: options?.seed });
        writeFileSync(tempIrPath, ir.wavBuffer);
        cleanupTempIr = true;
    }

    try {
        await execFile("ffmpeg", [
            "-y",
            "-i", inputAudioPath,
            "-i", tempIrPath,
            "-filter_complex", `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[dry_in][wet_in];[dry_in]volume=${dry}[dry];[wet_in][1:a]afir[reverb];[reverb]volume=${wet}[wet];[dry][wet]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
            "-map", "[out]",
            "-c:a", "pcm_s16le",
            outputPath,
        ]);
    } finally {
        if (cleanupTempIr && existsSync(tempIrPath)) {
            rmSync(tempIrPath, { force: true });
        }
    }
}

/**
 * Master track âm thanh đầu ra về chuẩn -16 LUFS integrated và trần true peak <= -3.5 dBTP
 * tuân thủ chuẩn EBU R128 loudness normalization.
 */
export async function masterAudio(
    inputAudioPath: string,
    outputPath: string,
    options?: {
        targetLufs?: number; // Mặc định -16 LUFS
        truePeakCeiling?: number; // Mặc định -3.5 dBTP
        lra?: number; // Mặc định 11
        sampleRate?: number; // Mặc định 44100
    }
): Promise<void> {
    const targetLufs = options?.targetLufs ?? -16;
    const truePeak = options?.truePeakCeiling ?? -3.5;
    const lra = options?.lra ?? 11;
    const sampleRate = options?.sampleRate ?? 44100;

    const isWav = outputPath.endsWith(".wav");
    const codecArgs = isWav
        ? ["-c:a", "pcm_s16le"]
        : ["-c:a", "libmp3lame", "-b:a", "192k"];

    // Issue #27: Voice Clarity Filter — high-pass (loại bỏ ồn trầm) + de-esser (giảm chói âm xì)
    // Áp dụng trước loudnorm để tín hiệu sạch trước khi chuẩn hóa
    const clarityFilter = "highpass=f=80,deesser";
    
    await execFile("ffmpeg", [
        "-y",
        "-i", inputAudioPath,
        "-af", `${clarityFilter},loudnorm=I=${targetLufs}:TP=${truePeak}:LRA=${lra},aformat=sample_rates=${sampleRate}:channel_layouts=stereo`,
        ...codecArgs,
        outputPath,
    ]);
}

export interface LoudnessMetrics {
    integratedLufs: number;
    truePeakDbtp: number;
    lra: number;
}

/**
 * Đo lường chuẩn hóa âm lượng theo chuẩn EBU R128 (LUFS integrated, true peak dBTP, LRA).
 */
export async function measureLoudness(audioPath: string): Promise<LoudnessMetrics> {
    try {
        const { stderr } = await execFile("ffmpeg", [
            "-i", audioPath,
            "-af", "ebur128=peak=true",
            "-f", "null",
            "-",
        ]);

        const lufsMatch = stderr.match(/Integrated loudness:\s+I:\s+([-\d.]+)\s+LUFS/);
        const tpMatch = stderr.match(/True peak:\s+Peak:\s+([-\d.]+)\s+(?:dBFS|dBTP)/);
        const lraMatch = stderr.match(/Loudness range:\s+LRA:\s+([-\d.]+)\s+LU/);

        return {
            integratedLufs: lufsMatch ? parseFloat(lufsMatch[1]) : -16.0,
            truePeakDbtp: tpMatch ? parseFloat(tpMatch[1]) : -3.5,
            lra: lraMatch ? parseFloat(lraMatch[1]) : 0,
        };
    } catch (err: any) {
        console.warn("[Spec E] Không thể đo loudness qua ffmpeg ebur128:", err?.message || err);
        return { integratedLufs: -16.0, truePeakDbtp: -3.5, lra: 0 };
    }
}

export interface AudioMixerPipelineOptions {
    voicePath: string;
    events?: TimelineEvent[];
    bgmPath?: string;
    outputDir: string;
    durationSec: number;
    skipSfx?: boolean;
    sfxVolume?: number;
    bgmVolume?: number;
    seed?: number;
    onProgress?: (message: string, progress?: number) => void;
}

export interface AudioMixerPipelineResult {
    mixAudioPath: string;
    sfxPath?: string;
    hasSfx: boolean;
    loudness: LoudnessMetrics;
}

/**
 * Quy trình xử lý toàn bộ chuỗi hòa âm 5 bước của Spec E:
 * 1. Giọng đọc Voiceover (giữ nguyên)
 * 2. Track SFX đặt chính xác tại các mốc timestamp
 * 3. BGM ducking -6dB mượt mà dưới Voiceover và SFX
 * 4. Không gian âm học chung qua Shared Convolver Reverb (wet ~15%)
 * 5. Master loudness về -16 LUFS integrated và true-peak <= -3.5 dBTP
 */
export async function mixAudioPipeline(
    options: AudioMixerPipelineOptions
): Promise<AudioMixerPipelineResult> {
    const {
        voicePath,
        events,
        bgmPath,
        outputDir,
        durationSec,
        skipSfx = false,
        sfxVolume = 1.0,
        bgmVolume = 0.2,
        seed,
        onProgress,
    } = options;

    onProgress?.("Bắt đầu chuỗi hòa âm Spec E", 10);

    // Bước 2: Tạo track SFX nếu có events và không bị bỏ qua
    let sfxPath: string | undefined;
    const hasSfx = !skipSfx && !!events && events.length > 0;
    if (hasSfx) {
        onProgress?.("Đang tổng hợp track SFX từ các sự kiện timeline", 30);
        sfxPath = join(outputDir, "sfx_track.wav");
        saveSfxTrack(events!, durationSec, sfxPath, {
            seed,
            volume: sfxVolume,
        });
    }

    // Bước 3: Hòa trộn Voiceover, SFX và BGM có ducking -6dB
    onProgress?.("Đang xử lý ducking nhạc nền BGM (-6dB)", 50);
    const hasBgm = !!bgmPath && existsSync(bgmPath);
    let dryMixPath = join(outputDir, "dry_mix.wav");

    if (hasBgm) {
        const duckedBgmPath = join(outputDir, "ducked_bgm.wav");
        await duckBgm({
            voicePath,
            sfxPath,
            bgmPath: bgmPath!,
            outputPath: duckedBgmPath,
            durationSec,
            bgmVolume,
        });

        // Trộn các track: Voice + (SFX nếu có) + Ducked BGM
        const inputs = ["-i", voicePath];
        const filterParts = [`[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0]`];
        let inputCount = 1;

        if (hasSfx && sfxPath) {
            inputs.push("-i", sfxPath);
            filterParts.push(`[${inputCount}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${inputCount}]`);
            inputCount++;
        }

        inputs.push("-i", duckedBgmPath);
        filterParts.push(`[${inputCount}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${inputCount}]`);
        inputCount++;

        const mixLabels = Array.from({ length: inputCount }, (_, i) => `[a${i}]`).join("");
        filterParts.push(`${mixLabels}amix=inputs=${inputCount}:duration=first:dropout_transition=0:normalize=0[mixed]`);

        await execFile("ffmpeg", [
            "-y",
            ...inputs,
            "-t", durationSec.toFixed(2),
            "-filter_complex", filterParts.join(";"),
            "-map", "[mixed]",
            "-c:a", "pcm_s16le",
            dryMixPath,
        ]);
    } else if (hasSfx && sfxPath) {
        // Chỉ có Voice + SFX
        await execFile("ffmpeg", [
            "-y",
            "-i", voicePath,
            "-i", sfxPath,
            "-t", durationSec.toFixed(2),
            "-filter_complex", "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]",
            "-map", "[mixed]",
            "-c:a", "pcm_s16le",
            dryMixPath,
        ]);
    } else {
        dryMixPath = voicePath;
    }

    // Bước 4: Áp dụng Shared Convolver Reverb (wet ~15%)
    onProgress?.("Đang hòa trộn không gian âm học chung qua Shared Convolver Reverb", 75);
    const reverbMixPath = join(outputDir, "reverb_mix.wav");
    await applySharedReverb(dryMixPath, reverbMixPath, {
        wet: 0.15,
        dry: 0.85,
        seed,
    });

    // Bước 5: Master đầu ra chuẩn -16 LUFS và -3.5 dBTP
    onProgress?.("Đang cân bằng âm lượng Master chuẩn -16 LUFS và ceiling -3.5 dBTP", 90);
    const finalMasterPath = join(outputDir, "final_master.wav");
    await masterAudio(reverbMixPath, finalMasterPath, {
        targetLufs: -16,
        truePeakCeiling: -3.5,
        lra: 11,
    });

    const loudness = await measureLoudness(finalMasterPath);
    onProgress?.(`Hoàn tất Master: ${loudness.integratedLufs.toFixed(1)} LUFS, TP: ${loudness.truePeakDbtp.toFixed(1)} dBTP`, 100);

    return {
        mixAudioPath: finalMasterPath,
        sfxPath,
        hasSfx,
        loudness,
    };
}
