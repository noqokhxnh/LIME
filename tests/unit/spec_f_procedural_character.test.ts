/**
 * Test Suite cho Spec F (Procedural Characters)
 * Kiểm tra tính tất định của seed, độ tinh khiết của pose f(t), độ chính xác thời gian action và dàn dựng nhân vật.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";

import { generateAvatar } from "../../src/pipeline/character/avatar.js";
import { interpolatePose, computeRigJoints, lerpAngle, type SkeletalPose } from "../../src/pipeline/character/rig.js";
import { getIdlePose, getWalkPose, getRunPose, getLocomotionPose } from "../../src/pipeline/character/locomotion.js";
import { evaluateStagingState, type CharacterActionItem } from "../../src/pipeline/character/staging.js";
import { getEmoteDefinition } from "../../src/pipeline/character/emotes.js";
import { assembleHTML } from "../../src/pipeline/assembleHtml.js";
import { type videoScript, type scene } from "../../src/llm/schema.js";

describe("Workstream WS-F (Spec F): Procedural Characters", () => {
  describe("TC-SPEC-F-001: Tính tất định của Seeded Avatar Generator", () => {
    it("(a.1) Cùng cặp (seed, characterId) luôn tạo ra dữ liệu Avatar giống hệt nhau 100%", () => {
      const avatarA1 = generateAvatar(12345, "guide-01");
      const avatarA2 = generateAvatar(12345, "guide-01");

      assert.deepStrictEqual(avatarA1, avatarA2, "Hai avatar cùng seed và id phải đồng nhất");
      assert.strictEqual(avatarA1.characterId, "guide-01");
      assert.strictEqual(typeof avatarA1.proportions.headRadius, "number");
      assert.strictEqual(typeof avatarA1.style.strokeColor, "string");
    });

    it("(a.2) Khác seed hoặc khác characterId tạo ra Avatar khác biệt", () => {
      const base = generateAvatar(12345, "guide-01");
      const diffSeed = generateAvatar(54321, "guide-01");
      const diffId = generateAvatar(12345, "hero-99");

      assert.notDeepStrictEqual(base, diffSeed, "Khác seed phải tạo avatar khác nhau");
      assert.notDeepStrictEqual(base, diffId, "Khác characterId phải tạo avatar khác nhau");
    });

    it("(a.3) Lặp lại 50 lần cùng seed luôn bảo toàn cấu hình không trôi dạt", () => {
      const initial = generateAvatar(98765, "presenter");
      for (let i = 0; i < 50; i++) {
        const current = generateAvatar(98765, "presenter");
        assert.deepStrictEqual(current, initial, `Lần thử ${i + 1} phải khớp tuyệt đối`);
      }
    });
  });

  describe("TC-SPEC-F-002: Độ tinh khiết của Pose Kinematics: pose = f(t)", () => {
    it("(b.1) Hàm getIdlePose, getWalkPose, getRunPose là pure function khi seek tiến lùi", () => {
      const tTarget = 1.45;
      const idle1 = getIdlePose(tTarget, 100, 200);
      const walk1 = getWalkPose(tTarget, 100, 200);
      const run1 = getRunPose(tTarget, 100, 200);

      // Seek đi các thời điểm khác nhau
      getIdlePose(0.1);
      getWalkPose(3.8);
      getRunPose(12.5);
      getIdlePose(0.0);

      // Seek quay lại đúng thời điểm tTarget
      const idle2 = getIdlePose(tTarget, 100, 200);
      const walk2 = getWalkPose(tTarget, 100, 200);
      const run2 = getRunPose(tTarget, 100, 200);

      assert.deepStrictEqual(idle1, idle2, "Seek lùi getIdlePose phải khớp pixel/dữ liệu hoàn toàn");
      assert.deepStrictEqual(walk1, walk2, "Seek lùi getWalkPose phải khớp pixel/dữ liệu hoàn toàn");
      assert.deepStrictEqual(run1, run2, "Seek lùi getRunPose phải khớp pixel/dữ liệu hoàn toàn");
    });

    it("(b.2) computeRigJoints và interpolatePose cho kết quả tất định và liên tục", () => {
      const avatar = generateAvatar(42, "tester");
      const poseA = getIdlePose(0);
      const poseB = getWalkPose(0.4);

      const mid1 = interpolatePose(poseA, poseB, 0.5);
      const mid2 = interpolatePose(poseA, poseB, 0.5);
      assert.deepStrictEqual(mid1, mid2, "Nội suy pose phải là hàm thuần túy");

      const joints1 = computeRigJoints(mid1, avatar.proportions);
      const joints2 = computeRigJoints(mid1, avatar.proportions);
      assert.deepStrictEqual(joints1, joints2, "Forward kinematics phải tất định");
      assert.ok(joints1.head.y < joints1.neck.y, "Đầu phải nằm phía trên cổ");
      assert.ok(joints1.leftFoot.y > joints1.leftKnee.y, "Bàn chân phải nằm phía dưới đầu gối");
    });
  });

  describe("TC-SPEC-F-003: Độ chính xác thời gian hành động (Start/End within ±1 frame)", () => {
    const ONE_FRAME = 1 / 30; // 0.0333s tại 30fps

    const actions: CharacterActionItem[] = [
      {
        characterId: "guide",
        action: "enter",
        tStart: 1.0,
        tEnd: 2.5,
        position: { x: 500, y: 700 },
        direction: "right",
      },
      {
        characterId: "guide",
        action: "idle",
        tStart: 2.5,
        tEnd: 4.0,
        position: { x: 500, y: 700 },
        direction: "right",
      },
    ];

    it("(c.1) Trước tStart hơn 1 frame, nhân vật ở trạng thái enter phải ẩn hoàn toàn", () => {
      const stateBefore = evaluateStagingState(actions, 1.0 - ONE_FRAME - 0.005);
      assert.ok(stateBefore, "Phải có trạng thái staging");
      assert.strictEqual(stateBefore?.visible, false, "Nhân vật phải ẩn trước khi enter");
      assert.strictEqual(stateBefore?.opacity, 0);
    });

    it("(c.2) Tại đúng tStart (sai số < 1 frame), nhân vật bắt đầu xuất hiện", () => {
      const stateAtStart = evaluateStagingState(actions, 1.0);
      assert.ok(stateAtStart);
      assert.strictEqual(stateAtStart?.currentAction, "enter");
      // Tại progress = 0 của enter, x cách targetX một khoảng offset
      assert.ok(stateAtStart!.x < 500, "Vị trí bắt đầu enter phải ở phía ngoài");
    });

    it("(c.3) Chuyển giao giữa enter và idle tại t = 2.5s tôn trọng ngưỡng sai số ±1 frame", () => {
      const stateJustBefore = evaluateStagingState(actions, 2.5 - ONE_FRAME);
      const stateJustAfter = evaluateStagingState(actions, 2.5 + ONE_FRAME);

      assert.strictEqual(stateJustBefore?.currentAction, "enter");
      assert.strictEqual(stateJustAfter?.currentAction, "idle");
      // Vị trí x tại điểm kết thúc enter tiệm cận targetX
      assert.ok(Math.abs(stateJustBefore!.x - 500) < 15, "Vị trí cuối của enter phải tiệm cận targetX");
      assert.strictEqual(stateJustAfter!.x, 500, "Vị trí của idle phải bằng targetX");
    });
  });

  describe("TC-SPEC-F-004: Kịch bản tuần tự toàn trình: enter -> emote -> exit", () => {
    const fullSequence: CharacterActionItem[] = [
      {
        characterId: "guide",
        action: "enter",
        tStart: 0.0,
        tEnd: 1.5,
        position: { x: 600, y: 800 },
        direction: "right",
      },
      {
        characterId: "guide",
        action: "emote",
        tStart: 1.5,
        tEnd: 3.5,
        emote: "happy",
        position: { x: 600, y: 800 },
        direction: "right",
      },
      {
        characterId: "guide",
        action: "exit",
        tStart: 3.5,
        tEnd: 5.0,
        position: { x: 600, y: 800 },
        direction: "right",
      },
    ];

    it("(d.1) Di chuyển và biểu cảm chuyển đổi tuần tự tất định", () => {
      // 1. Pha enter (t = 0.75s)
      const stateEnter = evaluateStagingState(fullSequence, 0.75);
      assert.ok(stateEnter);
      assert.strictEqual(stateEnter?.currentAction, "enter");
      assert.ok(stateEnter!.x > 340 && stateEnter!.x < 600, "Tọa độ x phải tăng dần khi enter");

      // 2. Pha emote happy (t = 2.5s)
      const stateEmote = evaluateStagingState(fullSequence, 2.5);
      assert.ok(stateEmote);
      assert.strictEqual(stateEmote?.currentAction, "emote");
      assert.strictEqual(stateEmote?.emote, "happy");
      assert.strictEqual(stateEmote?.x, 600);

      // Biểu cảm happy chứa đúng các primitive mắt cong và má hồng
      const emoteDef = getEmoteDefinition("happy");
      assert.strictEqual(emoteDef.type, "happy");
      assert.ok(emoteDef.accentMarks.length >= 2, "Emote happy phải có vệt ửng hồng");

      // 3. Pha exit (t = 4.25s)
      const stateExit = evaluateStagingState(fullSequence, 4.25);
      assert.ok(stateExit);
      assert.strictEqual(stateExit?.currentAction, "exit");
      assert.ok(stateExit!.x > 600, "Tọa độ x phải vượt qua targetX khi exit");

      // 4. Sau khi kết thúc exit (t = 5.2s)
      const stateAfter = evaluateStagingState(fullSequence, 5.2);
      assert.strictEqual(stateAfter?.visible, false, "Sau exit nhân vật phải ẩn hoàn toàn");
    });

    it("(d.2) assembleHTML nhúng đầy đủ canvas layer và character actions vào kịch bản", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "lime-spec-f-test-"));
      try {
        const mockScene: scene = {
          id: "scene-char",
          title: "Giới thiệu nhân vật",
          voiceOverText: "Xin chào các bạn, tôi là người dẫn chuyện của video này.",
          visualDescription: "Người dẫn chuyện bước vào và chào khán giả",
          htmlCode: '<div class="content"><h1>Xin chào</h1></div>',
          cssCode: ".content { color: #fff; }",
          jsCode: "const tl = gsap.timeline(); tl.to('.content', { opacity: 1, duration: {{SCENE_DURATION}} });",
          transition: "fade",
          backgroundColor: "#0a0a0a",
          characterActions: fullSequence,
        };

        const mockScript: videoScript = {
          id: "script-spec-f-demo",
          title: "Spec F Procedural Demo",
          description: "Kịch bản demo nhân vật thủ tục",
          globalStyles: "",
          globalSetupJs: "",
          scenes: [mockScene],
          boundaries: [],
          colorPalette: {
            primary: "#3b82f6",
            secondary: "#1d4ed8",
            accent: "#f59e0b",
            background: "#0a0a0a",
            text: "#ffffff",
          },
          fontFamily: "Inter",
        };

        const result = await assembleHTML(mockScript, { "scene-char": 5.0 }, 1920, 1080, tmpDir, undefined, {
          skipFontSubset: true,
          seed: 42,
        });

        assert.ok(existsSync(result.htmlPath), "File index.html phải được tạo");
        const html = readFileSync(result.htmlPath, "utf-8");

        // Kiểm tra canvas layer của nhân vật được nhúng vào DOM
        assert.ok(html.includes('id="char_canvas_scene_char"'), "Canvas nhân vật phải tồn tại trong DOM");
        assert.ok(html.includes("window.__renderCharacters"), "Runtime nhân vật phải được định nghĩa");
        assert.ok(html.includes("window.__sceneCharacterActions"), "Kịch bản hành động nhân vật phải được lưu");
        assert.ok(html.includes('"action":"enter"'), "Kịch bản phải chứa hành động enter");
        assert.ok(html.includes('"action":"emote"'), "Kịch bản phải chứa hành động emote");
        assert.ok(html.includes('"action":"exit"'), "Kịch bản phải chứa hành động exit");
      } finally {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
