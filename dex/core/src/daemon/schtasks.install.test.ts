import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installScheduledTask, readScheduledTaskCommand } from "./schtasks.js";
import { auditGatewayServiceConfig, SERVICE_AUDIT_CODES } from "./service-audit.js";

const schtasksCalls: string[][] = [];
const schtasksResponses: { code: number; stdout: string; stderr: string }[] = [];
// Captures the XML payload at /Create /XML time before the production code's
// `finally` block deletes the temp file. Indexed by the position in
// `schtasksCalls` so individual tests can pin which create-call they assert on.
const xmlPayloadCaptures: Array<{ index: number; xml: string }> = [];

vi.mock("./schtasks-exec.js", () => ({
  execSchtasks: async (argv: string[]) => {
    const index = schtasksCalls.length;
    schtasksCalls.push(argv);
    const xmlFlagPos = argv.indexOf("/XML");
    if (xmlFlagPos !== -1) {
      const xmlPath = argv[xmlFlagPos + 1];
      if (typeof xmlPath === "string") {
        try {
          const raw = await fs.readFile(xmlPath);
          // Strip the UTF-16 LE BOM and decode for readable assertions.
          xmlPayloadCaptures.push({ index, xml: raw.slice(2).toString("utf16le") });
        } catch {
          // Mock cannot block production cleanup; tests assert via captured payloads.
        }
      }
    }
    return schtasksResponses.shift() ?? { code: 0, stdout: "", stderr: "" };
  },
}));

beforeEach(() => {
  schtasksCalls.length = 0;
  schtasksResponses.length = 0;
  xmlPayloadCaptures.length = 0;
});

describe("installScheduledTask", () => {
  const okSchtasksResponse = { code: 0, stdout: "", stderr: "" };
  const accessDeniedResponse = { code: 1, stdout: "", stderr: "ERROR: Access is denied." };
  const missingTaskResponse = {
    code: 1,
    stdout: "",
    stderr: "ERROR: The system cannot find the file specified.",
  };

  async function withUserProfileDir(
    run: (tmpDir: string, env: Record<string, string>) => Promise<void>,
  ) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-schtasks-install-"));
    const env = {
      USERPROFILE: tmpDir,
      DEX_PROFILE: "default",
    };
    try {
      await run(tmpDir, env);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  function installDefaultGatewayTask(env: Record<string, string>) {
    return installScheduledTask({
      env,
      stdout: new PassThrough(),
      programArguments: ["node", "gateway.js"],
      environment: {},
    });
  }

  // installScheduledTask probes for a pre-rename "OpenClaw Gateway" task
  // (removing it when present) before touching the Dex-named task, so call
  // [1] is always the legacy-cleanup query.
  function expectInitialTaskQueries(): void {
    expect(schtasksCalls[0]).toEqual(["/Query"]);
    expect(schtasksCalls[1]).toEqual(["/Query", "/TN", "OpenClaw Gateway"]);
    expect(schtasksCalls[2]).toEqual(["/Query", "/TN", "Dex Gateway"]);
  }

  function expectTaskRunCall(index: number): void {
    expect(schtasksCalls[index]).toEqual(["/Run", "/TN", "Dex Gateway"]);
  }

  it("writes quoted set assignments and escapes metacharacters", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      // availability ok, legacy probe missing; defaults (ok) cover the rest.
      schtasksResponses.push(okSchtasksResponse, missingTaskResponse);
      const { scriptPath } = await installScheduledTask({
        env,
        stdout: new PassThrough(),
        programArguments: [
          "node",
          "gateway.js",
          "--display-name",
          "safe&whoami",
          "--percent",
          "%TEMP%",
          "--bang",
          "!token!",
        ],
        workingDirectory: "C:\\temp\\poc&calc",
        environment: {
          OC_INJECT: "safe & whoami | calc",
          OC_CARET: "a^b",
          OC_PERCENT: "%TEMP%",
          OC_BANG: "!token!",
          OC_QUOTE: 'he said "hi"',
          OC_EMPTY: "",
        },
      });

      const script = await fs.readFile(scriptPath, "utf8");
      expect(script).toContain('cd /d "C:\\temp\\poc&calc"');
      expect(script).toContain(
        'node gateway.js --display-name "safe&whoami" --percent "%%TEMP%%" --bang "^!token^!"',
      );
      expect(script).toContain('set "OC_INJECT=safe & whoami | calc"');
      expect(script).toContain('set "OC_CARET=a^^b"');
      expect(script).toContain('set "OC_PERCENT=%%TEMP%%"');
      expect(script).toContain('set "OC_BANG=^!token^!"');
      expect(script).toContain('set "OC_QUOTE=he said ^"hi^""');
      expect(script).not.toContain('set "OC_EMPTY=');
      expect(script).not.toContain("set OC_INJECT=");

      const parsed = await readScheduledTaskCommand(env);
      expect(parsed).toStrictEqual({
        programArguments: [
          "node",
          "gateway.js",
          "--display-name",
          "safe&whoami",
          "--percent",
          "%TEMP%",
          "--bang",
          "!token!",
        ],
        workingDirectory: "C:\\temp\\poc&calc",
        environment: {
          OC_INJECT: "safe & whoami | calc",
          OC_CARET: "a^b",
          OC_PERCENT: "%TEMP%",
          OC_BANG: "!token!",
          OC_QUOTE: 'he said "hi"',
        },
        environmentValueSources: {
          OC_INJECT: "inline",
          OC_CARET: "inline",
          OC_PERCENT: "inline",
          OC_BANG: "inline",
          OC_QUOTE: "inline",
        },
        sourcePath: scriptPath,
      });

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Change");
      // Battery-flag XML re-apply runs between /Change and /Run on upgrades.
      expect(schtasksCalls[4]?.slice(0, 5)).toEqual([
        "/Create",
        "/F",
        "/TN",
        "Dex Gateway",
        "/XML",
      ]);
      expectTaskRunCall(5);
    });
  });

  it("rejects line breaks in command arguments, env vars, and descriptions", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      await expect(
        installScheduledTask({
          env,
          stdout: new PassThrough(),
          programArguments: ["node", "gateway.js", "bad\narg"],
          environment: {},
        }),
      ).rejects.toThrow(/Command argument cannot contain CR or LF/);

      await expect(
        installScheduledTask({
          env,
          stdout: new PassThrough(),
          programArguments: ["node", "gateway.js"],
          environment: { BAD: "line1\r\nline2" },
        }),
      ).rejects.toThrow(/Environment variable value cannot contain CR or LF/);

      await expect(
        installScheduledTask({
          env,
          stdout: new PassThrough(),
          description: "bad\ndescription",
          programArguments: ["node", "gateway.js"],
          environment: {},
        }),
      ).rejects.toThrow(/Task description cannot contain CR or LF/);
    });
  });

  it("uses /Create when the task does not exist yet", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(okSchtasksResponse, missingTaskResponse, missingTaskResponse);

      await installDefaultGatewayTask(env);

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Create");
      expectTaskRunCall(4);
    });
  });

  it("creates hidden launcher Windows tasks when requested", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(okSchtasksResponse, missingTaskResponse, missingTaskResponse);

      const { scriptPath } = await installDefaultGatewayTask({
        ...env,
        USERDOMAIN: "WORKSTATION",
        USERNAME: "alice",
        DEX_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
      });
      const launcherPath = scriptPath.replace(/\.cmd$/i, ".vbs");
      const launcher = await fs.readFile(launcherPath, "utf8");

      expectInitialTaskQueries();
      // `/Create /XML` argv shape: ["/Create", "/F", "/TN", "<name>", "/XML", "<path>", "/RU", "<user>", "/NP"].
      // The XML payload is what carries the SC, RL, TR, and battery settings now.
      expect(schtasksCalls[3]?.slice(0, 5)).toEqual([
        "/Create",
        "/F",
        "/TN",
        "Dex Gateway",
        "/XML",
      ]);
      expect(schtasksCalls[3]?.slice(6)).toEqual(["/RU", "WORKSTATION\\alice", "/NP"]);
      expect(launcher).toContain("WScript.Shell");
      expect(launcher).toContain(scriptPath);
      expect(launcher).toContain(`Run """${scriptPath}""", 0, False`);
      expectTaskRunCall(4);
    });
  });

  it("creates the Scheduled Task via XML with battery start/continue enabled (#59299)", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(okSchtasksResponse, missingTaskResponse, missingTaskResponse);

      await installDefaultGatewayTask({
        ...env,
        USERDOMAIN: "WORKSTATION",
        USERNAME: "alice",
      });

      // `/Create` must use `/XML <path>` so battery flags can be set; the
      // CLI flag form (`/SC ONLOGON /RL LIMITED /TR ...`) cannot express
      // `DisallowStartIfOnBatteries`/`StopIfGoingOnBatteries`.
      const createCall = schtasksCalls[3];
      expect(createCall?.[0]).toBe("/Create");
      expect(createCall).toContain("/XML");

      const captured = xmlPayloadCaptures.find((entry) => entry.index === 3);
      expect(captured).toBeDefined();
      const xml = captured?.xml ?? "";
      expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
      expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
      // Preserve the prior CLI semantics: ONLOGON trigger, LeastPrivilege, exec action.
      expect(xml).toContain("<LogonTrigger>");
      expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
      expect(xml).toContain("<UserId>WORKSTATION\\alice</UserId>");
      expect(xml).toContain("<Exec>");
    });
  });

  it("omits /RU for workgroup accounts so schtasks can use the current local user", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(okSchtasksResponse, missingTaskResponse, missingTaskResponse);

      await installDefaultGatewayTask({
        ...env,
        USERDOMAIN: "WORKGROUP",
        USERNAME: "alice",
      });

      expectInitialTaskQueries();
      const createCall = schtasksCalls[3];
      expect(createCall?.slice(0, 5)).toEqual(["/Create", "/F", "/TN", "Dex Gateway", "/XML"]);
      expect(createCall).not.toContain("/RU");
      const captured = xmlPayloadCaptures.find((entry) => entry.index === 3);
      expect(captured?.xml).toContain("<UserId>alice</UserId>");
      expect(captured?.xml).not.toContain("<GroupId>S-1-5-32-545</GroupId>");
      expectTaskRunCall(4);
    });
  });

  it("re-applies the XML on /Change so upgraded tasks adopt battery flags (#59299)", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      // /Query yes, legacy probe missing, /Query /TN yes, /Change ok,
      // /Create /XML ok (upgrade), /Run ok.
      schtasksResponses.push(
        okSchtasksResponse,
        missingTaskResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        okSchtasksResponse,
      );

      await installDefaultGatewayTask(env);

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Change");
      expect(schtasksCalls[4]?.slice(0, 5)).toEqual([
        "/Create",
        "/F",
        "/TN",
        "Dex Gateway",
        "/XML",
      ]);
      const upgradeCapture = xmlPayloadCaptures.find((entry) => entry.index === 4);
      expect(upgradeCapture).toBeDefined();
      const upgradeXml = upgradeCapture?.xml ?? "";
      expect(upgradeXml).toContain(
        "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
      );
      expect(upgradeXml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
      expectTaskRunCall(5);
    });
  });

  it("updates existing tasks to use the hidden launcher when requested", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      // /Query, legacy probe missing, /Query /TN, /Change (TR-only),
      // /Create /XML (upgrade re-apply), /Run.
      schtasksResponses.push(
        okSchtasksResponse,
        missingTaskResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        okSchtasksResponse,
      );

      const { scriptPath } = await installDefaultGatewayTask({
        ...env,
        USERDOMAIN: "WORKSTATION",
        USERNAME: "alice",
        DEX_WINDOWS_TASK_HIDDEN_LAUNCHER: "true",
      });
      const launcherPath = scriptPath.replace(/\.cmd$/i, ".vbs");

      expectInitialTaskQueries();
      expect(schtasksCalls[3]).toEqual([
        "/Change",
        "/TN",
        "Dex Gateway",
        "/TR",
        expect.stringContaining("gateway.vbs"),
      ]);
      expect(schtasksCalls[3]?.[4]).toContain(launcherPath);
      // Upgrade XML re-apply runs after /Change so older tasks pick up battery flags.
      expect(schtasksCalls[4]?.slice(0, 5)).toEqual([
        "/Create",
        "/F",
        "/TN",
        "Dex Gateway",
        "/XML",
      ]);
      expectTaskRunCall(5);
    });
  });

  it("falls back to /Create when /Change fails on an existing task", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(
        okSchtasksResponse,
        missingTaskResponse,
        okSchtasksResponse,
        accessDeniedResponse,
      );

      await installDefaultGatewayTask(env);

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Change");
      expect(schtasksCalls[4]?.[0]).toBe("/Create");
      expectTaskRunCall(5);
    });
  });

  it("throws when /Run fails after updating an existing task", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      // /Query, legacy probe missing, /Query /TN, /Change, /Create XML
      // upgrade re-apply, /Run (fails).
      schtasksResponses.push(
        okSchtasksResponse,
        missingTaskResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        okSchtasksResponse,
        accessDeniedResponse,
      );

      await expect(installDefaultGatewayTask(env)).rejects.toThrow(
        "schtasks run failed: ERROR: Access is denied.",
      );

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Change");
      expect(schtasksCalls[4]?.[0]).toBe("/Create");
      expectTaskRunCall(5);
    });
  });

  it("throws when /Run fails after creating a new task", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      schtasksResponses.push(
        okSchtasksResponse,
        missingTaskResponse,
        missingTaskResponse,
        okSchtasksResponse,
        accessDeniedResponse,
      );

      await expect(installDefaultGatewayTask(env)).rejects.toThrow(
        "schtasks run failed: ERROR: Access is denied.",
      );

      expectInitialTaskQueries();
      expect(schtasksCalls[3]?.[0]).toBe("/Create");
      expectTaskRunCall(4);
    });
  });

  it("does not persist a frozen PATH snapshot into the generated task script", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      const { scriptPath } = await installScheduledTask({
        env,
        stdout: new PassThrough(),
        programArguments: ["node", "gateway.js"],
        environment: {
          PATH: "C:\\Windows\\System32;C:\\Program Files\\Docker\\Docker\\resources\\bin",
          DEX_GATEWAY_PORT: "18789",
        },
      });

      const script = await fs.readFile(scriptPath, "utf8");
      expect(script).not.toContain('set "PATH=');
      expect(script).toContain('set "DEX_GATEWAY_PORT=18789"');
    });
  });

  it("exposes Windows task script env values as inline for managed-env drift audit", async () => {
    await withUserProfileDir(async (_tmpDir, env) => {
      const { scriptPath } = await installScheduledTask({
        env,
        stdout: new PassThrough(),
        programArguments: ["node", "gateway.js"],
        environment: {
          DEX_SERVICE_MANAGED_ENV_KEYS: "TAVILY_API_KEY",
          TAVILY_API_KEY: "old-inline-value",
        },
      });

      const command = await readScheduledTaskCommand(env);
      expect(command).toStrictEqual({
        programArguments: ["node", "gateway.js"],
        environment: {
          DEX_SERVICE_MANAGED_ENV_KEYS: "TAVILY_API_KEY",
          TAVILY_API_KEY: "old-inline-value",
        },
        environmentValueSources: {
          DEX_SERVICE_MANAGED_ENV_KEYS: "inline",
          TAVILY_API_KEY: "inline",
        },
        sourcePath: scriptPath,
      });

      const audit = await auditGatewayServiceConfig({
        env,
        platform: "win32",
        command,
        expectedManagedServiceEnvKeys: ["TAVILY_API_KEY"],
      });
      expect(
        audit.issues.some((issue) => issue.code === SERVICE_AUDIT_CODES.gatewayManagedEnvEmbedded),
      ).toBe(true);
    });
  });
});
