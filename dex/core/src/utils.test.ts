import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_TIMER_TIMEOUT_MS } from "./shared/number-coercion.js";
import { withTempDir } from "./test-helpers/temp-dir.js";
import {
  ensureDir,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTempDir({ prefix: "openclaw-test-" }, async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    try {
      const promise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps oversized sleep delays before scheduling", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const promise = sleep(Number.MAX_SAFE_INTEGER);

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), MAX_TIMER_TIMEOUT_MS);

      vi.advanceTimersByTime(MAX_TIMER_TIMEOUT_MS);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("resolveConfigDir", () => {
  it("prefers ~/.dex when legacy dir is missing", async () => {
    await withTempDir({ prefix: "openclaw-config-dir-" }, async (root) => {
      const newDir = path.join(root, ".dex");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("expands DEX_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/openclaw-home",
      DEX_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/openclaw-home", "state"));
  });

  it("falls back to the config file directory when only DEX_CONFIG_PATH is set", () => {
    const env = {
      HOME: "/tmp/openclaw-home",
      DEX_CONFIG_PATH: "~/profiles/dev/openclaw.json",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/openclaw-home", "profiles", "dev"));
  });
});

describe("resolveHomeDir", () => {
  it("prefers DEX_HOME over HOME", () => {
    vi.stubEnv("DEX_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(resolveHomeDir()).toBe(path.resolve("/srv/openclaw-home"));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("shortenHomePath", () => {
  it("uses $DEX_HOME prefix when DEX_HOME is set", () => {
    vi.stubEnv("DEX_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(shortenHomePath(`${path.resolve("/srv/openclaw-home")}/.openclaw/openclaw.json`)).toBe(
        "$DEX_HOME/.openclaw/openclaw.json",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("shortenHomeInString", () => {
  it("uses $DEX_HOME replacement when DEX_HOME is set", () => {
    vi.stubEnv("DEX_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(
        shortenHomeInString(
          `config: ${path.resolve("/srv/openclaw-home")}/.openclaw/openclaw.json`,
        ),
      ).toBe("config: $DEX_HOME/.openclaw/openclaw.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/openclaw", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "openclaw"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers DEX_HOME for tilde expansion", () => {
    vi.stubEnv("DEX_HOME", "/srv/openclaw-home");
    vi.stubEnv("HOME", "/home/other");
    try {
      expect(resolveUserPath("~/openclaw")).toBe(path.resolve("/srv/openclaw-home", "openclaw"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/openclaw-home",
      DEX_HOME: "/srv/openclaw-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/openclaw", env)).toBe(path.resolve("/srv/openclaw-home", "openclaw"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });

  it("returns empty string for undefined/null input", () => {
    expect(resolveUserPath(undefined as unknown as string)).toBe("");
    expect(resolveUserPath(null as unknown as string)).toBe("");
  });
});
