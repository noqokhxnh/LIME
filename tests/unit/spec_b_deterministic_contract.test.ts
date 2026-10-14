import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";

import {
  RNG,
  hashString32,
  getSceneSeed,
  getElementSeed,
  createRandHelper,
  DETERMINISTIC_RUNTIME_JS,
} from "../../src/pipeline/rng.js";
import {
  lintCompCode,
  lintVideoScript,
  assertDeterministicScript,
  assertDeterministicComp,
  DeterministicContractError,
} from "../../src/pipeline/compLinter.js";
import { assembleHTML } from "../../src/pipeline/assembleHtml.js";
import { type scene, type videoScript, type durationMap } from "../../src/llm/schema.js";

describe("Workstream WS-B (Spec B): Deterministic Rendering Contract", () => {
  let testTempDir: string;

  const validMockScene: scene = {
    id: "scene-1",
    title: "Khám Phá Hà Nội",
    voiceOverText: "Chào mừng bạn đến với thủ đô Hà Nội ngàn năm văn hiến.",
    visualDescription: "Cảnh Hồ Gươm lung linh trong nắng sớm",
    htmlCode: '<div class="banner"><h1>Hà Nội</h1></div>',
    cssCode: ".banner { font-size: 24px; color: #fff; }",
    jsCode: `
      const tl = gsap.timeline();
      const r = window.__rand(10, 50);
      tl.to(".banner", { x: r, duration: {{SCENE_DURATION}} * 0.5 });
    `,
    transition: "fade",
    backgroundColor: "#050505",
  };

  const validMockScript: videoScript = {
    id: "script-spec-b-01",
    title: "Video Hà Nội Mến Yêu",
    description: "Kịch bản mẫu kiểm tra tính tất định của pipeline",
    globalStyles: ".banner { text-align: center; }",
    globalSetupJs: 'console.log("Global setup deterministic ready");',
    scenes: [
      validMockScene,
      {
        id: "scene-2",
        title: "Cầu Long Biên",
        voiceOverText: "Cây cầu lịch sử chứng kiến bao đổi thay của non sông.",
        visualDescription: "Cầu Long Biên cổ kính",
        htmlCode: '<div class="bridge"><p>Cầu Long Biên</p></div>',
        cssCode: ".bridge { color: #f59e0b; }",
        jsCode: `
          const tl = gsap.timeline();
          tl.to(".bridge", { opacity: 1, duration: {{SCENE_DURATION}} });
        `,
        transition: "slide-left",
        backgroundColor: "#1a1a1a",
      },
    ],
    colorPalette: {
      primary: "#e11d48",
      secondary: "#be123c",
      accent: "#f59e0b",
      background: "#050505",
      text: "#ffffff",
    },
    fontFamily: "Inter",
  };

  const sampleDurations: durationMap = {
    "scene-1": 4.0,
    "scene-2": 3.5,
  };

  beforeEach(() => {
    testTempDir = mkdtempSync(join(tmpdir(), "spec-b-test-"));
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: PRNG Mulberry32 and Random Helper
  // -------------------------------------------------------------------------
  describe("Test 1: Thuật toán PRNG Mulberry32 và Random Helpers", () => {
    it("RNG(seed) với cùng seed luôn sinh ra dãy số giống hệt nhau 100%", () => {
      const seed = 987654321;
      const rngA = RNG(seed);
      const rngB = RNG(seed);

      const seqA: number[] = [];
      const seqB: number[] = [];

      for (let i = 0; i < 500; i++) {
        seqA.push(rngA());
        seqB.push(rngB());
      }

      assert.strictEqual(seqA.length, 500);
      assert.deepStrictEqual(
        seqA,
        seqB,
        "Hai generator với cùng seed phải sinh ra dãy số khớp 100%"
      );
    });

    it("Hai seed khác nhau sinh ra hai dãy số khác nhau", () => {
      const rng1 = RNG(12345);
      const rng2 = RNG(54321);

      const seq1 = Array.from({ length: 50 }, () => rng1());
      const seq2 = Array.from({ length: 50 }, () => rng2());

      assert.notDeepStrictEqual(
        seq1,
        seq2,
        "Hai seed khác nhau không được sinh ra cùng dãy số"
      );
    });

    it("Mọi số sinh ra bởi RNG luôn nằm trong nửa khoảng [0, 1)", () => {
      const rng = RNG(42);
      for (let i = 0; i < 1000; i++) {
        const val = rng();
        assert.ok(val >= 0 && val < 1, `Giá trị ${val} phải thuộc [0, 1)`);
      }
    });

    it("createRandHelper hoạt động chính xác với các khoảng [0, 1), [0, max), và [min, max)", () => {
      const rand1 = createRandHelper(1337);
      const rand2 = createRandHelper(1337);

      // Gọi không đối số: trả về [0, 1)
      const u1 = rand1();
      const u2 = rand2();
      assert.strictEqual(u1, u2);
      assert.ok(u1 >= 0 && u1 < 1);

      // Gọi với 1 đối số: trả về [0, max)
      const m1 = rand1(100);
      const m2 = rand2(100);
      assert.strictEqual(m1, m2);
      assert.ok(m1 >= 0 && m1 < 100);

      // Gọi với 2 đối số: trả về [min, max)
      const r1 = rand1(20, 50);
      const r2 = rand2(20, 50);
      assert.strictEqual(r1, r2);
      assert.ok(r1 >= 20 && r1 < 50);
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: FNV-1a Hash String 32-bit & Seed Derivation
  // -------------------------------------------------------------------------
  describe("Test 2: Hàm hash chuỗi 32-bit ổn định (FNV-1a)", () => {
    it("hashString32 sinh mã hash ổn định và bất biến qua các lần chạy", () => {
      const input = "job-uuid-1234:scene-01";
      const hash1 = hashString32(input);
      const hash2 = hashString32(input);

      assert.strictEqual(hash1, hash2);
      assert.ok(Number.isInteger(hash1));
      assert.ok(hash1 >= 0 && hash1 <= 0xffffffff);
    });

    it("hashString32 xử lý chính xác chuỗi rỗng, chuỗi ASCII và chuỗi Unicode tiếng Việt", () => {
      const hEmpty = hashString32("");
      assert.strictEqual(hEmpty, 2166136261, "Chuỗi rỗng phải trả về FNV offset basis");

      const hAscii = hashString32("hello");
      assert.strictEqual(hAscii, 1335831723);

      const hUnicode = hashString32("Hồ Gươm sáng sớm");
      assert.ok(hUnicode > 0);
      assert.strictEqual(hUnicode, hashString32("Hồ Gươm sáng sớm"));
    });

    it("getSceneSeed và getElementSeed suy diễn seed có tính tất định và phân cấp", () => {
      const jobId = "job-abc-xyz";
      const sceneId = "scene-intro";
      const elementId = "title-h1";

      const sceneSeed = getSceneSeed(jobId, sceneId);
      const expectedSceneSeed = hashString32(`${jobId}:${sceneId}`);
      assert.strictEqual(sceneSeed, expectedSceneSeed);

      const elementSeed = getElementSeed(sceneSeed, elementId);
      const expectedElementSeed = hashString32(`${sceneSeed}:${elementId}`);
      assert.strictEqual(elementSeed, expectedElementSeed);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Static Linter (compLinter) phát hiện và chặn vi phạm
  // -------------------------------------------------------------------------
  describe("Test 3: Lint tĩnh phát hiện và chặn hàm bất định trên render path", () => {
    it("chặn Math.random() và báo lỗi rõ ràng với vị trí dòng/cột", () => {
      const code = `
        const x = 10;
        const rand = Math.random();
        tl.to(".box", { x: rand });
      `;
      const res = lintCompCode(code, { sceneId: "scene-err-1" });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations.length, 1);
      assert.strictEqual(res.violations[0].type, "MATH_RANDOM");
      assert.strictEqual(res.violations[0].line, 3);
      assert.ok(res.errors[0].includes("Math.random()"));
    });

    it("chặn Date.now() trên render path", () => {
      const code = `
        const start = Date.now();
      `;
      const res = lintCompCode(code, { sceneId: "scene-err-2" });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations[0].type, "DATE_NOW");
      assert.strictEqual(res.violations[0].line, 2);
    });

    it("chặn new Date() và Date() không có đối số (lấy giờ hệ thống hiện tại)", () => {
      const code1 = `const now = new Date();`;
      const res1 = lintCompCode(code1);
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.violations[0].type, "DATE_CONSTRUCTOR_NOW");

      const code2 = `const str = Date();`;
      const res2 = lintCompCode(code2);
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.violations[0].type, "DATE_CONSTRUCTOR_NOW");
    });

    it("chặn performance.now() trên render path", () => {
      const code = `
        const t0 = performance.now();
      `;
      const res = lintCompCode(code);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations[0].type, "PERFORMANCE_NOW");
      assert.strictEqual(res.violations[0].line, 2);
    });

    it("chặn requestAnimationFrame tự chạy", () => {
      const code = `
        function loop() {
          requestAnimationFrame(loop);
        }
      `;
      const res = lintCompCode(code);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations[0].type, "REQUEST_ANIMATION_FRAME");
      assert.strictEqual(res.violations[0].line, 3);
    });

    it("chặn setTimeout và setInterval", () => {
      const code = `
        setTimeout(() => {}, 1000);
        setInterval(() => {}, 500);
      `;
      const res = lintCompCode(code);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.violations.length, 2);
      assert.strictEqual(res.violations[0].type, "NON_DETERMINISTIC_TIMER");
      assert.strictEqual(res.violations[1].type, "NON_DETERMINISTIC_TIMER");
    });

    it("bỏ qua comment chứa từ khóa (không tạo false positive)", () => {
      const code = `
        // Math.random() is forbidden here
        /* Date.now() should not be used */
        const x = window.__rand(0, 10);
      `;
      const res = lintCompCode(code);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.violations.length, 0);
    });

    it("assertDeterministicScript ném lỗi DeterministicContractError khi script chứa vi phạm", () => {
      const badScript: videoScript = {
        ...validMockScript,
        scenes: [
          {
            ...validMockScene,
            id: "bad-scene",
            jsCode: "const v = Math.random() * 100;",
          },
        ],
      };

      assert.throws(
        () => assertDeterministicScript(badScript),
        (err: any) => {
          assert.ok(err instanceof DeterministicContractError);
          assert.ok(err.message.includes("Deterministic rendering contract violated"));
          assert.ok(err.message.includes("MATH_RANDOM"));
          assert.strictEqual(err.violations.length, 1);
          return true;
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Comp hợp lệ pass qua linter và assemble thành công
  // -------------------------------------------------------------------------
  describe("Test 4: Comp hợp lệ đáp ứng đầy đủ contract và đóng gói thành công", () => {
    it("script hợp lệ vượt qua lintVideoScript với valid = true", () => {
      const res = lintVideoScript(validMockScript);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.violations.length, 0);
    });

    it("assembleHTML thành công và nhúng đầy đủ các API contract Spec B vào file HTML", async () => {
      const testSeed = 123456789;
      const result = await assembleHTML(
        validMockScript,
        sampleDurations,
        1920,
        1080,
        testTempDir,
        undefined,
        { seed: testSeed, jobId: "job-spec-b-test" }
      );

      const html = result.htmlContent;

      // Contract Spec B
      assert.ok(html.includes(`window.__renderSeed = ${testSeed};`), "Phải chứa window.__renderSeed");
      assert.ok(html.includes("window.RNG = RNG;"), "Phải phơi ra window.RNG");
      assert.ok(html.includes("window.hashString32 = hashString32;"), "Phải phơi ra window.hashString32");
      assert.ok(html.includes("window.__rng = RNG(window.__renderSeed);"), "Phải khởi tạo window.__rng từ renderSeed");
      assert.match(html, /window\.__rand = function/, "Phải chứa helper window.__rand");
      assert.match(html, /window\.__seekTo = function/, "Phải chứa hàm seek timeline f(t)");

      // Blending nhân (multiply-style) cho cross-fade độc lập thứ tự render
      assert.ok(html.includes("mix-blend-mode: multiply;"), "Phải chứa rule CSS mix-blend-mode multiply");
      assert.ok(html.includes("isolation: isolate;"), "Phải có isolation: isolate cho scene");
      assert.ok(html.includes("window.__crossFade = function"), "Phải chứa helper cross-fade dạng nhân");

      // Trạng thái sẵn sàng
      assert.ok(html.includes("window.__ready = true;"), "Phải có tín hiệu window.__ready = true");
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Tính Determinism 100% của Comp Assemble
  // -------------------------------------------------------------------------
  describe("Test 5: Kiểm tra tính Determinism 100% của Comp", () => {
    it("Assemble 2 lần với cùng jobId + script sinh ra file HTML khớp 100% từng byte", async () => {
      const dir1 = join(testTempDir, "run-1");
      const dir2 = join(testTempDir, "run-2");

      const jobId = "deterministic-fixed-job-id-999";

      const res1 = await assembleHTML(
        validMockScript,
        sampleDurations,
        1920,
        1080,
        dir1,
        undefined,
        { jobId }
      );

      const res2 = await assembleHTML(
        validMockScript,
        sampleDurations,
        1920,
        1080,
        dir2,
        undefined,
        { jobId }
      );

      assert.strictEqual(
        res1.htmlContent,
        res2.htmlContent,
        "Nội dung file HTML của 2 lần assemble với cùng jobId phải khớp 100% không lệch 1 ký tự"
      );

      const fileContent1 = readFileSync(res1.htmlPath, "utf-8");
      const fileContent2 = readFileSync(res2.htmlPath, "utf-8");
      assert.strictEqual(fileContent1, fileContent2);
    });

    it("Hai seed khác nhau sinh ra file HTML khác nhau ở giá trị seed", async () => {
      const dirA = join(testTempDir, "seed-a");
      const dirB = join(testTempDir, "seed-b");

      const resA = await assembleHTML(
        validMockScript,
        sampleDurations,
        1920,
        1080,
        dirA,
        undefined,
        { seed: 11111 }
      );

      const resB = await assembleHTML(
        validMockScript,
        sampleDurations,
        1920,
        1080,
        dirB,
        undefined,
        { seed: 22222 }
      );

      assert.notStrictEqual(resA.htmlContent, resB.htmlContent);
      assert.ok(resA.htmlContent.includes("window.__renderSeed = 11111;"));
      assert.ok(resB.htmlContent.includes("window.__renderSeed = 22222;"));
    });
  });
});
