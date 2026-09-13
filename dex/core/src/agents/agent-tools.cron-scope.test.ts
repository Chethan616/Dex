import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";

const mocks = vi.hoisted(() => {
  const stubTool = (name: string) =>
    ({
      name,
      label: name,
      displaySummary: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    }) satisfies AnyAgentTool;

  return {
    createDexToolsOptions: vi.fn(),
    stubTool,
  };
});

vi.mock("./openclaw-tools.js", () => ({
  createOpenClawTools: (options: unknown) => {
    mocks.createDexToolsOptions(options);
    return [mocks.stubTool("cron")];
  },
}));

import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createDexCodingTools } from "./agent-tools.js";

function firstDexToolsOptions(): { cronSelfRemoveOnlyJobId?: string } | undefined {
  return mocks.createDexToolsOptions.mock.calls[0]?.[0] as
    | { cronSelfRemoveOnlyJobId?: string }
    | undefined;
}

describe("createDexCodingTools cron scope", () => {
  beforeEach(() => {
    mocks.createDexToolsOptions.mockClear();
  });

  it("scopes cron-triggered jobs to self-removal", () => {
    const tools = createDexCodingTools({
      trigger: "cron",
      jobId: "job-current",
    });

    expect(tools.map((tool) => tool.name)).toContain("cron");
    expect(firstDexToolsOptions()?.cronSelfRemoveOnlyJobId).toBe("job-current");
  });

  it("does not scope non-cron sessions", () => {
    createDexCodingTools({
      trigger: "user",
      jobId: "job-current",
    });

    expect(firstDexToolsOptions()?.cronSelfRemoveOnlyJobId).toBeUndefined();
  });
});
