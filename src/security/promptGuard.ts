export const MAX_PROMPT_LENGTH = 2000;

const JAILBREAK_PATTERNS = [
    /ignore previous instructions/i,
    /system prompt override/i,
    /you are no longer/i,
    /bypass the safety/i,
    /do anything now/i,
    /forget all previous/i,
    /ignore all previous/i,
    /disregard previous/i
];

export function validatePrompt(prompt: string): { isValid: boolean; reason?: string } {
    if (!prompt || typeof prompt !== "string") {
        return { isValid: false, reason: "Invalid prompt format" };
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
        return { isValid: false, reason: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` };
    }

    for (const pattern of JAILBREAK_PATTERNS) {
        if (pattern.test(prompt)) {
            return { isValid: false, reason: "Prompt contains restricted safety bypass patterns" };
        }
    }

    return { isValid: true };
}
