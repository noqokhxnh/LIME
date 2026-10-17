import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintGsapCode } from "../../src/pipeline/gsapLinter.js";

describe("gsapLinter (Issue #41)", () => {
    it("phát hiện layout thrashing (animate top)", () => {
        const code = `gsap.to(".box", { top: 100, duration: 1 });`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, "LAYOUT_THRASHING");
        assert.ok(violations[0].message.includes("top"));
    });

    it("không báo lỗi khi dùng transform (x, y)", () => {
        const code = `gsap.to(".box", { x: 100, y: 50, duration: 1 });`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 0);
    });

    it("phát hiện timeline thiếu paused: true", () => {
        const code = `const tl = gsap.timeline();`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, "UNPAUSED_TIMELINE");
    });

    it("không báo lỗi khi timeline có paused: true", () => {
        const code = `const tl = gsap.timeline({ paused: true });`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 0);
    });

    it("phát hiện width trong fromTo", () => {
        const code = `gsap.fromTo(".box", { width: 0 }, { width: 200, duration: 1 });`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 1);
        assert.equal(violations[0].type, "LAYOUT_THRASHING");
    });
});
