import { describe, expect, it } from "vitest";
import type { DexConfig } from "../../../config/types.openclaw.js";
import { resolveQueueSettings } from "./settings.js";

describe("resolveQueueSettings", () => {
  it("defaults inbound channels to steering settings", () => {
    expect(resolveQueueSettings({ cfg: {} as DexConfig })).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("uses the short debounce when collect is selected globally", () => {
    expect(
      resolveQueueSettings({
        cfg: {
          messages: {
            queue: {
              mode: "collect",
            },
          },
        } as DexConfig,
      }),
    ).toEqual({
      mode: "collect",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("keeps explicit channel queue overrides ahead of defaults", () => {
    expect(
      resolveQueueSettings({
        cfg: {
          messages: {
            queue: {
              mode: "followup",
              debounceMs: 750,
              byChannel: {
                discord: "collect",
              },
            },
          },
        } as DexConfig,
        channel: "discord",
      }),
    ).toEqual({
      mode: "collect",
      debounceMs: 750,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("uses explicit steer mode from config", () => {
    expect(
      resolveQueueSettings({
        cfg: {
          messages: {
            queue: {
              mode: "steer",
            },
          },
        } as DexConfig,
      }),
    ).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("ignores removed steering queue modes from stale config", () => {
    expect(
      resolveQueueSettings({
        cfg: {
          messages: {
            queue: {
              mode: "steer-backlog" as never,
            },
          },
        } as DexConfig,
      }),
    ).toEqual({
      mode: "steer",
      debounceMs: 500,
      cap: 20,
      dropPolicy: "summarize",
    });
  });

  it("maps retired persisted session queue modes to compatible modes", () => {
    expect(
      resolveQueueSettings({
        cfg: {} as DexConfig,
        sessionEntry: { sessionId: "test-session", updatedAt: 0, queueMode: "queue" as never },
      }).mode,
    ).toBe("steer");
    expect(
      resolveQueueSettings({
        cfg: {} as DexConfig,
        sessionEntry: {
          sessionId: "test-session",
          updatedAt: 0,
          queueMode: "steer-backlog" as never,
        },
      }).mode,
    ).toBe("followup");
    expect(
      resolveQueueSettings({
        cfg: {} as DexConfig,
        sessionEntry: {
          sessionId: "test-session",
          updatedAt: 0,
          queueMode: "steer+backlog" as never,
        },
      }).mode,
    ).toBe("followup");
  });
});
