import { configureAcpErrorRedactor } from "@dexagent/acp-core";
import { redactSensitiveText } from "../../logging/redact.js";

configureAcpErrorRedactor(redactSensitiveText);

export * from "@dexagent/acp-core/runtime/errors";
