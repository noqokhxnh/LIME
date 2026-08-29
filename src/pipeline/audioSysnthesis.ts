import { execFile as execFileCb } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";
import { Config, getConfig } from "@/config";
import { AudioResult, durationMap, videoScript } from "@/llm/schema";
import { estimateTextDuration } from "./estimateDuration";

export interface TTSClient {
    readonly provider: string;
    synthesize(
        text: string,
        outputPath: string,
        options?: { voice?: string; language?: string; signal?: AbortSignal }
    ): Promise<void>;
}

// ---------------------------------------------------------------- Edge TTS

const EDGE_TTS_WS_URL =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const EDGE_TTS_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TTS_VERSION = "1-143.0.3650.75";

const DEFAULT_EDGE_VOICES: Record<string, string> = {
    vi: "vi-VN-HoaiMyNeural",
    en: "en-US-AriaNeural",
    ja: "ja-JP-NanamiNeural",
    ko: "ko-KR-SunHiNeural",
    zh: "zh-CN-XiaoxiaoNeural",
    fr: "fr-FR-DeniseNeural",
    de: "de-DE-KatjaNeural",
    es: "es-ES-ElviraNeural",
};

// Edge TTS token Sec-MS-GEC (thuật toán mới từ 2024): Windows file time epoch
// (1601-01-01), làm tròn xuống 5 phút, đơn vị 100ns, hash sha256 hex viết hoa, không salt.
// Số ~1.3e17 vượt quá độ chính xác của Number nên dùng BigInt.
function generateSecMsGecToken(): string {
    const ticks = Math.floor(Date.now() / 1000) + 11644473600;
    const roundedTicks = BigInt(ticks) - (BigInt(ticks) % 300n);
    const input = `${roundedTicks * 10_000_000n}${EDGE_TTS_CLIENT_TOKEN}`;
    return createHash("sha256").update(input).digest("hex").toUpperCase();
}

// Service không hỗ trợ một số control char (đặc biệt vertical tab từ text OCR) — thay bằng space
function sanitizeXmlText(text: string): string {
    return text
        .split("")
        .map((c) => {
            const code = c.charCodeAt(0);
            return code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) ? " " : c;
        })
        .join("")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function dateToString(): string {
    const d = new Date();
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const p = (n: number) => String(n).padStart(2, "0");
    return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

// Mọi frame gửi tới service đều là text frame dạng headers \r\n\r\n body
function buildSpeechConfigFrame(): string {
    return (
        `X-Timestamp:${dateToString()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
    );
}

function buildSsmlFrame(text: string, voice: string): string {
    return (
        `X-RequestId:${uuidv4()}\r\n` +
        "Content-Type:application/ssml+xml\r\n" +
        `X-Timestamp:${dateToString()}Z\r\n` +
        "Path:ssml\r\n\r\n" +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${sanitizeXmlText(text)}</prosody></voice></speak>`
    );
}

// Frame nhận về (text) cũng dạng headers \r\n\r\n body, Path: turn.start/response/audio.metadata/turn.end
function parseFrameHeaders(frame: string): { headers: Record<string, string>; body: string } {
    const sepIndex = frame.indexOf("\r\n\r\n");
    if (sepIndex === -1) {
        return { headers: {}, body: frame };
    }
    const headers: Record<string, string> = {};
    for (const line of frame.slice(0, sepIndex).split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon > 0) {
            headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1);
        }
    }
    return { headers, body: frame.slice(sepIndex + 4) };
}

function looksLikeEdgeVoice(name: string): boolean {
    return /^[a-z]{2,3}-[A-Z]{2,3}-[A-Za-z0-9]+Neural$/i.test(name);
}

function resolveEdgeVoice(configured: string | undefined, language: string): string {
    if (configured && looksLikeEdgeVoice(configured)) return configured;
    return DEFAULT_EDGE_VOICES[language.toLowerCase()] ?? DEFAULT_EDGE_VOICES["en"];
}

// Node's global WebSocket accepts a { headers } option, but the DOM lib type doesn't — type it locally
type EdgeWebSocket = {
    binaryType: string;
    onopen: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    send(data: string): void;
    close(): void;
};

const EdgeWebSocketImpl = globalThis.WebSocket as unknown as new (
    url: string,
    options?: { headers?: Record<string, string> }
) => EdgeWebSocket;

class EdgeTTSClient implements TTSClient {
    readonly provider = "edge";

    constructor(private readonly config: Config) {}

    async synthesize(
        text: string,
        outputPath: string,
        options?: { voice?: string; language?: string; signal?: AbortSignal }
    ): Promise<void> {
        const voice = resolveEdgeVoice(options?.voice ?? this.config.TTS_Voice, options?.language ?? "vi");
        const connectionId = uuidv4().replace(/-/g, "");
        const url =
            `${EDGE_TTS_WS_URL}?TrustedClientToken=${EDGE_TTS_CLIENT_TOKEN}` +
            `&ConnectionId=${connectionId}` +
            `&Sec-MS-GEC=${generateSecMsGecToken()}` +
            `&Sec-MS-GEC-Version=${EDGE_TTS_VERSION}`;

        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const ws = new EdgeWebSocketImpl(url, {
                headers: {
                    Pragma: "no-cache",
                    "Cache-Control": "no-cache",
                    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                    "Accept-Encoding": "gzip, deflate, br, zstd",
                    "Accept-Language": "en-US,en;q=0.9",
                    Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
                },
            });
            ws.binaryType = "arraybuffer";

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    ws.close();
                    reject(new Error("Edge TTS timeout"));
                }
            }, 60_000);

            ws.onopen = () => {
                ws.send(buildSpeechConfigFrame());
                ws.send(buildSsmlFrame(text, voice));
            };

            ws.onmessage = (event) => {
                const data = event.data;
                if (typeof data === "string") {
                    const { headers } = parseFrameHeaders(data);
                    if (headers["path"] === "turn.end") {
                        settled = true;
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                    return;
                }
                if (data instanceof ArrayBuffer) {
                    const buf = Buffer.from(data);
                    if (buf.length < 2) return;
                    // 2 byte đầu là độ dài header (big-endian); header đã gồm cả CRLF cuối,
                    // nên payload bắt đầu ngay tại 2 + headerLength (MP3 sync 0xFF ở đây)
                    const headerLength = buf.readUInt16BE(0);
                    const header = buf.subarray(2, 2 + headerLength).toString("utf-8");
                    if (!header.includes("Path:audio")) return;
                    chunks.push(buf.subarray(2 + headerLength));
                }
            };

            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error("Edge TTS WebSocket error"));
                }
            };

            ws.onclose = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error("Edge TTS connection closed before audio finished"));
                }
            };
        });

        if (chunks.length === 0) {
            throw new Error("Edge TTS returned no audio data");
        }
        writeFileSync(outputPath, Buffer.concat(chunks));
    }
}

// ---------------------------------------------------------------- OpenAI TTS

class OpenAITTSClient implements TTSClient {
    readonly provider = "openai";

    constructor(private readonly config: Config) {}

    async synthesize(
        text: string,
        outputPath: string,
        options?: { voice?: string; signal?: AbortSignal }
    ): Promise<void> {
        const apiKey = this.config.OpenAI_APIKEY;
        if (!apiKey) {
            throw new Error("OpenAI TTS requires OPENAI_API_KEY");
        }
        const res = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: this.config.OpenAI_TTS_Model || "tts-1",
                voice: options?.voice || this.config.TTS_Voice || "alloy",
                input: text,
                response_format: "mp3",
            }),
            signal: options?.signal,
        });
        if (!res.ok) {
            throw new Error(`OpenAI TTS error: ${res.status} - ${await res.text()}`);
        }
        writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
    }
}

// ---------------------------------------------------------------- Google TTS

const DEFAULT_GOOGLE_VOICES: Record<string, string> = {
    vi: "vi-VN-Standard-A",
    en: "en-US-Standard-C",
    ja: "ja-JP-Standard-A",
    ko: "ko-KR-Standard-A",
    zh: "zh-CN-Standard-A",
    fr: "fr-FR-Standard-A",
    de: "de-DE-Standard-A",
    es: "es-ES-Standard-A",
};

class GoogleTTSClient implements TTSClient {
    readonly provider = "google";

    constructor(private readonly config: Config) {}

    async synthesize(
        text: string,
        outputPath: string,
        options?: { voice?: string; language?: string; signal?: AbortSignal }
    ): Promise<void> {
        const apiKey = this.config.Google_TTS_APIKEY;
        if (!apiKey) {
            throw new Error("Google TTS requires GOOGLE_TTS_API_KEY");
        }
        const language = options?.language ?? "vi";
        const voice =
            options?.voice ??
            this.config.Google_TTS_Model ??
            DEFAULT_GOOGLE_VOICES[language.toLowerCase()] ??
            "en-US-Standard-C";

        const res = await fetch(
            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    input: { text },
                    voice: { languageCode: voice.split("-").slice(0, 2).join("-"), name: voice },
                    audioConfig: { audioEncoding: "MP3" },
                }),
                signal: options?.signal,
            }
        );
        if (!res.ok) {
            throw new Error(`Google TTS error: ${res.status} - ${await res.text()}`);
        }
        const data = (await res.json()) as { audioContent?: string };
        if (!data.audioContent) {
            throw new Error("Google TTS returned no audio content");
        }
        writeFileSync(outputPath, Buffer.from(data.audioContent, "base64"));
    }
}

// ---------------------------------------------------------------- ElevenLabs

class ElevenLabsTTSClient implements TTSClient {
    readonly provider = "elevenlabs";

    constructor(private readonly config: Config) {}

    async synthesize(
        text: string,
        outputPath: string,
        options?: { voice?: string; signal?: AbortSignal }
    ): Promise<void> {
        const apiKey = this.config.Elevenlabs_API_KEY;
        if (!apiKey) {
            throw new Error("ElevenLabs TTS requires ELEVENLABS_API_KEY");
        }
        const voiceId = this.config.Elevenlabs_Voice_ID || options?.voice || this.config.TTS_Voice;
        const res = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_multilingual_v2",
                }),
                signal: options?.signal,
            }
        );
        if (!res.ok) {
            throw new Error(`ElevenLabs TTS error: ${res.status} - ${await res.text()}`);
        }
        writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
    }
}

// ---------------------------------------------------------------- Factory

let _ttsClient: TTSClient | null = null;

export function getTTSClient(): TTSClient {
    if (!_ttsClient) {
        const config = getConfig();
        switch (config.TTS_Provider) {
            case "edge":
                _ttsClient = new EdgeTTSClient(config);
                break;
            case "openai":
                _ttsClient = new OpenAITTSClient(config);
                break;
            case "google":
                _ttsClient = new GoogleTTSClient(config);
                break;
            case "elevenlabs":
                _ttsClient = new ElevenLabsTTSClient(config);
                break;
            default:
                throw new Error(`Unsupported TTS provider: ${config.TTS_Provider}`);
        }
        console.log(`Using TTS: ${_ttsClient.provider}`);
    }
    return _ttsClient;
}

// ---------------------------------------------------------------- ffmpeg helpers

function probeDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));
                return;
            }
            resolve(Number(metadata?.format?.duration ?? 0));
        });
    });
}

function concatAudios(inputFiles: string[], outputPath: string): Promise<void> {
    if (inputFiles.length === 1) {
        copyFileSync(inputFiles[0], outputPath);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        for (const file of inputFiles) {
            command.input(file);
        }
        const filters: string[] = [];
        inputFiles.forEach((_, i) => {
            // đồng bộ sample rate + channel layout để concat không lỗi khi nguồn khác nhau
            filters.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`);
        });
        filters.push(
            `${inputFiles.map((_, i) => `[a${i}]`).join("")}concat=n=${inputFiles.length}:v=0:a=1[out]`
        );
        command
            .complexFilter(filters)
            .outputOptions(["-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100"])
            .on("end", () => resolve())
            .on("error", reject)
            .save(outputPath);
    });
}

function mixBgm(voicePath: string, bgmPath: string, outputPath: string, volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = ffmpeg().input(voicePath);
        // stream_loop -1 giúp nhạc nền ngắn hơn lời đọc vẫn kéo dài đến hết video
        command.input(bgmPath).inputOptions(["-stream_loop", "-1"]);
        command
            .complexFilter([
                `[1:a]volume=${volume}[bgm]`,
                `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
            ])
            .outputOptions(["-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k"])
            .on("end", () => resolve())
            .on("error", reject)
            .save(outputPath);
    });
}

const execFile = promisify(execFileCb);

// fluent-ffmpeg 2.x không nhận dạng format lavfi trên FFmpeg 8 (parser -formats
// không hiểu cột cờ "device" mới) nên chạy ffmpeg trực tiếp cho trường hợp này
async function generateSilence(outputPath: string, durationSec: number): Promise<void> {
    await execFile("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-t", durationSec.toFixed(2),
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        outputPath,
    ]);
}

// ---------------------------------------------------------------- Main

export interface AudioSynthesisOptions {
    script: videoScript;
    outputDir: string;
    bgmPath?: string;
    voice?: string;
    language?: string;
    bgmVolume?: number;
    onProgress?: (message: string, progress?: number) => void;
    signal?: AbortSignal;
}

/**
 * TTS từng scene (tuần tự để tránh rate limit), đo duration thực bằng ffprobe,
 * nối thành track hoàn chỉnh rồi trộn nhạc nền (nếu có).
 * sceneDurations từ đây là nguồn sự thật cho timing animation.
 */
export async function synthesizeAudio(options: AudioSynthesisOptions): Promise<AudioResult> {
    const { script, outputDir, bgmPath, voice, language = "vi", bgmVolume = 0.15, onProgress, signal } = options;

    if (script.scenes.length === 0) {
        throw new Error("Script has no scenes to synthesize");
    }
    mkdirSync(outputDir, { recursive: true });
    const audioDir = join(outputDir, "audio");
    mkdirSync(audioDir, { recursive: true });

    const tts = getTTSClient();
    const audioFiles: Record<string, string> = {};
    const sceneDurations: durationMap = {};
    const total = script.scenes.length;

    for (let i = 0; i < total; i++) {
        if (signal?.aborted) {
            throw new DOMException("Audio synthesis aborted", "AbortError");
        }
        const scene = script.scenes[i];
        const sceneAudioPath = join(audioDir, `${scene.id}.mp3`);
        const text = scene.voiceOverText.trim();

        onProgress?.(`[TTS] Scene ${i + 1}/${total} "${scene.title}" — đang tổng hợp giọng đọc`, Math.round((i / total) * 80));

        if (!text) {
            const silenceDuration = estimateTextDuration(scene.voiceOverText, { language });
            onProgress?.(`[TTS] Scene "${scene.title}" không có lời thoại — tạo đoạn im lặng ${silenceDuration}s`);
            await generateSilence(sceneAudioPath, silenceDuration);
        } else {
            await tts.synthesize(text, sceneAudioPath, { voice, language, signal });
        }

        const durationSec = await probeDuration(sceneAudioPath);
        if (!durationSec || durationSec <= 0) {
            throw new Error(`Không đo được duration audio của scene "${scene.id}"`);
        }
        sceneDurations[scene.id] = Math.round(durationSec * 100) / 100;
        audioFiles[scene.id] = sceneAudioPath;
        onProgress?.(
            `[TTS] Scene "${scene.title}": ${sceneDurations[scene.id]}s`,
            Math.round(((i + 1) / total) * 80)
        );
    }

    onProgress?.("Đang nối các đoạn âm thanh thành track hoàn chỉnh", 85);
    const fullVoicePath = join(outputDir, "full_voice.mp3");
    await concatAudios(
        script.scenes.map((s) => audioFiles[s.id]),
        fullVoicePath
    );

    let mixAudioPath = fullVoicePath;
    if (bgmPath) {
        if (!existsSync(bgmPath)) {
            onProgress?.(`[BGM] Không tìm thấy file nhạc nền: ${bgmPath} — bỏ qua`);
        } else {
            onProgress?.(`[BGM] Đang trộn nhạc nền (volume ${bgmVolume})`, 92);
            mixAudioPath = join(outputDir, "final_mix.mp3");
            await mixBgm(fullVoicePath, bgmPath, mixAudioPath, bgmVolume);
        }
    }

    const totalDurationSec =
        Math.round(Object.values(sceneDurations).reduce((acc, d) => acc + d, 0) * 100) / 100;
    onProgress?.("Hoàn tất tổng hợp âm thanh", 100);

    return {
        scencesDuration: sceneDurations,
        audioFiles,
        totalDurationSec,
        mixAudioPath,
    };
}
