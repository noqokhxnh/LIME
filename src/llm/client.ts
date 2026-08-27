import { Config, getConfig } from "../config.ts";

export interface LLMClient {
    generate(systemPrompt: string, userPrompt: string): Promise<string>;
    provider: string;
}

class OpenAIClient implements LLMClient {
    provider: 'openai';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.OPENAI_APIKEY) {
            throw new Error("OpenAI API key is required");
        }
        this.apikey = config.OPENAI_APIKEY;
        this.model = config.OPENAI_Model;
    }
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apikey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 32000,
                response_format: { type: "json_object" },
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI API Error: ${res.status} - ${err}`);
        }
        const data = await res.json() as any;
        return data.choices[0].message.content;
    }
}

class DeepSeekClient implements LLMClient {
    provider: 'deepseek';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.DeepSeek_APIKEY) {
            throw new Error("DeepSeek API key is required");
        }
        this.apikey = config.DeepSeek_APIKEY;
        this.model = config.DeepSeek_Model;
    }
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apikey}`,
                "Content-Type": "application/json"
            },
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
        return data.choices[0].message.content;
    }
}

class GeminiClient implements LLMClient {
    provider: 'gemini';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.GEMINI_APIKEY) {
            throw new Error("Gemini API key is required");
        }
        this.apikey = config.GEMINI_APIKEY;
        this.model = config.GEMINI_Model;
    }
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apikey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [
                    { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
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
        return data.candidates[0].content.parts[0].text;
    }
}

class ClaudeClient implements LLMClient {
    provider: 'claude';
    private apikey: string;
    private model: string;

    constructor(config: Config) {
        if (!config.CLAUDE_APIKEY) {
            throw new Error("Claude API key is required");
        }
        this.apikey = config.CLAUDE_APIKEY;
        this.model = config.CLAUDE_Model;
    }
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": this.apikey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            },
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
        return data.content[0].text;
    }
}

let _client: LLMClient | null = null;

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
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`);
        }
        console.log(`Using LLM: ${_client.provider}`);
    }
    return _client;
}