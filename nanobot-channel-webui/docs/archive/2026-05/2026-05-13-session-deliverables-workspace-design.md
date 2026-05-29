# Session Deliverables Workspace Design

## Goal

Add a conversation-scoped 「工作空间」 to `nanobot-channel-webui` without changing any `nanobot` core code.

This workspace is a plugin-only concept:

- one chat session (`chat_id`) maps to one workspace view
- the workspace contains only files that were **finally delivered to the user**
- the WebUI can open that workspace, list delivered files, and preview them with the plugin’s existing preview system

## Hard Constraints

This design must respect the following constraints:

1. Only files inside `nanobot-channel-webui` may be changed.
2. `nanobot/` core code must remain untouched.
3. Root `webui/` must remain untouched.
4. Existing preview capability in the plugin should be reused, not rebuilt.

Because of these constraints, the workspace cannot become a first-class `nanobot` session concept. It must be implemented as a plugin-layer projection over data the plugin already sees.

## Product Definition

In this plugin, 「工作空间」 means:

> The set of files that were ultimately delivered to the user inside one chat session.

It is not:

- a project directory browser
- a log of every file touched by the agent
- a record of temporary or intermediate artifacts
- a turn-by-turn task tree

## Scope

In scope:

- Add a plugin-side delivered-file index keyed by `chat_id`
- Track only final delivered attachments
- Expose a plugin API for reading the current session workspace
- Add a WebUI entry for 「查看工作空间」
- Show the session’s delivered files in a side panel
- Reuse the current preview workspace / detail preview flow

Out of scope:

- Modifying `nanobot` session persistence
- Changing `nanobot` media signing behavior
- Capturing temporary files, referenced files, or read-only files
- Building a new preview engine
- Introducing multi-level task folders inside one session

## Current Plugin Capabilities

The plugin already has useful building blocks:

- a dedicated plugin backend in `src/nanobot_channel_webui/channel.py`
- a plugin session index service in `src/nanobot_channel_webui/session_index.py`
- upload and attachment helpers in `src/nanobot_channel_webui/uploads.py`
- frontend session/message state in `frontend/src/store.ts`
- existing file preview infrastructure under `frontend/src/preview-workspace/*`
- existing file cards and detail preview behavior in the frontend

This means the feature should be built as a thin layer that connects:

1. plugin-observed delivered files
2. plugin-owned per-session indexing
3. existing frontend preview UI

## Chosen Approach

Use **plugin-layer session deliverables indexing**.

### Why this approach

Compared with a pure frontend-only derived view:

- it survives refresh and reconnect
- it supports stable per-session listing
- it does not depend on the full message history being loaded in memory

Compared with pushing the data into PocketBase session rows:

- it keeps file metadata separate from chat summary metadata
- it avoids bloating session records
- it gives cleaner room for future operations like sorting, export, or deletion

## Data Model

The workspace is keyed by `chat_id`.

Recommended shape:

```json
{
  "chat_id": "chat-123",
  "updated_at": "2026-05-13T20:00:00+08:00",
  "files": [
    {
      "id": "file_001",
      "name": "案件4资金研判分析报告.docx",
      "url": "/media/...",
      "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "size": 123456,
      "delivered_at": "2026-05-13T19:27:43+08:00",
      "source": "assistant_final"
    }
  ]
}
```

Required file fields:

- `id`
- `name`
- `url`
- `mime`
- `delivered_at`

Useful optional fields:

- `size`
- `source`
- `message_id`

## What Counts as a Workspace File

Only these should be indexed:

1. files attached to the assistant’s final delivered message for the current chat
2. files attached to plugin-generated outbound messages sent to the same chat

Do not index:

- user-uploaded files
- files merely mentioned in text
- temporary exports that were never shown to the user
- files read or written during tool execution but not finally delivered

This rule is the most important boundary in the feature.

## Backend Design

## 1. Storage

Store a plugin-owned workspace index outside `nanobot` core persistence.

Recommended location:

```text
<plugin workspace>/.nanobot_channel_webui/workspaces/<chat_id>.json
```

Why:

- stays fully inside plugin ownership
- avoids touching `nanobot` session files
- is easy to inspect and migrate

Each file is an index entry, not a copied artifact. The plugin should continue to use the existing accessible attachment URL when possible.

## 2. Write Timing

Update the workspace index only when the plugin knows a file has actually been delivered.

Primary write points:

1. when the backend emits a completed assistant message with `media`
2. when the plugin emits an outbound message with `media`

The backend should:

1. normalize the media items
2. filter out anything that is not a final delivered attachment
3. merge the entries into the `chat_id` workspace index
4. deduplicate by stable key
5. persist the JSON file atomically

## 3. Deduplication

The same file may appear multiple times across reconnects or replay.

Deduplicate by a stable compound key, preferably:

- `url + name`

If later needed, this can evolve to:

- `url + name + delivered_at`

The first version should keep the latest metadata for a duplicate entry and avoid duplicate list rows.

## 4. Read API

Add a plugin API route:

`GET /api/workspaces/{chat_id}`

Response:

- `chat_id`
- `file_count`
- `updated_at`
- `files`

Optional future route:

`DELETE /api/workspaces/{chat_id}/files/{file_id}`

This is not required in the first version.

## 5. Authorization

Reuse the plugin’s existing auth/session guard behavior.

The route should only return files visible to the current authenticated user in the same way the plugin already limits session access.

This avoids inventing a second authorization model.

## Frontend Design

## 1. Entry Point

Add a 「查看工作空间」 action in the current chat header area.

Behavior:

- hidden or disabled when the current session has no indexed files
- enabled when the session workspace has at least one file

## 2. Panel Shape

Use a right-side sheet / detail panel rather than a full page navigation.

Why:

- keeps the user inside the current thread
- matches the plugin’s existing preview-heavy interaction style
- reduces navigation overhead

## 3. File List

Each item should show:

- file icon
- file name
- file type label
- delivery time

Optional:

- size

The first version should optimize for fast scanning and preview, not dense file management.

## 4. Preview Behavior

Do not create a new preview pipeline.

Instead:

1. click a workspace file
2. open the plugin’s existing detail preview / preview workspace flow
3. reuse current per-mime previewers

This preserves consistency and keeps the feature focused on indexing and navigation.

## Frontend State

Extend plugin frontend state with a lightweight workspace cache keyed by `chat_id`.

Suggested shape:

```ts
workspaceByChat: Record<string, SessionWorkspace | undefined>
```

Where `SessionWorkspace` contains:

- `chatId`
- `updatedAt`
- `files`

Loading strategy:

- lazy-load when the user opens the workspace
- optionally prefetch for the active chat after history load

The first version should prefer lazy load to keep the default chat path light.

## UX Rules

1. Workspace belongs to the current session, not globally across all chats.
2. Workspace only reflects final delivered files.
3. Preview should feel identical whether a file is opened from the chat stream or from the workspace list.
4. Empty state should explain that no final delivered files exist yet.

## Failure Handling

### Backend

- invalid workspace JSON -> return an empty workspace and log a warning
- failed persistence -> log and continue message delivery flow
- malformed media entry -> skip that entry only

### Frontend

- API load failure -> show retry state in the workspace panel
- preview failure -> fall back to the plugin’s existing preview error state
- empty workspace -> render a quiet empty state, not an error

## Testing Strategy

### Backend tests

Add focused tests for:

1. indexing assistant-delivered files into the correct `chat_id`
2. indexing outbound-delivered files into the correct `chat_id`
3. ignoring user uploads and non-delivered files
4. deduplicating repeated file deliveries
5. reading an empty or missing workspace file

### Frontend tests

Add focused tests for:

1. showing the workspace action only when files exist
2. opening the workspace panel for the active chat
3. rendering the delivered file list
4. opening preview from a workspace file item
5. rendering empty and error states

## Incremental Delivery Plan

Phase 1:

1. add plugin backend workspace index service
2. persist delivered files for assistant/outbound messages
3. expose `GET /api/workspaces/{chat_id}`
4. add frontend workspace panel and file list
5. connect file click to existing preview

Phase 2, if needed:

- file count badges in thread list
- delete / clear actions
- sorting and filtering

## Final Recommendation

Implement the feature entirely inside `nanobot-channel-webui` as a plugin-owned session deliverables workspace.

That gives the user the desired 「每次对话一个工作空间」 experience while keeping the architectural boundary intact:

- no `nanobot` core changes
- no root `webui` changes
- no new preview engine
- only a plugin-layer index plus UI entry and list view
