/**
 * Nothing secret leaves this PC through the phone bridge.
 *
 * Tool arguments and results are mirrored to Firestore so the phone can show
 * them — and a shell command, an .env file the agent read, or an HTTP header
 * can carry a live credential. Everything bound for Firebase goes through
 * here first: known token formats are masked, and so is the value of any
 * key/field whose name says it's a secret.
 */

const MASK = '••••••';

/** Recognisable credential formats, masked wherever they appear. */
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, // Anthropic / OpenAI
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\bya29\.[0-9A-Za-z_-]{20,}/g, // Google OAuth access tokens
  /\b1\/\/0[0-9A-Za-z_-]{20,}/g, // Google refresh tokens
  /\bGOCSPX-[0-9A-Za-z_-]{10,}/g, // Google client secrets
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, // Authorization values
];

/** `password=…`, `"apiKey": "…"`, `TOKEN: …`, `--token …` — keep the name, mask the value. */
const NAMED_SECRET =
  /((?:"|')?(?:[A-Za-z0-9_.-]*?)(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth(?:orization)?|cookie|session[_-]?id)(?:"|')?\s*(?:[:=]|\s--?)\s*)("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s,;"'}\]]{4,})/gi;

export function redactSecrets(text: string | undefined | null): string | undefined {
  if (text == null) return undefined;
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, MASK);
  out = out.replace(NAMED_SECRET, (_m, name: string, value: string) => {
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
    return `${name}${quote}${MASK}${quote}`;
  });
  return out;
}
