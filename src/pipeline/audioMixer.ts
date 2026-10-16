import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

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
