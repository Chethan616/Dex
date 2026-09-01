# Fonts

Drop the **variable** versions of these two fonts here before first run:

- `Geist-VariableFont_wght.ttf` -- https://github.com/vercel/geist-font/tree/main/packages/next/dist/fonts/geist-sans
- `GeistMono-VariableFont_wght.ttf` -- https://github.com/vercel/geist-font/tree/main/packages/next/dist/fonts/geist-mono

Both are OFL-1.1 (see `LICENSES.md`). Variable files are ~80 KB each.

Until they are present, `lib/theme/theme.dart` falls back to the system stack
(`Segoe UI`, `Roboto`, `-apple-system`). The app still runs; it just looks generic.
