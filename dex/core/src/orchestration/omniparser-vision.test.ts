import { describe, expect, it, vi } from "vitest";
import {
  buildOmniParserVisionService,
  OmniParserVisionService,
  type ParseScreenCallback,
} from "./omniparser-vision.js";
import type { VisionRequest } from "./vision.js";

const REQ: VisionRequest = { timeoutMs: 5_000 };

function ok(elements: Array<{ label: string; type?: string; confidence?: number }>) {
  const call: ParseScreenCallback = vi.fn(async () => ({
    elements: elements.map((e, i) => ({
      bbox: [10, 10 + i * 30, 100, 24] as [number, number, number, number],
      label: e.label,
      type: e.type ?? "button",
      confidence: e.confidence,
    })),
    imagePath: "/tmp/cap.png",
    modelVersion: "omniparser-v2",
    durationMs: 120,
  }));
  return call;
}

describe("OmniParserVisionService.locate", () => {
  it("returns [] when no parseScreen transport is wired", async () => {
    const svc = new OmniParserVisionService();
    expect(await svc.locate(REQ)).toEqual([]);
  });

  it("translates parse_screen elements into VisionHits with defaults", async () => {
    const call = ok([{ label: "Export", confidence: 0.92 }, { label: "Save" }]);
    const svc = new OmniParserVisionService({ parseScreen: call });
    const hits = await svc.locate(REQ);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.label).toBe("Export");
    expect(hits[0]!.confidence).toBe(0.92);
    expect(hits[1]!.confidence).toBe(0.5); // default when missing
  });

  it("forwards region + caps to the underlying parse_screen call", async () => {
    const call = ok([{ label: "x" }]);
    const svc = new OmniParserVisionService({
      parseScreen: call,
      maxElements: 8,
    });
    await svc.locate({
      timeoutMs: 1_000,
      region: { x: 100, y: 200, w: 50, h: 25 },
    });
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        region: [100, 200, 50, 25],
        maxElements: 8,
        timeoutMs: 1_000,
      }),
    );
  });

  it("ranks hits matching the hint above unrelated hits", async () => {
    const call = ok([
      { label: "Random" },
      { label: "Export PNG" },
      { label: "Save Draft" },
    ]);
    const svc = new OmniParserVisionService({ parseScreen: call });
    const hits = await svc.locate({ timeoutMs: 1_000, hint: "Export button" });
    expect(hits[0]!.label).toBe("Export PNG");
  });

  it("returns [] when the transport throws -- callers should not have to try/catch", async () => {
    const call: ParseScreenCallback = vi.fn(async () => {
      throw new Error("python crashed");
    });
    const svc = new OmniParserVisionService({ parseScreen: call });
    expect(await svc.locate(REQ)).toEqual([]);
  });

  it("returns [] when the call exceeds the wall-clock budget", async () => {
    let resolveSlow: (v: unknown) => void = () => {};
    const slow: ParseScreenCallback = () =>
      new Promise<never>((res) => {
        resolveSlow = res as (v: unknown) => void;
      }) as ReturnType<ParseScreenCallback>;
    const svc = new OmniParserVisionService({ parseScreen: slow });
    const hits = await svc.locate({ timeoutMs: 25 });
    expect(hits).toEqual([]);
    // Let the dangling promise complete so vitest's leak detector stays quiet.
    resolveSlow({
      elements: [],
      imagePath: "",
      modelVersion: "",
      durationMs: 0,
    });
  });

  it("returns [] when caller passes a non-positive timeout", async () => {
    const call = ok([{ label: "x" }]);
    const svc = new OmniParserVisionService({ parseScreen: call });
    expect(await svc.locate({ timeoutMs: 0 })).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("OmniParserVisionService.ready", () => {
  it("returns false when no parseScreen transport is wired", async () => {
    expect(await new OmniParserVisionService().ready()).toBe(false);
  });

  it("returns true when parseScreen is wired and no status probe is given", async () => {
    const svc = new OmniParserVisionService({ parseScreen: ok([]) });
    expect(await svc.ready()).toBe(true);
  });

  it("consults the status callback when one is given", async () => {
    const svc = new OmniParserVisionService({
      parseScreen: ok([]),
      status: async () => ({ ready: false }),
    });
    expect(await svc.ready()).toBe(false);
  });

  it("caches the result so repeat probes are free", async () => {
    const probe = vi.fn(async () => ({ ready: true }));
    const svc = new OmniParserVisionService({
      parseScreen: ok([]),
      status: probe,
    });
    await svc.ready();
    await svc.ready();
    await svc.ready();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("returns false (rather than throwing) when the status probe fails", async () => {
    const svc = new OmniParserVisionService({
      parseScreen: ok([]),
      status: async () => {
        throw new Error("offline");
      },
    });
    expect(await svc.ready()).toBe(false);
  });

  it("resetReadyCache() forces a fresh probe", async () => {
    let on = true;
    const probe = vi.fn(async () => ({ ready: on }));
    const svc = new OmniParserVisionService({
      parseScreen: ok([]),
      status: probe,
    });
    expect(await svc.ready()).toBe(true);
    on = false;
    svc.resetReadyCache();
    expect(await svc.ready()).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("buildOmniParserVisionService", () => {
  it("constructs a service that hits the shared callback", async () => {
    const call = ok([{ label: "Click me" }]);
    const svc = buildOmniParserVisionService(call);
    const hits = await svc.locate(REQ);
    expect(hits).toHaveLength(1);
    expect(call).toHaveBeenCalledOnce();
  });
});
