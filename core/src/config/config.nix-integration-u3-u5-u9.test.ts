import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GATEWAY_PORT,
  resolveConfigPathCandidate,
  resolveGatewayPort,
  resolveIsNixMode,
  resolveStateDir,
} from "./config.js";
import { withTempHome } from "./test-helpers.js";

vi.unmock("../version.js");

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Hermetic env: don't inherit process.env because other tests may mutate it.
  return { ...overrides };
}

describe("Nix integration (U3, U5, U9)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("U3: isNixMode env var detection", () => {
    it("isNixMode is false when DEX_NIX_MODE is not set", () => {
      expect(resolveIsNixMode(envWith({ DEX_NIX_MODE: undefined }))).toBe(false);
    });

    it("isNixMode is false when DEX_NIX_MODE is empty", () => {
      expect(resolveIsNixMode(envWith({ DEX_NIX_MODE: "" }))).toBe(false);
    });

    it("isNixMode is false when DEX_NIX_MODE is not '1'", () => {
      expect(resolveIsNixMode(envWith({ DEX_NIX_MODE: "true" }))).toBe(false);
    });

    it("isNixMode is true when DEX_NIX_MODE=1", () => {
      expect(resolveIsNixMode(envWith({ DEX_NIX_MODE: "1" }))).toBe(true);
    });
  });

  describe("U5: CONFIG_PATH and STATE_DIR env var overrides", () => {
    it("STATE_DIR defaults to ~/.dex when env not set", () => {
      expect(resolveStateDir(envWith({ DEX_STATE_DIR: undefined }))).toMatch(/\.openclaw$/);
    });

    it("STATE_DIR respects DEX_STATE_DIR override", () => {
      expect(resolveStateDir(envWith({ DEX_STATE_DIR: "/custom/state/dir" }))).toBe(
        path.resolve("/custom/state/dir"),
      );
    });

    it("STATE_DIR respects DEX_HOME when state override is unset", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveStateDir(envWith({ DEX_HOME: customHome, DEX_STATE_DIR: undefined })),
      ).toBe(path.join(path.resolve(customHome), ".dex"));
    });

    it("CONFIG_PATH defaults to DEX_HOME/.openclaw/openclaw.json", () => {
      const customHome = path.join(path.sep, "custom", "home");
      expect(
        resolveConfigPathCandidate(
          envWith({
            DEX_HOME: customHome,
            DEX_CONFIG_PATH: undefined,
            DEX_STATE_DIR: undefined,
          }),
        ),
      ).toBe(path.join(path.resolve(customHome), ".dex", "openclaw.json"));
    });

    it("CONFIG_PATH defaults to ~/.dex/openclaw.json when env not set", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ DEX_CONFIG_PATH: undefined, DEX_STATE_DIR: undefined }),
        ),
      ).toMatch(/\.openclaw[\\/]openclaw\.json$/);
    });

    it("CONFIG_PATH respects DEX_CONFIG_PATH override", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ DEX_CONFIG_PATH: "/nix/store/abc/openclaw.json" }),
        ),
      ).toBe(path.resolve("/nix/store/abc/openclaw.json"));
    });

    it("CONFIG_PATH expands ~ in DEX_CONFIG_PATH override", async () => {
      await withTempHome(async (home) => {
        expect(
          resolveConfigPathCandidate(
            envWith({ DEX_HOME: home, DEX_CONFIG_PATH: "~/.dex/custom.json" }),
            () => home,
          ),
        ).toBe(path.join(home, ".dex", "custom.json"));
      });
    });

    it("CONFIG_PATH uses STATE_DIR when only state dir is overridden", () => {
      expect(
        resolveConfigPathCandidate(
          envWith({ DEX_STATE_DIR: "/custom/state", DEX_TEST_FAST: "1" }),
          () => path.join(path.sep, "tmp", "openclaw-config-home"),
        ),
      ).toBe(path.join(path.resolve("/custom/state"), "openclaw.json"));
    });
  });

  describe("U6: gateway port resolution", () => {
    it("uses default when env and config are unset", () => {
      expect(resolveGatewayPort({}, envWith({ DEX_GATEWAY_PORT: undefined }))).toBe(
        DEFAULT_GATEWAY_PORT,
      );
    });

    it("prefers DEX_GATEWAY_PORT over config", () => {
      expect(
        resolveGatewayPort(
          { gateway: { port: 19002 } },
          envWith({ DEX_GATEWAY_PORT: "19001" }),
        ),
      ).toBe(19001);
    });

    it("falls back to config when env is invalid", () => {
      expect(
        resolveGatewayPort(
          { gateway: { port: 19003 } },
          envWith({ DEX_GATEWAY_PORT: "nope" }),
        ),
      ).toBe(19003);
    });
  });
});
