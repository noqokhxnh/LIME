import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { snapToBeat } from "../../src/audio/beatDetector.js";

describe("beatDetector (Issue #32)", () => {
    it("snapToBeat: snap về beat gần nhất", () => {
        const beats = [0, 0.5, 1.0, 1.5, 2.0];
        // 0.55 gần 0.5 hơn 1.0
        assert.equal(snapToBeat(0.55, beats), 0.5);
        // 1.4 gần 1.5
        assert.equal(snapToBeat(1.4, beats), 1.5);
    });

    it("snapToBeat: không snap nếu quá xa", () => {
        const beats = [0, 1.0, 2.0];
        // 0.5 cách đều 0 và 1.0, nhưng maxSnap=0.3 nên không snap
        assert.equal(snapToBeat(0.5, beats, 0.3), 0.5);
    });

    it("snapToBeat: trả về nguyên nếu không có beats", () => {
        assert.equal(snapToBeat(1.5, []), 1.5);
    });
});
