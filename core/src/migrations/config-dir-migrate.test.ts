import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  migrateOpenClawConfigDir,
  resolveMigrationPaths,
} from "./config-dir-migrate.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dex-migrate-"));
});

afterEach(() => {
  if (tmpHome && fs.existsSync(tmpHome)) {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

function seedLegacy(home: string, files: Record<string, string>): string {
  const dir = path.join(home, ".openclaw");
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
  return dir;
}

describe("migrateOpenClawConfigDir", () => {
  it("returns no-legacy when ~/.openclaw does not exist", () => {
    const result = migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {},
    });
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("no-legacy");
    expect(fs.existsSync(path.join(tmpHome, ".dex"))).toBe(false);
  });

  it("copies a populated legacy tree into ~/.dex on first run", () => {
    seedLegacy(tmpHome, {
      "openclaw.json": '{"version": 1, "marker": "primary"}',
      "agents/default/agent/openclaw-agent.sqlite": "FAKE-SQLITE-BYTES",
      "credentials/anthropic.json": '{"key": "sk-ant-test"}',
    });
    const logs: string[] = [];
    const result = migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: (m) => logs.push(m),
    });
    expect(result.migrated).toBe(true);
    expect(result.reason).toBe("migrated");
    const newDir = path.join(tmpHome, ".dex");
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.readFileSync(path.join(newDir, "openclaw.json"), "utf8")).toBe(
      '{"version": 1, "marker": "primary"}',
    );
    expect(
      fs.readFileSync(
        path.join(newDir, "agents/default/agent/openclaw-agent.sqlite"),
        "utf8",
      ),
    ).toBe("FAKE-SQLITE-BYTES");
    expect(
      fs.readFileSync(path.join(newDir, "credentials/anthropic.json"), "utf8"),
    ).toBe('{"key": "sk-ant-test"}');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("[dex] migrated config from");
    expect(logs[0]).toContain(".openclaw");
    expect(logs[0]).toContain(".dex");
  });

  it("leaves the legacy directory in place after copying", () => {
    seedLegacy(tmpHome, { "openclaw.json": '{"v":1}' });
    migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {},
    });
    expect(fs.existsSync(path.join(tmpHome, ".openclaw", "openclaw.json"))).toBe(true);
  });

  it("writes a MOVED-TO-DEX.txt breadcrumb in the legacy dir on success", () => {
    seedLegacy(tmpHome, { "openclaw.json": '{}' });
    migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {},
    });
    const breadcrumb = path.join(tmpHome, ".openclaw", "MOVED-TO-DEX.txt");
    expect(fs.existsSync(breadcrumb)).toBe(true);
    const body = fs.readFileSync(breadcrumb, "utf8");
    expect(body).toContain("Migrated to ");
    expect(body).toContain(".dex");
    expect(body).toContain("Delete this old directory once Dex starts cleanly");
  });

  it("is idempotent: second run is a no-op when ~/.dex already exists", () => {
    seedLegacy(tmpHome, { "openclaw.json": '{"first": true}' });
    const first = migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {},
    });
    expect(first.migrated).toBe(true);

    // Mutate ~/.dex to prove the second run does NOT overwrite.
    const newConfigPath = path.join(tmpHome, ".dex", "openclaw.json");
    fs.writeFileSync(newConfigPath, '{"first": false, "second": true}', "utf8");

    const second = migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {
        throw new Error("second run should not log; idempotent path");
      },
    });
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("new-already-exists");
    expect(fs.readFileSync(newConfigPath, "utf8")).toBe(
      '{"first": false, "second": true}',
    );
  });

  it("does not migrate when ~/.dex already exists, even with rich legacy data", () => {
    seedLegacy(tmpHome, { "agents/default/state.db": "legacy" });
    fs.mkdirSync(path.join(tmpHome, ".dex"), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, ".dex", "existing.json"), "pre-existing");

    const result = migrateOpenClawConfigDir({
      paths: resolveMigrationPaths(tmpHome),
      log: () => {
        throw new Error("should not log -- ~/.dex already exists");
      },
    });
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("new-already-exists");
    // Old contents are NOT copied.
    expect(
      fs.existsSync(path.join(tmpHome, ".dex", "agents/default/state.db")),
    ).toBe(false);
    // The pre-existing canonical content stays untouched.
    expect(
      fs.readFileSync(path.join(tmpHome, ".dex", "existing.json"), "utf8"),
    ).toBe("pre-existing");
  });

  it("resolveMigrationPaths composes paths relative to the given home dir", () => {
    const paths = resolveMigrationPaths("/tmp/fake-home");
    expect(paths.oldDir).toBe(path.join("/tmp/fake-home", ".openclaw"));
    expect(paths.newDir).toBe(path.join("/tmp/fake-home", ".dex"));
  });
});
