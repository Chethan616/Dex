const FILLER_WORDS = /\b(please|kindly|can you|could you|would you|for me|thank(?:s| you)|hey|hi|dex|quickly|just|go ahead and|i want (?:you )?to|i need(?: you)? to)\b/gi;

const APP_ALIASES: Record<string, string> = {
  "word":      "winword",
  "excel":     "excel",
  "notepad++": "notepad++",
  "chrome":    "chrome",
  "edge":      "msedge",
  "firefox":   "firefox",
  "explorer":  "explorer",
  "task manager": "taskmgr",
  "control panel": "control",
  "paint":     "mspaint",
  "calculator":"calc",
  "terminal":  "wt",
  "vs code":   "code",
  "vscode":    "code",
};

const NUMBER_WORDS: Record<string, string> = {
  "zero":"0","one":"1","two":"2","three":"3","four":"4",
  "five":"5","six":"6","seven":"7","eight":"8","nine":"9","ten":"10",
  "twenty":"20","thirty":"30","forty":"40","fifty":"50",
  "sixty":"60","seventy":"70","eighty":"80","ninety":"90","hundred":"100",
};

function escapeRegex(str: string): string {
  return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function normalizeIntent(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/[,?!]/g, " ");                     // strip conversational punctuation
  s = s.replace(/\.(?=\s|$)/g, " ");                 // strip trailing period only
  s = s.replace(FILLER_WORDS, " ");                 // strip filler
  s = s.replace(/\s+/g, " ").trim();                // collapse whitespace
  for (const [alias, canonical] of Object.entries(APP_ALIASES)) {
    const esc = escapeRegex(alias);
    s = s.replace(new RegExp(`(?:^|(?<=\\s))${esc}(?:$|(?=\\s))`, "gi"), canonical);
  }
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    s = s.replace(new RegExp(`\\b${word}\\b`, "gi"), digit);
  }
  s = s.replace(/\bpercent\b/gi, "%");
  s = s.replace(/['']/g, "'").replace(/[""]/g, '"'); // normalize quotes
  s = s.replace(/\s+%/g, "%");                       // collapse spaces before %
  return s.trim().replace(/\s+/g, " ");
}
