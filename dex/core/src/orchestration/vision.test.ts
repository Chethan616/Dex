import { describe, expect, it } from "vitest";
import {
  NullVisionService,
  type VisionHit,
  type VisionRequest,
  type VisionService,
} from "./vision.js";

describe("NullVisionService", () => {
  it("returns [] from locate so callers treat 'no vision available' as 'no hits'", async () => {
    const svc = new NullVisionService();
    const req: VisionRequest = { timeoutMs: 5_000, hint: "Export" };
    const hits = await svc.locate(req);
    expect(hits).toEqual([]);
  });

  it("ready() resolves false so engines can short-circuit vision-assist", async () => {
    const svc = new NullVisionService();
    expect(await svc.ready()).toBe(false);
  });
});

describe("VisionService contract", () => {
  it("is implementable by a hand-rolled stub (shape check)", async () => {
    // The point of this test is structural: if VisionService grows a
    // required method, this fake implementation stops compiling and the
    // breakage is caught BEFORE the omniparser-backed impl in E.1 lands.
    const fake: VisionService = {
      async locate(req) {
        const fixed: VisionHit[] = [
          {
            bbox: [10, 10, 80, 30],
            label: req.hint ?? "",
            type: "button",
            confidence: 0.91,
          },
        ];
        return fixed;
      },
      async ready() {
        return true;
      },
    };
    const hits = await fake.locate({ timeoutMs: 1_000, hint: "Export" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe("Export");
    expect(await fake.ready()).toBe(true);
  });

  it("VisionRequest.region uses {x, y, w, h} not {x1, y1, x2, y2}", () => {
    // Sanity check on the type shape so a future "rename" can't silently
    // change the field set.
    const req: VisionRequest = {
      timeoutMs: 1,
      region: { x: 0, y: 0, w: 100, h: 50 },
    };
    expect(req.region!.w).toBe(100);
    expect(req.region!.h).toBe(50);
  });
});
