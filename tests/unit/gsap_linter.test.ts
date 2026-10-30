import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lintGsapCode } from "../../src/pipeline/gsapLinter.js";
import {
    checkGsapLintLeg,
    extractInlineScripts,
    runOracleQa,
    type DOMSampler,
} from "../../src/pipeline/oracleQa.js";
import type { videoScript } from "../../src/llm/schema.js";

/** Tween chồng lấn rõ ràng: cùng target, cùng x, giao 0.5s. */
const OVERLAP = `const tl = gsap.timeline({ paused: true });
tl.to(".box", { x: 100, duration: 1 }, 0);
tl.to(".box", { x: 200, duration: 1 }, 0.5);`;

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


describe("UNPAUSED_TIMELINE và contract __registerScene", () => {
    it("không báo khi timeline được đăng ký qua window.__registerScene", () => {
        const code = `(function() {
  const tl = gsap.timeline();
  tl.to("#scene_1", { opacity: 1, duration: 0.4 }, 0);
  window.__registerScene("scene_1", tl, 3);
})();`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "UNPAUSED_TIMELINE").length, 0);
    });

    it("không báo khi đăng ký inline gsap.timeline() hoặc chuỗi .to()", () => {
        const inline = `window.__registerScene("scene_1", gsap.timeline(), 3);`;
        assert.equal(
            lintGsapCode(inline, "scene_1").violations.filter((v) => v.type === "UNPAUSED_TIMELINE").length,
            0
        );

        const chained = `const tl = gsap.timeline().to("#scene_1", { opacity: 1, duration: 0.4 }, 0);
window.__registerScene("scene_1", tl, 3);`;
        assert.equal(
            lintGsapCode(chained, "scene_1").violations.filter((v) => v.type === "UNPAUSED_TIMELINE").length,
            0
        );
    });

    it("vẫn báo timeline không đăng ký và không paused", () => {
        const code = `const tl = gsap.timeline();
tl.to("#scene_1", { opacity: 1, duration: 0.4 }, 0);`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "UNPAUSED_TIMELINE").length, 1);
    });
});

describe("OVERLAPPING_TWEEN (Issue #41)", () => {
    it("báo vi phạm khi 2 tween cùng target + property giao thời gian", () => {
        const { violations } = lintGsapCode(OVERLAP, "scene_1");
        const overlaps = violations.filter((v) => v.type === "OVERLAPPING_TWEEN");
        assert.equal(overlaps.length, 1);
        assert.equal(overlaps[0].sceneId, "scene_1");
        assert.equal(overlaps[0].line, 3);
        assert.ok(overlaps[0].message.includes('".box"'));
        assert.ok(overlaps[0].message.includes("x"));
    });

    it("không báo lỗi khi tween chạy tuần tự (nối tiếp trong timeline)", () => {
        const code = `const tl = gsap.timeline({ paused: true });
tl.to(".box", { x: 100, duration: 1 });
tl.to(".box", { x: 200, duration: 1 });`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length, 0);
    });

    it("không báo lỗi khi 2 tween cùng target nhưng khác property", () => {
        const code = `const tl = gsap.timeline({ paused: true });
tl.to(".box", { x: 100, duration: 1 }, 0);
tl.to(".box", { opacity: 0, duration: 1 }, 0.5);`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length, 0);
    });

    it("không báo lỗi khi 2 tween cùng property nhưng khác target", () => {
        const code = `const tl = gsap.timeline({ paused: true });
tl.to(".a", { x: 100, duration: 1 }, 0);
tl.to(".b", { x: 200, duration: 1 }, 0.5);`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length, 0);
    });

    it("bỏ qua an toàn khi code lỗi cú pháp", () => {
        const code = `const tl = gsap.timeline({ paused: true`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.length, 0);
    });

    it("bắt được tween chồng nhau trong chuỗi .to().to() dùng position '<'", () => {
        const code = `gsap.timeline({ paused: true })
    .to(".box", { x: 10, duration: 1 })
    .to(".box", { x: 20, duration: 1 }, "<");`;
        const { violations } = lintGsapCode(code, "scene_1");
        const overlaps = violations.filter((v) => v.type === "OVERLAPPING_TWEEN");
        assert.equal(overlaps.length, 1);
        // Node của tween thứ 2 là cả chuỗi CallExpression nên loc bắt đầu ở dòng 1
        assert.ok(overlaps[0].line >= 1);
    });

    it("bắt được position tương đối '-=0.5' gây chồng lấn", () => {
        const code = `const tl = gsap.timeline({ paused: true });
tl.to(".box", { x: 100, duration: 1 });
tl.to(".box", { x: 200, duration: 1 }, "-=0.5");`;
        const { violations } = lintGsapCode(code, "scene_1");
        assert.equal(violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length, 1);
    });

    it("không báo với repeat: -1 (không xác định điểm kết thúc) và set() duration 0", () => {
        const infinite = `gsap.to(".box", { x: 100, duration: 1, repeat: -1 });
gsap.to(".box", { x: 200, duration: 1 });`;
        assert.equal(
            lintGsapCode(infinite, "scene_1").violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length,
            0
        );

        const setThenTween = `const tl = gsap.timeline({ paused: true });
tl.set(".box", { x: 0 }, 0);
tl.to(".box", { x: 100, duration: 1 }, 0);`;
        assert.equal(
            lintGsapCode(setThenTween, "scene_1").violations.filter((v) => v.type === "OVERLAPPING_TWEEN").length,
            0
        );
    });

});

describe("extractInlineScripts (Issue #41)", () => {
    it("tách script inline, bỏ qua script có src và script không phải JS", () => {
        const html = `<div></div>
<script src="https://cdn.example.com/gsap.js"></script>
<script type="application/json">{"a":1}</script>
<script>
gsap.to(".box", { top: 1 });
</script>`;
        const blocks = extractInlineScripts(html);
        assert.equal(blocks.length, 1);
        assert.ok(blocks[0].code.includes("gsap.to"));
        // `<script>` mở ở dòng 4; body bắt đầu ngay sau đó (dòng 4 có newline)
        assert.equal(blocks[0].startLine, 4);
        const { violations } = lintGsapCode(blocks[0].code, "scene_1");
        assert.equal(violations[0].line + blocks[0].startLine - 1, 5);
    });
});

function makeScript(jsCode: string): videoScript {
    return {
        id: "s",
        title: "t",
        description: "",
        globalStyles: "",
        globalSetupJs: "",
        scenes: [
            {
                id: "s1",
                title: "S1",
                voiceOverText: "t1",
                visualDescription: "",
                htmlCode: '<div class="box"></div>',
                cssCode: "",
                jsCode: "",
                transition: "fade",
                backgroundColor: "#000",
                duration: 2,
            },
            {
                id: "s2",
                title: "S2",
                voiceOverText: "t2",
                visualDescription: "",
                htmlCode: '<div class="box"></div>',
                cssCode: "",
                jsCode,
                transition: "none",
                backgroundColor: "#000",
                duration: 8,
                nearStill: { from: 1, to: 3 },
            },
        ],
        boundaries: [],
        colorPalette: { primary: "#000", secondary: "#111", accent: "#222", background: "#333", text: "#fff" },
        fontFamily: "Inter",
    } as unknown as videoScript;
}

const boxSampler: DOMSampler = async () => ({
    left: 100,
    top: 100,
    right: 300,
    bottom: 300,
    width: 200,
    height: 200,
});

function qaOptions(script: videoScript) {
    return {
        script,
        htmlPath: "mock.html",
        width: 1920,
        height: 1080,
        fps: 30,
        domSampler: boxSampler,
        audioAnalyzer: async () => ({ peakDbfs: -12, quietSec: 1.5 }),
        audioResult: {
            scencesDuration: { s1: 2.0, s2: 8.0 },
            audioFiles: {},
            totalDurationSec: 10.0,
            mixAudioPath: "mock.mp3",
        },
    };
}

describe("Leg code — lint GSAP trong Oracle QA (Issue #41)", () => {
    it("checkGsapLintLeg mặc định warn-only: có vi phạm nhưng status warn", () => {
        const leg = checkGsapLintLeg(makeScript(OVERLAP));
        assert.equal(leg.strict, false);
        assert.equal(leg.status, "warn");
        assert.equal(leg.lintedUnits, 1);
        assert.equal(leg.violations.length, 1);
        assert.equal(leg.violations[0].rule, "OVERLAPPING_TWEEN");
        assert.equal(leg.violations[0].sceneId, "s2");
        assert.ok(leg.reason?.includes("warn-only"));
    });

    it("checkGsapLintLeg strict: cùng vi phạm chuyển thành fail", () => {
        const leg = checkGsapLintLeg(makeScript(OVERLAP), { strict: true });
        assert.equal(leg.strict, true);
        assert.equal(leg.status, "fail");
        assert.equal(leg.violations.length, 1);
    });

    it("checkGsapLintLeg pass khi không có vi phạm", () => {
        const leg = checkGsapLintLeg(makeScript(`gsap.to(".box", { x: 10, duration: 1 });`));
        assert.equal(leg.status, "pass");
        assert.equal(leg.violations.length, 0);
    });

    it("runOracleQa gắn leg code warn-only, job vẫn valid", async () => {
        const report = await runOracleQa(qaOptions(makeScript(OVERLAP)));
        assert.equal(report.legs.code.status, "warn");
        assert.equal(report.qaStatus, "warn");
        assert.equal(report.valid, true);
        assert.ok(report.warnings.some((w) => w.includes("CODE")));
        assert.equal(report.errors.length, 0);
    });

    it("runOracleQa với gsapLintStrict: vi phạm thành fail và job invalid", async () => {
        const report = await runOracleQa({ ...qaOptions(makeScript(OVERLAP)), gsapLintStrict: true });
        assert.equal(report.legs.code.status, "fail");
        assert.equal(report.qaStatus, "fail");
        assert.equal(report.valid, false);
        assert.ok(report.errors.some((e) => e.includes("CODE")));
    });

    it("runOracleQa không có vi phạm: leg code pass", async () => {
        const report = await runOracleQa(
            qaOptions(makeScript(`gsap.to(".box", { x: 10, duration: 1 });`))
        );
        assert.equal(report.legs.code.status, "pass");
    });

    it("lint 1 scene tiêu biểu chạy dưới 20ms", () => {
        const tween = `tl.to(".a", { x: 10, duration: 0.4 }, 0);
tl.to(".b", { y: 20, duration: 0.6 }, 0.2);
tl.to(".c", { scale: 1.2, duration: 0.3 }, 0.5);
tl.to(".d", { rotation: 10, duration: 0.5 }, 0.7);
tl.to(".e", { opacity: 0, duration: 0.4 }, 1.0);`;
        const code = `const tl = gsap.timeline({ paused: true });\n${tween.repeat(3)}`;
        const started = performance.now();
        lintGsapCode(code, "scene_1");
        const elapsed = performance.now() - started;
        assert.ok(elapsed < 20, `lint mất ${elapsed.toFixed(2)}ms (> 20ms)`);
    });
});
