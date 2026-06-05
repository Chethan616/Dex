import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DEFAULT_AGENT_WORKSPACE_DIR", () => {
  it("uses DEX_HOME when resolving the default workspace dir", () => {
    const home = path.join(path.sep, "srv", "openclaw-home");
    vi.stubEnv("DEX_HOME", home);
    vi.stubEnv("HOME", path.join(path.sep, "home", "other"));

    expect(resolveDefaultAgentWorkspaceDir()).toBe(
      path.join(path.resolve(home), ".dex", "workspace"),
    );
  });

  it("uses DEX_WORKSPACE_DIR before DEX_HOME", () => {
    const workspaceDir = path.join(path.sep, "srv", "openclaw-workspace");
    vi.stubEnv("DEX_WORKSPACE_DIR", workspaceDir);
    vi.stubEnv("DEX_HOME", path.join(path.sep, "srv", "openclaw-home"));

    expect(resolveDefaultAgentWorkspaceDir()).toBe(path.resolve(workspaceDir));
  });
});
