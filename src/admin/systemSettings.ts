import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config.js";
import { db } from "../database/index.js";
import { setLLMClient, resetLLMClient } from "../llm/client.js";
import { resetTTSClient } from "../pipeline/audioSysnthesis.js";

export interface SystemSettings {
    maintenanceMode: boolean;
    registrationEnabled: boolean;
    defaultLlmProvider: string;
    defaultLlmModel?: string;
    defaultTtsProvider: string;
    defaultTtsVoice?: string;
    freeCreditsOnRegister: number;
    maxConcurrentJobs: number;
    allowSandboxPayments: boolean;
    systemNotice: string;
    updatedAt: string;
    updatedBy?: string;
}

const SETTINGS_FILE = join(process.cwd(), "data", "admin-settings.json");
const isTestEnv = process.env.NODE_ENV === "test" || process.argv.some((arg) => arg.includes("test"));

export function getDefaultModelForProvider(provider: string): string {
    const config = getConfig();
    switch (provider?.toLowerCase()) {
        case "9router":
            return config.NineRouter_Model || "ag/gemini-3.8-flash-high";
        case "deepseek":
            return config.DeepSeek_Model || "deepseek-chat";
        case "gemini":
            return config.Gemini_Model || "gemini-2.5-pro";
        case "openai":
            return config.OpenAI_Model || "gpt-4o";
        case "claude":
            return config.Claude_Model || "claude sonnet 4.5";
        default:
            return "deepseek-chat";
    }
}

export function getDefaultVoiceForProvider(provider: string): string {
    const config = getConfig();
    switch (provider?.toLowerCase()) {
        case "edge":
            return "vi-VN-HoaiMyNeural";
        case "vieneu":
            return "Minh Quân";
        case "elevenlabs":
            return config.Elevenlabs_Voice_ID || "CQAD6iKxS73fEAGjSwt5";
        case "openai":
            return "alloy";
        case "google":
            return "vi-VN-Standard-A";
        default:
            return "vi-VN-HoaiMyNeural";
    }
}

function getDefaultSettings(): SystemSettings {
    const config = getConfig();
    const defaultLlmProvider = config.LLM_Provider || "deepseek";
    const defaultTtsProvider = config.TTS_Provider || "edge";

    return {
        maintenanceMode: false,
        registrationEnabled: true,
        defaultLlmProvider,
        defaultLlmModel: getDefaultModelForProvider(defaultLlmProvider),
        defaultTtsProvider,
        defaultTtsVoice: getDefaultVoiceForProvider(defaultTtsProvider),
        freeCreditsOnRegister: 20,
        maxConcurrentJobs: 3,
        allowSandboxPayments: true,
        systemNotice: "",
        updatedAt: new Date().toISOString(),
    };
}

let cachedSettings: SystemSettings | null = null;

function saveSettingsToDisk(settings: SystemSettings): void {
    if (isTestEnv) return;

    try {
        const dir = join(process.cwd(), "data");
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
    } catch (err: any) {
        if (err?.code !== "EACCES") {
            console.error("[SystemSettings] Failed to save settings to disk:", err);
        }
    }
}

async function persistSettingsToDb(settings: SystemSettings): Promise<void> {
    const config = getConfig();
    if (!config.DATABASE_URL) return;

    try {
        await db.query(
            `INSERT INTO system_settings (key, value, updated_at, updated_by)
             VALUES ('system_config', $1, NOW(), $2)
             ON CONFLICT (key) DO UPDATE SET
                 value = EXCLUDED.value,
                 updated_at = NOW(),
                 updated_by = EXCLUDED.updated_by`,
            [JSON.stringify(settings), settings.updatedBy || null]
        );
    } catch (err) {
        console.error("[SystemSettings] Failed to persist settings to database:", err);
    }
}

export const SYSTEM_SETTINGS_LIMITS = {
    maxConcurrentJobs: { min: 1, max: 20 },
    freeCreditsOnRegister: { min: 0, max: 1_000_000 },
} as const;

/**
 * Kiểm tra dữ liệu cập nhật cài đặt. Trả về thông báo lỗi hoặc `null` nếu hợp lệ.
 *
 * Trước đây `update()` nhận `any` và lưu thẳng, nên admin có thể đặt
 * `maxConcurrentJobs = 0/-5/NaN` hoặc `freeCreditsOnRegister` âm — làm hỏng hàng
 * đợi render và tặng credit âm khi đăng ký.
 */
export function validateSettingsPatch(partial: any): string | null {
    if (!partial || typeof partial !== "object") return "Dữ liệu cài đặt không hợp lệ.";

    const numericFields: Array<[string, { min: number; max: number }]> = [
        ["maxConcurrentJobs", SYSTEM_SETTINGS_LIMITS.maxConcurrentJobs],
        ["renderConcurrency", SYSTEM_SETTINGS_LIMITS.maxConcurrentJobs],
        ["freeCreditsOnRegister", SYSTEM_SETTINGS_LIMITS.freeCreditsOnRegister],
    ];
    for (const [field, limit] of numericFields) {
        if (partial[field] === undefined) continue;
        const value = Number(partial[field]);
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < limit.min || value > limit.max) {
            return `${field} phải là số nguyên trong khoảng ${limit.min}–${limit.max}.`;
        }
    }

    const booleanFields = ["maintenanceMode", "registrationEnabled", "allowSandboxPayments"];
    for (const field of booleanFields) {
        if (partial[field] !== undefined && typeof partial[field] !== "boolean") {
            return `${field} phải là giá trị đúng/sai (boolean).`;
        }
    }

    return null;
}

export const systemSettings = {
    get(): SystemSettings {
        if (cachedSettings) return cachedSettings;

        try {
            if (existsSync(SETTINGS_FILE)) {
                const data = readFileSync(SETTINGS_FILE, "utf8");
                const parsed = JSON.parse(data);
                const defaults = getDefaultSettings();
                const provider = parsed.defaultLlmProvider || parsed.llmProvider || defaults.defaultLlmProvider;
                const ttsProvider = parsed.defaultTtsProvider || parsed.ttsProvider || defaults.defaultTtsProvider;

                cachedSettings = {
                    ...defaults,
                    ...parsed,
                    defaultLlmProvider: provider,
                    defaultLlmModel: parsed.defaultLlmModel || parsed.llmModel || getDefaultModelForProvider(provider),
                    defaultTtsProvider: ttsProvider,
                    defaultTtsVoice: parsed.defaultTtsVoice || parsed.ttsVoice || getDefaultVoiceForProvider(ttsProvider),
                };
                return cachedSettings!;
            }
        } catch (err) {
            console.error("[SystemSettings] Failed to read settings file:", err);
        }

        cachedSettings = getDefaultSettings();
        saveSettingsToDisk(cachedSettings);
        return cachedSettings;
    },

    update(partial: any, updatedBy?: string): SystemSettings {
        const current = this.get();
        const normalized: Partial<SystemSettings> = { ...partial };

        // Normalize aliases from frontend
        if (partial.llmProvider !== undefined) normalized.defaultLlmProvider = partial.llmProvider;
        if (partial.ttsProvider !== undefined) normalized.defaultTtsProvider = partial.ttsProvider;
        if (partial.llmModel !== undefined) normalized.defaultLlmModel = partial.llmModel;
        if (partial.ttsVoice !== undefined) normalized.defaultTtsVoice = partial.ttsVoice;
        if (partial.renderConcurrency !== undefined) normalized.maxConcurrentJobs = Number(partial.renderConcurrency);

        // Kẹp giá trị số phòng trường hợp bị gọi trực tiếp (không qua route đã validate).
        if (normalized.maxConcurrentJobs !== undefined) {
            const v = Math.round(Number(normalized.maxConcurrentJobs));
            normalized.maxConcurrentJobs = Number.isFinite(v)
                ? Math.min(Math.max(v, SYSTEM_SETTINGS_LIMITS.maxConcurrentJobs.min), SYSTEM_SETTINGS_LIMITS.maxConcurrentJobs.max)
                : current.maxConcurrentJobs;
        }
        if (normalized.freeCreditsOnRegister !== undefined) {
            const v = Math.round(Number(normalized.freeCreditsOnRegister));
            normalized.freeCreditsOnRegister = Number.isFinite(v)
                ? Math.min(Math.max(v, SYSTEM_SETTINGS_LIMITS.freeCreditsOnRegister.min), SYSTEM_SETTINGS_LIMITS.freeCreditsOnRegister.max)
                : current.freeCreditsOnRegister;
        }

        const targetLlmProvider = normalized.defaultLlmProvider || current.defaultLlmProvider;
        if (!normalized.defaultLlmModel && partial.llmProvider !== undefined) {
            normalized.defaultLlmModel = getDefaultModelForProvider(targetLlmProvider);
        }

        const targetTtsProvider = normalized.defaultTtsProvider || current.defaultTtsProvider;
        if (!normalized.defaultTtsVoice && partial.ttsProvider !== undefined) {
            normalized.defaultTtsVoice = getDefaultVoiceForProvider(targetTtsProvider);
        }

        cachedSettings = {
            ...current,
            ...normalized,
            updatedAt: new Date().toISOString(),
            updatedBy: updatedBy || current.updatedBy,
        };

        saveSettingsToDisk(cachedSettings);
        persistSettingsToDb(cachedSettings).catch(() => {});

        // Reset singleton LLM and TTS clients so changes take effect immediately
        try {
            setLLMClient(null);
            resetLLMClient();
            resetTTSClient();
        } catch {}

        return cachedSettings;
    },

    async initFromDatabase(): Promise<void> {
        this.get(); // Ensure disk/defaults loaded first
        const config = getConfig();
        if (!config.DATABASE_URL) return;

        try {
            const res = await db.query(
                `SELECT value FROM system_settings WHERE key = 'system_config' LIMIT 1`
            );
            if (res.rows.length > 0 && res.rows[0].value) {
                const dbSettings = res.rows[0].value;
                const defaults = getDefaultSettings();
                const provider = dbSettings.defaultLlmProvider || defaults.defaultLlmProvider;
                const ttsProvider = dbSettings.defaultTtsProvider || defaults.defaultTtsProvider;

                cachedSettings = {
                    ...defaults,
                    ...dbSettings,
                    defaultLlmProvider: provider,
                    defaultLlmModel: dbSettings.defaultLlmModel || getDefaultModelForProvider(provider),
                    defaultTtsProvider: ttsProvider,
                    defaultTtsVoice: dbSettings.defaultTtsVoice || getDefaultVoiceForProvider(ttsProvider),
                };
                saveSettingsToDisk(cachedSettings!);
            }
        } catch (err) {
            console.error("[SystemSettings] Failed to load settings from database:", err);
        }
    },
};
