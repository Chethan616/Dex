import { describe, expect, it } from "vitest";
import { DexSchema } from "./zod-schema.js";

describe("DexSchema logging levels", () => {
  it("accepts valid logging level values for level and consoleLevel", () => {
    const result = DexSchema.safeParse({
      logging: {
        level: "debug",
        consoleLevel: "warn",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid logging level values", () => {
    const invalidLevel = DexSchema.safeParse({
      logging: {
        level: "loud",
      },
    });
    const invalidConsoleLevel = DexSchema.safeParse({
      logging: {
        consoleLevel: "verbose",
      },
    });

    expect(invalidLevel.success).toBe(false);
    if (!invalidLevel.success) {
      expect(
        invalidLevel.error.issues.some((issue) => issue.path.join(".") === "logging.level"),
      ).toBe(true);
    }
    expect(invalidConsoleLevel.success).toBe(false);
    if (!invalidConsoleLevel.success) {
      expect(
        invalidConsoleLevel.error.issues.some(
          (issue) => issue.path.join(".") === "logging.consoleLevel",
        ),
      ).toBe(true);
    }
  });
});
