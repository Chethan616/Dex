import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMergedBundleMcpConfig, toCliBundleMcpServerConfig } from "./bundle-mcp-config.js";

const mocks = vi.hoisted(() => ({
  bundleMcp: {
    config: {
      mcpServers: {
        bundleProbe: {
          command: "node",
          args: ["./servers/probe.mjs"],
        },
      },
    },
    diagnostics: [],
  },
  builtinEngines: {
    servers: {} as Record<string, unknown>,
    statuses: [] as unknown[],
  },
}));

vi.mock("../plugins/bundle-mcp.js", () => ({
  loadEnabledBundleMcpConfig: () => mocks.bundleMcp,
}));

vi.mock("../engines/builtin-engines.js", () => ({
  resolveBuiltinEngineServers: () => mocks.builtinEngines,
}));

describe("loadMergedBundleMcpConfig", () => {
  it("lets OpenClaw mcp.servers override bundle defaults while preserving raw transport shape", () => {
    const merged = loadMergedBundleMcpConfig({
      workspaceDir: "/workspace",
      cfg: {
        plugins: {
          entries: {
            "bundle-probe": { enabled: true },
          },
        },
        mcp: {
          servers: {
            bundleProbe: {
              transport: "streamable-http",
              url: "https://mcp.example.com/mcp",
            },
          },
        },
      },
    });

    expect(merged.config.mcpServers.bundleProbe).toEqual({
      transport: "streamable-http",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("maps OpenClaw transports to downstream CLI types when requested", () => {
    expect(
      toCliBundleMcpServerConfig({
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp",
      }),
    ).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
    });
    expect(toCliBundleMcpServerConfig({ type: "sse", transport: "streamable-http" })).toEqual({
      type: "sse",
    });
  });

  it("keeps disabled OpenClaw MCP servers out of embedded runtimes", () => {
    const merged = loadMergedBundleMcpConfig({
      workspaceDir: "/workspace",
      cfg: {
        mcp: {
          servers: {
            disabledDocs: {
              enabled: false,
              command: "node",
              args: ["docs.mjs"],
            },
          },
        },
      },
    });

    expect(merged.config.mcpServers).not.toHaveProperty("disabledDocs");
  });

  it("lets disabled OpenClaw MCP servers tombstone bundle defaults with the same name", () => {
    const merged = loadMergedBundleMcpConfig({
      workspaceDir: "/workspace",
      cfg: {
        mcp: {
          servers: {
            bundleProbe: {
              enabled: false,
            },
          },
        },
      },
    });

    expect(merged.config.mcpServers).not.toHaveProperty("bundleProbe");
  });

  describe("builtin engines layer", () => {
    afterEach(() => {
      mocks.builtinEngines.servers = {};
    });

    it("registers builtin engines with no user mcp config at all", () => {
      mocks.builtinEngines.servers = {
        "windows-desktop-control": { command: "python", args: ["wdc.py"] },
        "browser-control": { command: "python", args: ["bc.py"] },
      };

      const merged = loadMergedBundleMcpConfig({ workspaceDir: "/workspace" });

      expect(merged.config.mcpServers).toHaveProperty("windows-desktop-control");
      expect(merged.config.mcpServers).toHaveProperty("browser-control");
    });

    it("lets a same-name user mcp.servers entry override the builtin engine", () => {
      mocks.builtinEngines.servers = {
        "browser-control": { command: "python", args: ["builtin.py"] },
      };

      const merged = loadMergedBundleMcpConfig({
        workspaceDir: "/workspace",
        cfg: {
          mcp: {
            servers: {
              "browser-control": { command: "node", args: ["custom.mjs"] },
            },
          },
        },
      });

      expect(merged.config.mcpServers["browser-control"]).toEqual({
        command: "node",
        args: ["custom.mjs"],
      });
    });

    it("lets a disabled user entry tombstone a builtin engine", () => {
      mocks.builtinEngines.servers = {
        "windows-desktop-control": { command: "python", args: ["wdc.py"] },
      };

      const merged = loadMergedBundleMcpConfig({
        workspaceDir: "/workspace",
        cfg: {
          mcp: {
            servers: {
              "windows-desktop-control": { enabled: false },
            },
          },
        },
      });

      expect(merged.config.mcpServers).not.toHaveProperty("windows-desktop-control");
    });
  });
});
