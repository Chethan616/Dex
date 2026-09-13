process.env.DEX_VITEST_IMPORT_DURATIONS = "1";
process.env.DEX_VITEST_PRINT_IMPORT_BREAKDOWN = "1";

await import("./test-projects.mjs");
