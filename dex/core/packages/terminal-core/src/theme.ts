import chalk, { Chalk } from "chalk";
import { DEX_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(DEX_PALETTE.accent),
  accentBright: hex(DEX_PALETTE.accentBright),
  accentDim: hex(DEX_PALETTE.accentDim),
  info: hex(DEX_PALETTE.info),
  success: hex(DEX_PALETTE.success),
  warn: hex(DEX_PALETTE.warn),
  error: hex(DEX_PALETTE.error),
  muted: hex(DEX_PALETTE.muted),
  heading: baseChalk.bold.hex(DEX_PALETTE.accent),
  command: hex(DEX_PALETTE.accentBright),
  option: hex(DEX_PALETTE.warn),
} as const;

export const isRich = () => baseChalk.level > 0;

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
