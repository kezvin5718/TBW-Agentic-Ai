# Task attachments (to 500MB, straight to Drive) + optional deadlines

## Data — DONE (production)

- `tasks.deadline` is now nullable.
- `task_attachments`: id, task_id (fk, cascade), file_name, mime, size_bytes,
  drive_file_id, url, uploaded_by, created_at. RLS on; service role writes.

## Part 1 — attachments

**Why not through the portal server:** a 500MB body buffered by a Next route
would gamble the container's memory. The browser uploads **directly to Google
Drive** over a resumable session the server opens; the portal never carries
the bytes.

Flow:

1. `POST /api/task-files/init` (staff) — body `{ taskId, fileName, mime,
   sizeBytes }`. Validates size ≤ 500MB and that the task exists. Opens a
   Drive resumable session server-side (auth lives there):
   `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`
   with metadata `{ name, parents: [folderId] }` and the stored Drive access
   token (read src/lib/google-drive.ts for how tokens are obtained/refreshed
   and how folders are ensured — reuse its helpers; do not reimplement auth).
   Folder: root **"TBW Task Files"**, one subfolder per client name (task's
   client) else "General" — same ensure-folder pattern the lib already uses.
   Returns `{ sessionUrl }` (the Location header). The session URL is a
   capability URL — the browser needs no Google auth to PUT to it.
2. Browser PUTs the file to `sessionUrl` in 8MB chunks with `Content-Range`,
   driving a per-file progress bar. On the final chunk Google answers with the
   file's JSON (id). CORS on googleapis upload endpoints permits this.
3. `POST /api/task-files/complete` (staff) — `{ taskId, driveFileId,
   fileName, mime, sizeBytes }`. Server verifies the file exists via the Drive
   API, applies the same anyone-with-link reader permission the lib applies to
   stored media (again: reuse the lib's permission helper), builds the url in
   the house convention (lh3 for images, `drive.google.com/file/d/<id>/view`
   for everything else — copy whatever storeToDriveStrict returns as its url
   for each type), inserts the `task_attachments` row, returns it.
4. `DELETE /api/task-files` — `{ id }` (staff): removes the row AND trashes
   the Drive file (files.delete via the lib's auth). An attachment nothing
   references must not squat in Drive.

UI (TaskBoard.tsx):
- The add/edit task modal gains "Attach files" (multi-pick, any type). Files
  chosen before the task exists upload after the task row is created (create
  first, then init/upload/complete per file, sequential, per-file progress
  bar in the modal; failures reported per file, the task itself still saves).
  On edit, uploads attach immediately.
- The expandable task detail (`taskDetail`) lists attachments as paperclip
  chips: name + human size, opening `url` in a new tab; a small ✕ on each
  (staff) calls DELETE with a confirm.
- `/api/team-tasks` GET gains the attachments (join or a second query keyed
  by task ids — pick the cheaper shape for its existing response).

## Part 2 — optional deadline

- Add/edit modal: deadline input no longer required; helper text "Leave empty
  when there is no fixed date — set one when it's urgent." Clearing works.
- Everything downstream becomes null-safe, verified by grep on `deadline`:
  - TaskBoard sorts: due_asc/due_desc put null-deadline tasks LAST in both
    directions; late detection (`new Date(t.deadline) < now`) skips nulls;
    the red "N late" chips therefore stay honest; the deadline cell renders
    "no deadline" in muted slate.
  - Dashboard (page.tsx): teamDueToday and employee task lists skip nulls.
  - MyTaskCard, overdue digest (cron-jobs), manager findings that read
    deadlines: nulls excluded, never treated as overdue.
  - task-router load counts are status-based — unaffected, but verify.
  - Auto-created tasks (WhatsApp/call drafts +2d, festivals = festival date,
    sheet scan) keep their invented deadlines — bots need urgency; only
    humans get the blank.
  - `/api/team-tasks` POST/PATCH accept null/absent deadline.
```
