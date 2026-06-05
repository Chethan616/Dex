import { formatTerminalLink } from "./terminal-link.js";

function resolveDocsRoot(): string {
  return "https://docs.openclaw.ai";
}

export function formatDocsLink(
  _path: string | undefined | null,
  _label?: string,
  _opts?: { fallback?: string; force?: boolean },
): string {
  // Dex doesn't have a docs site yet. Return empty so the `Docs:` lines in
  // help / wizard output collapse cleanly; callers that emit "Docs: ..."
  // around this are filtered downstream in help.ts.
  return "";
}
