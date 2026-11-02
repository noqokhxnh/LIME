---
name: lime-ui-craft
description: "Custom UI craft skill for LIME. Enforces sleek, anti-slop, intentional design for LIME web interfaces (Vanilla HTML/CSS/JS + GSAP). Guarantees non-breaking DOM hooks, 3-section landing page architecture, and Awwwards-level restrained elegance."
version: 1.0.0
---

# LIME UI Craft — Dedicated UI/UX Skill

> **Target Project**: LIME (Lightweight Intelligent Motion Engine)  
> **Stack**: Vanilla HTML5, Vanilla CSS3 (Design Tokens), Vanilla JS (ESM), GSAP 3.x, Fastify static serving.  
> **Companion Skills**: `design-taste-frontend` (Art Direction / Taste), `mattpocock/skills` (Code Review & Verification).

---

## 1. Core Design Philosophy (Anti-AI Slop & Restraint)

LIME is an intelligent motion and video creation studio. Its own interface must reflect **studio-grade craftsmanship**, not generic AI-generated templates.

1. **Zero Unmotivated Motion (`MOTION_INTENSITY = 1/5`)**:
   - Strictly prohibit continuous rainbow shimmer loops, endless floating particle dots, and jittery flip-words.
   - Motion is reserved for user interactions (hover state, button press, modal fade, smooth accordion reveal).
2. **No Re-drawn Fake Chrome**:
   - Never draw fake browser window dots (red/yellow/green) or fake terminal header bars around real product screenshots/videos.
   - Use clean, hairline borders (`1px solid rgba(255, 255, 255, 0.08)`) with subtle ambient drop shadows.
3. **Intentional Typography & Hierarchy**:
   - Primary Headings: Modern Display font (`Space Grotesk`, `700`, tight letter-spacing `-0.03em`).
   - Body & Meta: Clean, legible sans-serif (`Inter`, `400-500`, relaxed line-height `1.6`).
   - Code & Metrics: Monospace (`JetBrains Mono`).
   - Roman only — no italicized headings.
4. **Color Palette & Contrast (WCAG 2.2 AA Compliance)**:
   - Deep Canvas: Obsidian Dark (`#08090d` / `#0d0f17`).
   - Surface & Cards: Slate Glass (`rgba(255, 255, 255, 0.03)` with `backdrop-filter: blur(12px)`).
   - Hairline Borders: `rgba(255, 255, 255, 0.08)` (subtle) to `rgba(255, 255, 255, 0.16)` (hover/active).
   - Accents: Electric Lime (`#88ce02` / `#a3e635`) and Emerald (`#10b981`), used sparingly for key action points only.

---

## 2. The Non-Breaking DOM Hook Contract

When redesigning or editing `index.html` or `workspace.html`, **ALL JavaScript hooks MUST remain completely intact**:

- **Navigation & Auth**:
  - `#home-user`, `#login-open-btn`, `#home-user-dropdown`, `#home-logout-btn`
  - `#login-modal`, `#login-close-btn`, `#login-submit-btn`, `#login-username`, `#login-password`, `#login-message`
  - `#register-form`, `#login-form`, `#show-register-btn`, `#show-login-btn`
  - `#nav-profile-link`, `#nav-setting-link`, `#nav-admin-link`, `#home-admin-item`
- **Section 1 (Hero)**:
  - `#home-prompt-input`, `#home-prompt-btn`, `.hero-video`
- **Section 2 (Templates & Scenarios)**:
  - `#tplp-list` (container for playlist buttons `.tplp-item[data-i]`)
  - `#tplp-screen` (stage viewport)
  - `#tplp-play`, `#tplp-fill`, `#tplp-knob`, `#tplp-tc`, `#tplp-q` (scrub & audio indicators)
  - `#tplp-scenes`, `#tplp-scenes-meta` (scenes timeline)
  - `#tplp-prompt-text`, `#tplp-chip`, `#tplp-cta` (`.btn-use-template`)
- **Section 3 (Pricing & VietQR)**:
  - Toggle: `.bill-toggle [data-period="month"]`, `[data-period="year"]`
  - Cards & CTA: `.plan-btn[data-plan="free"]`, `[data-plan="pro"]`, `[data-plan="max"]`, `[data-plan="team"]`
  - Price values: `.price-val[data-monthly][data-yearly]`

---

## 3. The 3-Section Landing Page Architecture

1. **Phần 1: Giới thiệu (Hero & Value Prop)**:
   - High-contrast value statement: Clear, compelling headline explaining text-to-video via HTML/GSAP.
   - Linear-style AI Prompt Bar: Minimalist input bar with crisp action button and keyboard hint.
   - Video Showcase: Clean 16:9 viewport showing rendered output with ambient illumination.
2. **Phần 2: Mẫu thiết kế & Kịch bản (Studio Showcase)**:
   - 2-Column Studio Viewport: Left is the interactive stage with sleek playback scrubber; right is the minimal playlist tracklist.
   - Timeline markers representing video scenes cleanly without cartoonish illustrations.
3. **Phần 3: Gói dịch vụ (Pricing & VietQR Billing)**:
   - Clean 4-column comparison grid.
   - Clear distinction between Free, Pro (highlighted with refined border, not loud neon badges), Max, and Enterprise.

---

## 4. Pre-Flight Verification Checklist

Before finalizing any UI edits:
- [ ] No fake browser dots or decorative emojis.
- [ ] No continuous keyframe animations (pulse/shimmer/glow loops).
- [ ] All interactive buttons have unique IDs and `:hover`, `:focus-visible`, `:active` states.
- [ ] Mobile responsive without horizontal overflow (`overflow-x: clip`).
- [ ] Zero JS console errors on page load and interaction.
