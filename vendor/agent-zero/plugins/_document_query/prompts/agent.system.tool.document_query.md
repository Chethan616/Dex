### document_query
read, extract, summarize, compare, OCR, or answer questions over local/remote documents, code files, and text-heavy document images/scans.

For document Q&A, document/code analysis, multi-document comparison, or OCR/text extraction from images/scans, first load the `document-query` skill with `skills_tool:load`, then call this tool using the loaded instructions.

Minimal args after loading the skill:
- `document`: one local path/URL or a list of paths/URLs
- `queries`: optional list of questions; omit it to return extracted document content

Use normal user-facing language in final answers. Keep parser/runtime details internal.
