# Preview Workspace Design

## Goal

Upgrade the `nanobot-channel-webui` preview workspace so that each supported document type uses the strongest practical open-source frontend-only implementation available under current constraints:

- PDF -> `pdfjs-dist`
- Excel -> `Univer Sheets`
- Word -> `docx-preview`
- PPT -> keep current implementation unchanged for now

The result should improve fidelity, consistency of failure handling, and maintainability without introducing a server-side document service.

## Scope

In scope:

- Refactor the preview workspace routing so each media type has its own focused previewer module.
- Replace the current ad hoc PDF integration with a proper `pdfjs-dist` package integration.
- Replace the current Excel HTML snapshot preview with a dedicated spreadsheet workspace based on Univer.
- Keep Word preview on `docx-preview`, but move it behind the same previewer boundary and remove CDN-global coupling where practical.
- Keep current PPT behavior unchanged.

Out of scope:

- Replacing PPT preview
- Building editing or annotation features
- Introducing a backend conversion service

## Current Problems

The current preview workspace lives almost entirely in `frontend/src/detail-preview-pane.tsx` and mixes:

- mime routing
- script loading
- third-party runtime bootstrapping
- per-file preview rendering
- error handling
- panel shell rendering

That structure makes it hard to improve one format without risking the others.

Specific quality issues:

- PDF renders every page eagerly and does not use package-based worker integration.
- Excel is rendered through `SheetJS.utils.sheet_to_html`, which is data-oriented, not a true spreadsheet workspace.
- Word relies on global script loading instead of a local package-first integration flow.

## Architecture

Split the current preview logic into two layers:

1. `detail-preview-pane.tsx`
   - keeps the panel shell, title, close/download actions, and high-level media routing

2. `preview-workspace/*`
   - one router plus one previewer per file family
   - each previewer owns its third-party integration, loading state, cleanup, and error surface

Planned structure:

- `frontend/src/preview-workspace/media-types.ts`
- `frontend/src/preview-workspace/media-router.tsx`
- `frontend/src/preview-workspace/pdf-previewer.tsx`
- `frontend/src/preview-workspace/sheet-previewer.tsx`
- `frontend/src/preview-workspace/docx-previewer.tsx`
- `frontend/src/preview-workspace/text-previewer.tsx`
- `frontend/src/preview-workspace/ppt-previewer.tsx`

## Type Decisions

### PDF

Use `pdfjs-dist` directly from npm, with:

- explicit worker configuration
- package-local rendering
- per-page rendering component
- cleanup of the loading task and document when the preview closes

The first iteration will focus on correctness and package integration. It does not need to ship full search/navigation UI yet, but it must stop depending on CDN globals and must be structured so lazy rendering can be added safely.

### Excel

Use `Univer Sheets` as the embedded spreadsheet workspace.

Why:

- It is browser-embeddable.
- It is open source.
- It provides a true spreadsheet surface instead of flattened HTML.
- It supports XLSX import/export in its documented capability set.

This will be treated as the strongest frontend-only open-source option for spreadsheet preview in this plugin.

### Word

Keep `docx-preview` for now.

Why:

- It remains the most practical frontend-only open-source `.docx` preview path for this plugin shape.
- It fits a side-panel preview better than a larger office framework migration at this stage.

The main improvement is not changing the library, but isolating it behind a focused previewer and removing the current all-in-one-pane coupling.

## UX Behavior

The preview panel continues to behave the same from the user’s perspective:

- click file card -> open right-side preview workspace
- click download -> direct file download
- unsupported file -> clear fallback message

Expected visible differences:

- PDF feels more robust and package-backed
- Excel opens inside a spreadsheet-like workspace instead of an HTML dump
- preview failures are more consistent across file types

## Testing Strategy

Frontend tests should cover:

- media type routing
- preview fallback behavior
- file-card interaction behavior already present in the assistant-ui file component

Build verification must include:

- frontend tests
- frontend build
- plugin publish pipeline

## Recommendation

Proceed with the refactor now, with this order:

1. Extract preview workspace modules and router
2. Replace PDF implementation
3. Replace Excel implementation with Univer
4. Move Word preview behind the new module boundary
5. Re-run plugin publish flow
