import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { createConchTestRuntime } from "./conch.test-helpers.js";
import { executeConchOperation, parseConchOperation } from "./operations.js";

type TestConfig = Record<string, unknown>;

function parseLastJsonLine(raw: string): unknown {
  const lastLine = raw.trim().split("\n").at(-1);
  if (!lastLine) {
    throw new Error("Expected audit log to contain at least one JSON line");
  }
  return JSON.parse(lastLine) as unknown;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function expectRecordFields(record: Record<string, unknown>, fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    expect(record[key]).toEqual(value);
  }
}

function expectAuditRecord(
  audit: unknown,
  fields: Record<string, unknown>,
  detailFields: Record<string, unknown>,
) {
  const auditRecord = requireRecord(audit, "audit record");
  expectRecordFields(auditRecord, fields);
  expectRecordFields(requireRecord(auditRecord.details, "audit details"), detailFields);
}

function requireFirstMockCall(mock: unknown, label: string): unknown[] {
  const call = (mock as { mock?: { calls?: unknown[][] } }).mock?.calls?.[0];
  if (!call) {
    throw new Error(`missing ${label} call`);
  }
  return call;
}

function expectRuntimeArg(value: unknown) {
  const runtime = requireRecord(value, "runtime argument");
  expect(typeof runtime.log).toBe("function");
}

const mockConfig = vi.hoisted(() => {
  const initial = {};
  const state = {
    path: "/tmp/openclaw.json",
    exists: true,
    config: initial as TestConfig,
    hash: "mock-hash-0" as string | undefined,
  };
  const cloneConfig = () => structuredClone(state.config);
  const snapshot = () => {
    const config = cloneConfig();
    return {
      path: state.path,
      exists: state.exists,
      raw: state.exists ? `${JSON.stringify(config)}\n` : null,
      parsed: state.exists ? config : undefined,
      sourceConfig: config,
      resolved: config,
      valid: state.exists,
      runtimeConfig: config,
      config,
      hash: state.hash,
      issues: state.exists ? [] : [{ path: "", message: "missing config" }],
      warnings: [],
      legacyIssues: [],
    };
  };
  return {
    reset() {
      state.path = "/tmp/openclaw.json";
      state.exists = true;
      state.config = {};
      state.hash = "mock-hash-0";
    },
    missing(pathLocal: string) {
      state.path = pathLocal;
      state.exists = false;
      state.config = {};
      state.hash = undefined;
    },
    currentConfig() {
      return cloneConfig();
    },
    readConfigFileSnapshot: vi.fn(async () => snapshot()),
    mutateConfigFile: vi.fn(
      async (params: {
        mutate: (
          draft: TestConfig,
          context: { snapshot: ReturnType<typeof snapshot> },
        ) => Promise<void> | void;
      }) => {
        const before = snapshot();
        const draft = cloneConfig();
        await params.mutate(draft, { snapshot: before });
        state.exists = true;
        state.config = draft;
        state.hash = "mock-hash-1";
        return {
          path: state.path,
          previousHash: before.hash ?? null,
          persistedHash: before.hash ?? null,
          snapshot: before,
          nextConfig: cloneConfig(),
          result: undefined,
        };
      },
    ),
  };
});

vi.mock("./probes.js", () => ({
  probeLocalCommand: vi.fn(async (command: string) => ({
    command,
    found: false,
    error: "not found",
  })),
  probeGatewayUrl: vi.fn(async (url: string) => ({ reachable: false, url, error: "offline" })),
}));

vi.mock("./overview.js", () => ({
  formatConchOverview: () => "Default model: openai/gpt-5.5",
  loadConchOverview: vi.fn(async () => ({
    defaultAgentId: "main",
    defaultModel: undefined,
    agents: [
      { id: "main", isDefault: true },
      { id: "work", isDefault: false, model: "openai/gpt-5.2" },
    ],
    config: { path: "/tmp/openclaw.json", exists: true, valid: true, issues: [], hash: null },
    tools: {
      codex: { command: "codex", found: false, error: "not found" },
      claude: { command: "claude", found: false, error: "not found" },
      apiKeys: { openai: true, anthropic: false },
    },
    gateway: {
      url: "ws://127.0.0.1:18789",
      source: "local loopback",
      reachable: false,
      error: "offline",
    },
    references: {
      docsUrl: "https://docs.openclaw.ai",
      sourceUrl: "https://github.com/openclaw/openclaw",
    },
  })),
}));

vi.mock("../config/config.js", () => ({
  mutateConfigFile: mockConfig.mutateConfigFile,
  readConfigFileSnapshot: mockConfig.readConfigFileSnapshot,
}));

vi.mock("../commands/models/shared.js", () => ({
  applyDefaultModelPrimaryUpdate: ({
    cfg,
    modelRaw,
    field,
  }: {
    cfg: TestConfig;
    modelRaw: string;
    field: "model" | "imageModel";
  }) => ({
    ...cfg,
    agents: {
      ...(cfg.agents as TestConfig | undefined),
      defaults: {
        ...(cfg.agents as { defaults?: TestConfig } | undefined)?.defaults,
        [field]: { primary: modelRaw },
      },
    },
  }),
}));

vi.mock("../config/model-input.js", () => ({
  resolveAgentModelPrimaryValue: (model?: string | { primary?: string }) =>
    typeof model === "string" ? model : model?.primary,
}));

describe("parseConchOperation", () => {
  beforeEach(() => {
    mockConfig.reset();
    vi.stubEnv("DEX_TEST_FAST", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses typed model writes", () => {
    expect(parseConchOperation("set default model openai/gpt-5.2")).toEqual({
      kind: "set-default-model",
      model: "openai/gpt-5.2",
    });
    expect(parseConchOperation("configure models openai/gpt-5.2")).toEqual({
      kind: "set-default-model",
      model: "openai/gpt-5.2",
    });
  });

  it("parses verbal agent switching", () => {
    expect(parseConchOperation("talk to work agent")).toEqual({
      kind: "open-tui",
      agentId: "work",
    });
  });

  it("keeps ambiguous model requests read-only", () => {
    expect(parseConchOperation("models please")).toEqual({ kind: "models" });
  });

  it("parses gateway lifecycle operations", () => {
    expect(parseConchOperation("gateway status")).toEqual({ kind: "gateway-status" });
    expect(parseConchOperation("restart gateway")).toEqual({ kind: "gateway-restart" });
    expect(parseConchOperation("start gateway")).toEqual({ kind: "gateway-start" });
    expect(parseConchOperation("stop gateway")).toEqual({ kind: "gateway-stop" });
  });

  it("parses config and doctor repair operations", () => {
    expect(parseConchOperation("validate config")).toEqual({ kind: "config-validate" });
    expect(parseConchOperation("config set gateway.port 19001")).toEqual({
      kind: "config-set",
      path: "gateway.port",
      value: "19001",
    });
    expect(parseConchOperation("config set-ref gateway.auth.token env GATEWAY_TOKEN")).toEqual(
      {
        kind: "config-set-ref",
        path: "gateway.auth.token",
        source: "env",
        id: "GATEWAY_TOKEN",
      },
    );
    expect(parseConchOperation("doctor fix")).toEqual({ kind: "doctor-fix" });
  });

  it("parses plugin management operations", () => {
    expect(parseConchOperation("plugins list")).toEqual({ kind: "plugin-list" });
    expect(parseConchOperation("list plugin")).toEqual({ kind: "plugin-list" });
    expect(parseConchOperation("plugins search calendar sync")).toEqual({
      kind: "plugin-search",
      query: "calendar sync",
    });
    expect(parseConchOperation("install npm plugin @openclaw/demo")).toEqual({
      kind: "plugin-install",
      spec: "npm:@openclaw/demo",
    });
    expect(parseConchOperation("plugin install clawhub:openclaw-demo")).toEqual({
      kind: "plugin-install",
      spec: "clawhub:openclaw-demo",
    });
    expect(parseConchOperation("plugin uninstall openclaw-demo")).toEqual({
      kind: "plugin-uninstall",
      pluginId: "openclaw-demo",
    });
  });

  it("parses agent creation requests", () => {
    expect(
      parseConchOperation("create agent Work workspace /tmp/work model openai/gpt-5.2"),
    ).toEqual({
      kind: "create-agent",
      agentId: "work",
      workspace: "/tmp/work",
      model: "openai/gpt-5.2",
    });
    expect(parseConchOperation("add agent ops")).toEqual({
      kind: "create-agent",
      agentId: "ops",
    });
    expect(parseConchOperation("setup workspace /tmp/work model openai/gpt-5.5")).toEqual({
      kind: "setup",
      workspace: "/tmp/work",
      model: "openai/gpt-5.5",
    });
    expect(parseConchOperation("setup agent ops")).toEqual({
      kind: "create-agent",
      agentId: "ops",
    });
  });

  it("requires approval before restarting gateway", async () => {
    const { runtime, lines } = createConchTestRuntime();
    const runGatewayRestart = vi.fn(async () => {});

    const result = await executeConchOperation({ kind: "gateway-restart" }, runtime, {
      deps: { runGatewayRestart },
    });

    expectRecordFields(result as unknown as Record<string, unknown>, {
      applied: false,
      message: "Plan: restart the Gateway. Say yes to apply.",
    });
    expect(lines.join("\n")).toContain("Plan: restart the Gateway");
    expect(runGatewayRestart).not.toHaveBeenCalled();
  });

  it("validates missing config without exiting the process", async () => {
    mockConfig.missing("/tmp/openclaw.json");
    const { runtime, lines } = createConchTestRuntime();

    const result = await executeConchOperation({ kind: "config-validate" }, runtime);
    expect(result.applied).toBe(false);

    expect(lines.join("\n")).toContain("Config missing:");
  });

  it("applies config set through typed deps and writes an audit entry", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-config-set-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    const { runtime, lines } = createConchTestRuntime();
    const runConfigSet = vi.fn(async () => {});

    const result = await executeConchOperation(
      { kind: "config-set", path: "gateway.port", value: "19001" },
      runtime,
      {
        approved: true,
        deps: { runConfigSet },
        auditDetails: { rescue: true, channel: "whatsapp" },
      },
    );
    expect(result.applied).toBe(true);

    expect(runConfigSet).toHaveBeenCalledWith({
      path: "gateway.port",
      value: "19001",
      cliOptions: {},
    });
    expect(lines.join("\n")).toContain("[conch] done: config.set");
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = JSON.parse((await fs.readFile(auditPath, "utf8")).trim());
    expectAuditRecord(
      audit,
      { operation: "config.set", summary: "Set config gateway.port" },
      {
        rescue: true,
        channel: "whatsapp",
        path: "gateway.port",
      },
    );
  });

  it("applies SecretRef config set through typed deps and writes an audit entry", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-config-ref-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    const { runtime, lines } = createConchTestRuntime();
    const runConfigSet = vi.fn(async () => {});

    const result = await executeConchOperation(
      {
        kind: "config-set-ref",
        path: "gateway.auth.token",
        source: "env",
        id: "DEX_GATEWAY_TOKEN",
      },
      runtime,
      {
        approved: true,
        deps: { runConfigSet },
        auditDetails: { rescue: true, channel: "whatsapp" },
      },
    );
    expect(result.applied).toBe(true);

    expect(runConfigSet).toHaveBeenCalledWith({
      path: "gateway.auth.token",
      cliOptions: {
        refProvider: "default",
        refSource: "env",
        refId: "DEX_GATEWAY_TOKEN",
      },
    });
    expect(lines.join("\n")).toContain("[conch] done: config.setRef");
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = JSON.parse((await fs.readFile(auditPath, "utf8")).trim());
    expectAuditRecord(
      audit,
      {
        operation: "config.setRef",
        summary: "Set config gateway.auth.token SecretRef",
      },
      {
        rescue: true,
        channel: "whatsapp",
        path: "gateway.auth.token",
        source: "env",
        provider: "default",
      },
    );
  });

  it("runs plugin list and search as read-only operations", async () => {
    const { runtime, lines } = createConchTestRuntime();
    const runPluginsList = vi.fn(async (pluginRuntime: RuntimeEnv) => {
      pluginRuntime.log("plugin rows");
    });
    const runPluginsSearch = vi.fn(async (query: string, pluginRuntime: RuntimeEnv) => {
      pluginRuntime.log(`search rows: ${query}`);
    });

    const listResult = await executeConchOperation({ kind: "plugin-list" }, runtime, {
      deps: { runPluginsList, runPluginsSearch },
    });
    expect(listResult.applied).toBe(false);
    const searchResult = await executeConchOperation(
      { kind: "plugin-search", query: "calendar" },
      runtime,
      {
        deps: { runPluginsList, runPluginsSearch },
      },
    );
    expect(searchResult.applied).toBe(false);

    expect(runPluginsList).toHaveBeenCalledWith(runtime);
    expect(runPluginsSearch).toHaveBeenCalledWith("calendar", runtime);
    expect(lines.join("\n")).toContain("plugin rows");
    expect(lines.join("\n")).toContain("search rows: calendar");
    expect(lines.join("\n")).toContain("[conch] done: plugins.search");
  });

  it("installs plugins only after approval and audits the write", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-plugin-install-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    const { runtime, lines } = createConchTestRuntime();
    const runPluginInstall = vi.fn(async (spec: string, pluginRuntime: RuntimeEnv) => {
      pluginRuntime.log(`installed ${spec}`);
    });

    const plan = await executeConchOperation(
      { kind: "plugin-install", spec: "clawhub:openclaw-demo" },
      runtime,
      { deps: { runPluginInstall } },
    );
    expectRecordFields(plan as unknown as Record<string, unknown>, {
      applied: false,
      message: "Plan: install plugin clawhub:openclaw-demo. Say yes to apply.",
    });
    expect(runPluginInstall).not.toHaveBeenCalled();

    const result = await executeConchOperation(
      { kind: "plugin-install", spec: "clawhub:openclaw-demo" },
      runtime,
      {
        approved: true,
        deps: { runPluginInstall },
        auditDetails: { rescue: true },
      },
    );
    expect(result.applied).toBe(true);

    const installCall = requireFirstMockCall(runPluginInstall, "runPluginInstall");
    expect(installCall[0]).toBe("clawhub:openclaw-demo");
    expectRuntimeArg(installCall[1]);
    expect(lines.join("\n")).toContain("[conch] done: plugin.install");
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = JSON.parse((await fs.readFile(auditPath, "utf8")).trim());
    expectAuditRecord(
      audit,
      {
        operation: "plugin.install",
        summary: "Installed plugin clawhub:openclaw-demo",
      },
      { rescue: true, spec: "clawhub:openclaw-demo" },
    );
  });

  it("uninstalls plugins only after approval and audits the write", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-plugin-uninstall-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    const { runtime, lines } = createConchTestRuntime();
    const runPluginUninstall = vi.fn(async (pluginId: string, pluginRuntime: RuntimeEnv) => {
      pluginRuntime.log(`uninstalled ${pluginId}`);
    });

    const plan = await executeConchOperation(
      { kind: "plugin-uninstall", pluginId: "openclaw-demo" },
      runtime,
      { deps: { runPluginUninstall } },
    );
    expectRecordFields(plan as unknown as Record<string, unknown>, {
      applied: false,
      message: "Plan: uninstall plugin openclaw-demo. Say yes to apply.",
    });
    expect(runPluginUninstall).not.toHaveBeenCalled();

    const result = await executeConchOperation(
      { kind: "plugin-uninstall", pluginId: "openclaw-demo" },
      runtime,
      {
        approved: true,
        deps: { runPluginUninstall },
        auditDetails: { rescue: true },
      },
    );
    expect(result.applied).toBe(true);

    const uninstallCall = requireFirstMockCall(runPluginUninstall, "runPluginUninstall");
    expect(uninstallCall[0]).toBe("openclaw-demo");
    expectRuntimeArg(uninstallCall[1]);
    expect(lines.join("\n")).toContain("[conch] done: plugin.uninstall");
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = JSON.parse((await fs.readFile(auditPath, "utf8")).trim());
    expectAuditRecord(
      audit,
      {
        operation: "plugin.uninstall",
        summary: "Uninstalled plugin openclaw-demo",
      },
      { rescue: true, pluginId: "openclaw-demo" },
    );
  });

  it("runs setup bootstrap only after approval and audits it", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-setup-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const { runtime, lines } = createConchTestRuntime();

    const plan = await executeConchOperation(
      { kind: "setup", workspace: "/tmp/work" },
      runtime,
    );
    expectRecordFields(plan as unknown as Record<string, unknown>, {
      applied: false,
    });
    expect(lines.join("\n")).toContain("Model choice: openai/gpt-5.5 (OPENAI_API_KEY).");

    const result = await executeConchOperation(
      { kind: "setup", workspace: "/tmp/work" },
      runtime,
      {
        approved: true,
        auditDetails: { rescue: true },
      },
    );
    expect(result.applied).toBe(true);

    expect(lines.join("\n")).toContain("[conch] done: conch.setup");
    const config = requireRecord(mockConfig.currentConfig(), "current config");
    const agents = requireRecord(config.agents, "agents config");
    expectRecordFields(requireRecord(agents.defaults, "agent defaults"), {
      workspace: "/tmp/work",
      model: { primary: "openai/gpt-5.5" },
    });
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = JSON.parse((await fs.readFile(auditPath, "utf8")).trim());
    expectAuditRecord(
      audit,
      {
        operation: "conch.setup",
        summary: "Bootstrapped setup with openai/gpt-5.5",
      },
      {
        rescue: true,
        workspace: "/tmp/work",
        model: "openai/gpt-5.5",
        modelSource: "OPENAI_API_KEY",
      },
    );
  });

  it("runs doctor repairs only after approval and audits them", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conch-doctor-fix-"));
    vi.stubEnv("DEX_STATE_DIR", tempDir);
    const { runtime, lines } = createConchTestRuntime();
    const runDoctor = vi.fn(async () => {});

    const plan = await executeConchOperation({ kind: "doctor-fix" }, runtime, {
      deps: { runDoctor },
    });
    expectRecordFields(plan as unknown as Record<string, unknown>, {
      applied: false,
      message: "Plan: run doctor repairs. Say yes to apply.",
    });
    expect(runDoctor).not.toHaveBeenCalled();

    const result = await executeConchOperation({ kind: "doctor-fix" }, runtime, {
      approved: true,
      deps: { runDoctor },
      auditDetails: { rescue: true },
    });
    expect(result.applied).toBe(true);

    expect(runDoctor).toHaveBeenCalledWith(runtime, {
      nonInteractive: true,
      repair: true,
      yes: true,
    });
    expect(lines.join("\n")).toContain("[conch] done: doctor.fix");
    const auditPath = path.join(tempDir, "audit", "conch.jsonl");
    const audit = parseLastJsonLine(await fs.readFile(auditPath, "utf8"));
    expectAuditRecord(
      audit,
      { operation: "doctor.fix", summary: "Ran doctor repairs" },
      { rescue: true },
    );
  });

  it("returns from the agent TUI back to Conch", async () => {
    const { runtime, lines } = createConchTestRuntime();
    const runTui = vi.fn(async () => ({
      exitReason: "return-to-conch" as const,
      conchMessage: "restart gateway",
    }));

    const result = await executeConchOperation(
      { kind: "open-tui", agentId: "work" },
      runtime,
      {
        deps: { runTui },
      },
    );

    expect(runTui).toHaveBeenCalledWith({
      local: true,
      session: "agent:work:main",
      deliver: false,
      historyLimit: 200,
    });
    expectRecordFields(result as unknown as Record<string, unknown>, {
      applied: false,
      nextInput: "restart gateway",
    });
    expect(lines.join("\n")).toContain(
      "[conch] returned from agent with request: restart gateway",
    );
  });
});
