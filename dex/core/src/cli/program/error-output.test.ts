import { describe, expect, it } from "vitest";
import { formatCliParseErrorOutput } from "./error-output.js";

describe("formatCliParseErrorOutput", () => {
  it("explains unknown commands with root help and plugin hints", () => {
    const output = formatCliParseErrorOutput("error: unknown command 'wat'\n", {
      argv: ["node", "dex", "wat"],
    });

    expect(output).toBe(
      'Dex does not know the command "wat".\nTry: dex --help\nPlugin command? dex plugins list\n',
    );
  });

  it("points unknown options at the active command help", () => {
    const output = formatCliParseErrorOutput("error: unknown option '--wat'\n", {
      argv: ["node", "dex", "channels", "status", "--wat"],
    });

    expect(output).toBe('Dex does not recognize option "--wat".\nTry: dex channels status --help\n');
  });

  it("points missing required arguments at command help", () => {
    const output = formatCliParseErrorOutput("error: missing required argument 'name'\n", {
      argv: ["node", "dex", "plugins", "install"],
    });

    expect(output).toBe('Missing required argument "name".\nTry: dex plugins install --help\n');
  });
});
