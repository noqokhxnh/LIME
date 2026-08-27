import { Config } from "../config.ts";

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
                max_token: 32000,
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

