import { v4 } from 'uuid';

export interface ModelPricing {
    inputPerMillion: number;  // USD per 1,000,000 input tokens
    outputPerMillion: number; // USD per 1,000,000 output tokens
}

const DEFAULT_PRICING: Record<string, Record<string, ModelPricing>> = {
    openai: {
        'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
        'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
        'default': { inputPerMillion: 2.00, outputPerMillion: 8.00 },
    },
    deepseek: {
        'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
        'deepseek-4-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
        'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
        'default': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
    },
    gemini: {
        'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
        'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
        'gemini-3.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },
        'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.00 },
        'default': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
    },
    claude: {
        'claude-3-5-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
        'claude sonnet 4.5': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
        'claude-3-5-haiku': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
        'default': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
    },
    '9router': {
        'default': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
    },
};

export function calculateLlmCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number
): number {
    const providerPricing = DEFAULT_PRICING[provider.toLowerCase()] || { default: { inputPerMillion: 1.0, outputPerMillion: 3.0 } };
    const pricing = providerPricing[model.toLowerCase()] || providerPricing['default'] || { inputPerMillion: 1.0, outputPerMillion: 3.0 };

    const inputCost = (promptTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPerMillion;

    return Number((inputCost + outputCost).toFixed(6));
}

export interface UsageRecord {
    id: string;
    timestamp: string;
    jobId?: string;
    userId?: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
}

export interface UsageSummary {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    byProvider: Record<string, {
        requests: number;
        totalTokens: number;
        costUsd: number;
    }>;
}

class TokenTracker {
    private records: UsageRecord[] = [];
    private maxRecords = 1000;

    record(params: {
        jobId?: string;
        userId?: string;
        provider: string;
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens?: number;
    }): UsageRecord {
        const promptTokens = Math.max(0, params.promptTokens || 0);
        const completionTokens = Math.max(0, params.completionTokens || 0);
        const totalTokens = params.totalTokens ?? (promptTokens + completionTokens);
        const estimatedCostUsd = calculateLlmCost(
            params.provider,
            params.model,
            promptTokens,
            completionTokens
        );

        const record: UsageRecord = {
            id: v4(),
            timestamp: new Date().toISOString(),
            jobId: params.jobId,
            userId: params.userId,
            provider: params.provider,
            model: params.model,
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUsd,
        };

        this.records.unshift(record);
        if (this.records.length > this.maxRecords) {
            this.records.pop();
        }

        return record;
    }

    getSummary(userId?: string): UsageSummary {
        const filtered = userId
            ? this.records.filter(r => r.userId === userId)
            : this.records;

        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;
        let totalCostUsd = 0;
        const byProvider: Record<string, { requests: number; totalTokens: number; costUsd: number }> = {};

        for (const r of filtered) {
            totalPromptTokens += r.promptTokens;
            totalCompletionTokens += r.completionTokens;
            totalTokens += r.totalTokens;
            totalCostUsd += r.estimatedCostUsd;

            if (!byProvider[r.provider]) {
                byProvider[r.provider] = { requests: 0, totalTokens: 0, costUsd: 0 };
            }
            byProvider[r.provider].requests += 1;
            byProvider[r.provider].totalTokens += r.totalTokens;
            byProvider[r.provider].costUsd = Number((byProvider[r.provider].costUsd + r.estimatedCostUsd).toFixed(6));
        }

        return {
            totalRequests: filtered.length,
            totalPromptTokens,
            totalCompletionTokens,
            totalTokens,
            totalCostUsd: Number(totalCostUsd.toFixed(6)),
            byProvider,
        };
    }

    getRecentRecords(limit = 50, userId?: string): UsageRecord[] {
        const filtered = userId
            ? this.records.filter(r => r.userId === userId)
            : this.records;
        return filtered.slice(0, limit);
    }

    reset(): void {
        this.records = [];
    }
}

export const defaultTokenTracker = new TokenTracker();
