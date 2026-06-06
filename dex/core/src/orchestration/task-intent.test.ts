import { describe, expect, it } from "vitest";
import { parseTaskIntent } from "./task-intent.js";

describe("parseTaskIntent.kind", () => {
  it.each([
    ["click the Export button", "click"],
    ["type 'hello world' into the address bar", "type"],
    ["open https://example.com", "navigate"],
    ["go to figma.com and load the design", "navigate"],
    ["scrape the table from the page", "extract"],
    ["draft an email to my professor", "compose"],
    ["I want it to be funnier", "compound"],
  ] as const)('"%s" → %s', (text, expected) => {
    expect(parseTaskIntent(text).kind).toBe(expected);
  });
});

describe("parseTaskIntent.hints", () => {
  it("surfaces URLs verbatim", () => {
    const intent = parseTaskIntent("take typing test at https://livechat.com/typing");
    expect(intent.hints).toContain("https://livechat.com/typing");
  });

  it("surfaces .exe names verbatim", () => {
    const intent = parseTaskIntent("kill chrome.exe and restart explorer.exe");
    expect(intent.hints).toEqual(expect.arrayContaining(["chrome.exe", "explorer.exe"]));
  });

  it("maps common app keywords to canonical .exe", () => {
    expect(parseTaskIntent("open notepad and write hello").hints).toContain("notepad.exe");
    expect(parseTaskIntent("type a column into Excel").hints).toContain("excel.exe");
    expect(parseTaskIntent("compute 12 x 9 in Calculator").hints).toContain("calc.exe");
  });

  it("maps WhatsApp -> whatsapp.exe (the desktop app)", () => {
    const intent = parseTaskIntent("open WhatsApp and send myself a test message");
    expect(intent.hints).toContain("whatsapp.exe");
  });

  it("maps web-shaped intent to the browser keyword", () => {
    const intent = parseTaskIntent("scrape the form on the page");
    expect(intent.hints).toContain("browser");
  });

  it("dedupes overlapping hints", () => {
    const intent = parseTaskIntent("open the website https://example.com in a new tab");
    const counts = intent.hints.reduce<Record<string, number>>((acc, h) => {
      acc[h] = (acc[h] ?? 0) + 1;
      return acc;
    }, {});
    for (const count of Object.values(counts)) expect(count).toBe(1);
  });
});

describe("parseTaskIntent.text", () => {
  it("preserves the original text trimmed", () => {
    expect(parseTaskIntent("  open notepad  ").text).toBe("open notepad");
  });
});
