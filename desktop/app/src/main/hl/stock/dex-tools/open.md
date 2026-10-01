# Showing a file — `dex-open`

When you made or found a file the user will want to see — a report, a PDF,
a spreadsheet, an image, a 3D model — open it for them instead of printing
its path:

```bash
dex-open "C:/Users/me/Downloads/report.docx"
dex-open ./outputs/$DEX_SESSION_ID/chart.png --background
```

It opens as a **document tab** in this task's workspace, next to the chat and
the web tabs, drawn properly: PDF and Word pages, a sheet grid for .xlsx/.csv,
Markdown, code, images, video, .glb/.gltf models. `--background` adds the tab
without switching the user to it.

The tab **reloads by itself** when the file changes, so open it once, then
keep editing it — the user watches it update.

Still record the files you produce with `dex-state file` (they appear under
Outputs); `dex-open` is for putting one in front of the user.
