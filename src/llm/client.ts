import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Config, getConfig } from "../config.js";

export interface LLMClient {
    generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>;
    provider: string;
}

export class OpenAIClient implements LLMClient {
    readonly provider = 'openai';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.OpenAI_APIKEY) {
            throw new Error("OpenAI API key is required");
        }
        this.apikey = config.OpenAI_APIKEY;
        this.model = config.OpenAI_Model;
    }
    async generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apikey}`,
                "Content-Type": "application/json"
            },
            signal,
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 16000,
                response_format: { type: "json_object" },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI API Error: ${res.status} - ${err}`);
        }
        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`OpenAI API Error: No content in response. Raw: ${JSON.stringify(data)}`);
        }
        return content;
    }
}

export class DeepSeekClient implements LLMClient {
    readonly provider = 'deepseek';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.DeepSeek_APIKEY) {
            throw new Error("DeepSeek API key is required");
        }
        this.apikey = config.DeepSeek_APIKEY;
        this.model = config.DeepSeek_Model;
    }
    async generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apikey}`,
                "Content-Type": "application/json"
            },
            signal,
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 16000,
                response_format: { type: "json_object" },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`DeepSeek API Error: ${res.status} - ${err}`);
        }
        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`DeepSeek API Error: No content in response. Raw: ${JSON.stringify(data)}`);
        }
        return content;
    }
}

export class GeminiClient implements LLMClient {
    readonly provider = 'gemini';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.Gemini_APIKEY) {
            throw new Error("Gemini API key is required");
        }
        this.apikey = config.Gemini_APIKEY;
        this.model = config.Gemini_Model;
    }
    async generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apikey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            signal,
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                contents: [
                    { role: "user", parts: [{ text: userPrompt }] }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.7,
                    maxOutputTokens: 16000
                },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Gemini API Error: ${res.status} - ${err}`);
        }
        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error(`Gemini API Error: No candidate text received. Raw: ${JSON.stringify(data)}`);
        }
        return text;
    }
}

export class ClaudeClient implements LLMClient {
    readonly provider = 'claude';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.Claude_APIKEY) {
            throw new Error("Claude API key is required");
        }
        this.apikey = config.Claude_APIKEY;
        this.model = config.Claude_Model;
    }
    async generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": this.apikey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            },
            signal,
            body: JSON.stringify({
                model: this.model,
                system: systemPrompt,
                messages: [
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 16000,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Claude API Error: ${res.status} - ${err}`);
        }
        const data = await res.json() as any;
        const text = data.content?.[0]?.text;
        if (!text) {
            throw new Error(`Claude API Error: No text in response. Raw: ${JSON.stringify(data)}`);
        }
        return text;
    }
}

export function getAuto9RouterKey(): string | undefined {
    try {
        const home = process.env.HOME || process.env.USERPROFILE || "";
        const dbPath = join(home, ".9router", "db", "data.sqlite");
        if (existsSync(dbPath)) {
            const out = execSync(`sqlite3 "${dbPath}" "SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1;"`, {
                encoding: "utf-8",
                timeout: 1000,
                stdio: ["ignore", "pipe", "ignore"]
            }).trim();
            if (out) return out;
        }
    } catch {
        // ignore
    }
    return undefined;
}

export function getDockerGateway(): string | null {
    try {
        if (existsSync("/proc/net/route")) {
            const lines = readFileSync("/proc/net/route", "utf8").split("\n");
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts[1] === "00000000" && parts[2]) {
                    const hex = parts[2];
                    const b0 = parseInt(hex.slice(0, 2), 16);
                    const b1 = parseInt(hex.slice(2, 4), 16);
                    const b2 = parseInt(hex.slice(4, 6), 16);
                    const b3 = parseInt(hex.slice(6, 8), 16);
                    return `${b0}.${b1}.${b2}.${b3}`;
                }
            }
        }
    } catch {
        // ignore
    }
    return null;
}

export function getCandidateBaseURLs(baseURL: string): string[] {
    const urls = [baseURL];
    const isDocker = existsSync("/.dockerenv");
    const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");

    if (isDocker && isLocal) {
        const gateway = getDockerGateway();
        if (gateway) {
            urls.unshift(baseURL.replace(/localhost|127\.0\.0\.1/, gateway));
        }
        urls.unshift(baseURL.replace(/localhost|127\.0\.0\.1/, "host.docker.internal"));
    }
    return Array.from(new Set(urls));
}

export class NineRouterClient implements LLMClient {
    readonly provider = '9router';
    readonly model: string;
    private baseURL: string;
    private apikey: string;

    constructor(config: Config) {
        this.baseURL = (config.NineRouter_BaseURL || "http://localhost:20128/v1").replace(/\/+$/, "");
        this.model = config.NineRouter_Model || "ag/gemini-3.8-flash-high";

        let key = config.NineRouter_APIKEY || process.env.NINEROUTER_API_KEY || process.env.NINE_ROUTER_API_KEY;
        if (!key) {
            key = getAuto9RouterKey();
        }
        if (!key) {
            throw new Error("9router API key is required");
        }
        this.apikey = key;
    }

    async generate(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string> {
        const candidateURLs = getCandidateBaseURLs(this.baseURL);
        let res: Response | null = null;
        let lastNetErr: Error | null = null;
        let successfulBaseURL = this.baseURL;

        for (const base of candidateURLs) {
            if (signal?.aborted) {
                throw new DOMException("Operation aborted", "AbortError");
            }
            const url = `${base}/chat/completions`;
            try {
                let response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${this.apikey}`,
                        "Content-Type": "application/json"
                    },
                    signal,
                    body: JSON.stringify({
                        model: this.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 16000,
                        stream: false,
                        response_format: { type: "json_object" },
                    }),
                });

                if (!response.ok && response.status === 400) {
                    const errText = await response.clone().text();
                    if (errText.toLowerCase().includes("response_format") || errText.toLowerCase().includes("json_object")) {
                        response = await fetch(url, {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${this.apikey}`,
                                "Content-Type": "application/json"
                            },
                            signal,
                            body: JSON.stringify({
                                model: this.model,
                                messages: [
                                    { role: "system", content: systemPrompt },
                                    { role: "user", content: userPrompt }
                                ],
                                temperature: 0.7,
                                max_tokens: 16000,
                                stream: false,
                            }),
                        });
                    }
                }

                res = response;
                successfulBaseURL = base;
                break;
            } catch (err: any) {
                if (err.name === "AbortError") throw err;
                lastNetErr = err;
                console.warn(`[NineRouterClient] Could not connect to ${url}: ${err.message}. Trying fallback candidate...`);
            }
        }

        if (!res) {
            throw lastNetErr || new Error("9router: all connection candidate URLs failed");
        }

        this.baseURL = successfulBaseURL;

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`9router API Error: ${res.status} - ${err}`);
        }

        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error(`9router API Error: No content in response. Raw: ${JSON.stringify(data)}`);
        }

        return content;
    }
}

let _client: LLMClient | null = null;

export function resetLLMClient(): void {
    _client = null;
}

export function setLLMClient(client: LLMClient | null): void {
    _client = client;
}

export function getLLMClient(): LLMClient {
    if (!_client) {
        const provider = getConfig().LLM_Provider;
        switch (provider) {
            case 'openai':
                _client = new OpenAIClient(getConfig());
                break;
            case 'deepseek':
                _client = new DeepSeekClient(getConfig());
                break;
            case 'gemini':
                _client = new GeminiClient(getConfig());
                break;
            case 'claude':
                _client = new ClaudeClient(getConfig());
                break;
            case '9router':
                _client = new NineRouterClient(getConfig());
                break;
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`);
        }
        console.log(`Using LLM: ${_client.provider}`);
    }
    return _client;
}
