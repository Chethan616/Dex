import type {
  DexPluginNodeInvokePolicy,
  DexPluginNodeInvokePolicyContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import { createLazyFileTransferNodeInvokePolicy } from "./lazy-node-invoke-policy.js";

function createPolicyContext(
  overrides: Partial<DexPluginNodeInvokePolicyContext> = {},
): DexPluginNodeInvokePolicyContext {
  return {
    nodeId: "node-1",
    command: "file.fetch",
    params: { path: "/tmp/a.txt" },
    config: {} as never,
    pluginConfig: {},
    node: {
      nodeId: "node-1",
      displayName: "Test Node",
      commands: ["file.fetch"],
    },
    client: null,
    invokeNode: vi.fn<DexPluginNodeInvokePolicyContext["invokeNode"]>(async () => ({
      ok: true,
      payload: { ok: true },
      payloadJSON: null,
    })),
    ...overrides,
  };
}

describe("lazy file-transfer node invoke policy", () => {
  it("exposes command metadata without loading the delegate", () => {
    const loadPolicy = vi.fn<() => Promise<DexPluginNodeInvokePolicy>>();

    const policy = createLazyFileTransferNodeInvokePolicy(loadPolicy);

    expect(policy.commands).toEqual(["file.fetch", "dir.list", "dir.fetch", "file.write"]);
    expect(loadPolicy).not.toHaveBeenCalled();
  });

  it("loads and caches the delegate on first handle", async () => {
    const invokeNode = vi.fn<DexPluginNodeInvokePolicyContext["invokeNode"]>(async () => ({
      ok: true,
      payload: { ok: true },
      payloadJSON: null,
    }));
    const delegateHandle = vi.fn<DexPluginNodeInvokePolicy["handle"]>(async (ctx) => {
      await ctx.invokeNode();
      return { ok: true, payload: { delegated: true } };
    });
    const loadPolicy = vi.fn<() => Promise<DexPluginNodeInvokePolicy>>(async () => ({
      commands: ["file.fetch"],
      handle: delegateHandle,
    }));
    const policy = createLazyFileTransferNodeInvokePolicy(loadPolicy);

    await expect(policy.handle(createPolicyContext({ invokeNode }))).resolves.toEqual({
      ok: true,
      payload: { delegated: true },
    });
    await expect(policy.handle(createPolicyContext({ invokeNode }))).resolves.toEqual({
      ok: true,
      payload: { delegated: true },
    });

    expect(loadPolicy).toHaveBeenCalledTimes(1);
    expect(delegateHandle).toHaveBeenCalledTimes(2);
    expect(invokeNode).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the delegate cannot load", async () => {
    const invokeNode = vi.fn<DexPluginNodeInvokePolicyContext["invokeNode"]>(async () => ({
      ok: true,
      payload: { ok: true },
      payloadJSON: null,
    }));
    const policy = createLazyFileTransferNodeInvokePolicy(async () => {
      throw new Error("load failed");
    });

    await expect(policy.handle(createPolicyContext({ invokeNode }))).resolves.toMatchObject({
      ok: false,
      code: "PLUGIN_POLICY_UNAVAILABLE",
      unavailable: true,
    });
    expect(invokeNode).not.toHaveBeenCalled();
  });

  it("does not rewrite delegate failures as load failures", async () => {
    const delegateError = new Error("delegate failed");
    const policy = createLazyFileTransferNodeInvokePolicy(async () => ({
      commands: ["file.fetch"],
      handle: async () => {
        throw delegateError;
      },
    }));

    await expect(policy.handle(createPolicyContext())).rejects.toBe(delegateError);
  });
});
