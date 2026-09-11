export interface StylePalette {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
}

export interface StyleDirectives {
    vibe: string;
    layoutPatterns: string[];
    motionSignature: string;
    negativeRules: string[];
}

export interface StyleConfig {
    id: string;
    name: string;
    description: string;
    fontFamily: string;
    googleFontUrl: string;
    colorPalette: StylePalette;
    directives: StyleDirectives;
}

export const stylePreset: Record<string, StyleConfig> = {
    modern: {
        id: "modern",
        name: "Hiện Đại & Công Nghệ (Modern Tech)",
        description: "Phong cách công nghệ cao, SaaS, tương lai số, sắc sảo với các khối phát sáng tinh tế và độ tương phản mạnh.",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800;900&family=Space+Mono:wght@400;700&display=swap",
        colorPalette: {
            primary: "#8b5cf6",     // Electric Violet
            secondary: "#06b6d4",   // Cyber Cyan
            accent: "#ec4899",      // Neon Pink
            background: "#0b0f19",  // Deep Obsidian Void
            text: "#f8fafc",        // Crisp Ice White
        },
        directives: {
            vibe: "Sleek, tech-forward, futuristic, high-contrast digital precision.",
            layoutPatterns: [
                "Hero Split (60% visual anchor / 40% concise typography)",
                "Metric Ribbon (Large glowing counter + micro badge chip)",
                "Asymmetric Card Matrix (1 major focus anchor + 2 micro status chips)",
                "Floating HUD elements with hairline neon accents"
            ],
            motionSignature: "Fast spring entrance (ease: 'back.out(1.7)'), smooth ambient float, sheen sweep on key highlights.",
            negativeRules: [
                "NO plain light-grey backgrounds (must maintain deep dark contrast)",
                "NO standard serif fonts",
                "NO bouncy childish elastic movements",
                "NO multi-paragraph text walls"
            ]
        }
    },
    classic: {
        id: "classic",
        name: "Điện Ảnh & Tạp Chí (Editorial & Documentary)",
        description: "Phong cách phóng sự tài liệu, tạp chí cao cấp, trang nhã, giàu cảm xúc với typography thanh lịch và chuyển động mượt mà.",
        fontFamily: "'Playfair Display', Georgia, serif",
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Inter:wght@400;500;600&display=swap",
        colorPalette: {
            primary: "#d4af37",     // Muted Antique Gold
            secondary: "#334155",   // Slate Navy
            accent: "#c0392b",      // Heritage Crimson
            background: "#0f141c",  // Midnight Gallery Charcoal
            text: "#f5f5f0",        // Warm Alabaster Cream
        },
        directives: {
            vibe: "Timeless editorial, documentary prestige, literary elegance, cinematic storytelling.",
            layoutPatterns: [
                "Magazine Editorial Spread (Large serif heading + asymmetric frame)",
                "Historic Date / Era Callout (Massive serif numerals + hairline rule)",
                "Quote & Anchor Focal Point (Drop-cap / italicized takeaway)",
                "Horizontal Rule Divider with balanced negative space"
            ],
            motionSignature: "Smooth cinematic glide (ease: 'power2.out'), slow continuous drift (Ken Burns subtle pan/scale), zero bounce.",
            negativeRules: [
                "NO harsh neon cyber colors",
                "NO bouncy spring/elastic easings",
                "NO glassmorphism rounded bubble cards",
                "NO tech chip badges or futuristic HUD icons"
            ]
        }
    },
    stickman: {
        id: "stickman",
        name: "Hoạt Họa Người Que (Comic Stickman Explainer)",
        description: "Phong cách truyện tranh comic dí dỏm, viral, nhân vật người que biểu cảm cao, trực quan và dễ tiếp cận.",
        fontFamily: "'Patrick Hand', 'Caveat', cursive, sans-serif",
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Caveat:wght@600;700&display=swap",
        colorPalette: {
            primary: "#222222",     // Sketch Ink Black
            secondary: "#4b6584",   // Slate Pencil Blue
            accent: "#ff4757",      // Comic Punch Red
            background: "#faf8f0",  // Warm Sketch Parchment
            text: "#1e272e",        // Deep Comic Ink
        },
        directives: {
            vibe: "Viral explainer, humorous comic strip, hand-drawn warmth, highly expressive.",
            layoutPatterns: [
                "Comic Panel Split (2-3 distinct panels with action -> reaction)",
                "Character Stage (.stage wrapper with central protagonist focus)",
                "Speech / Thought Anchor Bubble with punchy takeaway (≤ 4 words)",
                "Exclamation Point & Comic FX overlays"
            ],
            motionSignature: "Expressive character poses via window.__sm(), comic reactions via window.__fx(), body bobbing, step movement.",
            negativeRules: [
                "NO dark futuristic sci-fi neon styling",
                "NO realistic photos or corporate stock imagery",
                "NO rigid formal enterprise grids",
                "NO sterile sans-serif headings without character"
            ]
        }
    },
    minimal: {
        id: "minimal",
        name: "Tối Giản Thụy Sĩ (Swiss Minimalist)",
        description: "Phong cách đồ họa Thụy Sĩ chuẩn mực: tối đa khoảng thở, đơn sắc, cấu trúc dạng lưới chuẩn xác với 1 điểm nhấn màu sắc.",
        fontFamily: "'Space Grotesk', sans-serif",
        googleFontUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap",
        colorPalette: {
            primary: "#111111",     // Deep Minimal Black
            secondary: "#64748b",   // Slate Neutral Muted
            accent: "#e63946",      // Single Focus Crimson
            background: "#fcfcfb",  // Pure Gallery White
            text: "#0f172a",        // Deep Obsidian Ink
        },
        directives: {
            vibe: "Swiss grid precision, ultra-clean whitespace, architectural restraint, typography-first.",
            layoutPatterns: [
                "Index Header & Monolithic Title (e.g. '01 / PERSPECTIVE')",
                "Extreme Whitespace Field (50%+ blank canvas with single focal anchor)",
                "Hairline Grid Rule (1px solid #e2e8f0)",
                "Single Key Stat Hero with bold accent dot"
            ],
            motionSignature: "Precision linear & cubic reveals (ease: 'power3.out'), single-pass movement, maximum 2 elements moving per beat, zero yoyo.",
            negativeRules: [
                "NO gradients or multi-color rainbows",
                "NO shadows or blurred glowing backdrops",
                "NO rounded pill cards",
                "NO floating continuous particle loops"
            ]
        }
    }
};

/**
 * Trả về chỉ dẫn thiết kế chi tiết để chèn vào User Prompt cho LLM
 */
export function formatStylePrompt(styleKey: string, customStyle?: string): string {
    const config = stylePreset[styleKey] || stylePreset.modern;
    let prompt = `Visual Style: ${config.name}
- Vibe & Spirit: ${config.directives.vibe}
- Primary Typography: ${config.fontFamily} (Load URL: ${config.googleFontUrl})
- Recommended Color Palette:
  * Primary: ${config.colorPalette.primary}
  * Secondary: ${config.colorPalette.secondary}
  * Accent: ${config.colorPalette.accent}
  * Background: ${config.colorPalette.background}
  * Text: ${config.colorPalette.text}
- Recommended Layout Patterns:
${config.directives.layoutPatterns.map((p) => `  * ${p}`).join("\n")}
- Motion Signature: ${config.directives.motionSignature}
- Negative Prohibitions (STRICTLY FORBIDDEN):
${config.directives.negativeRules.map((r) => `  * ${r}`).join("\n")}`;

    if (customStyle) {
        prompt += `\n- Additional User Custom Style Directives: ${customStyle}`;
    }
    return prompt;
}
