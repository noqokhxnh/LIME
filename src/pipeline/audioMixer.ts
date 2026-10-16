import { execFile as execFileCb } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { generateSyntheticImpulseResponse } from "./sfxSynth.js";

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
            "-filter_complex", `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[dry];[dry][1:a]afir=dry=${dry}:wet=${wet}[out]`,
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
