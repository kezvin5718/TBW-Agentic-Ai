# Call Notes (call recording → tasks) — senior review, 23 Aug 2026

## Verdict

The engineering is genuinely good — the pipeline is complete, follows the house
rules, and mirrors the WhatsApp bot's proven shape. But it has **never run in
production** (zero recordings, zero watch folders in the database), one server
prerequisite is unverified, and the access level does not match the founder's
intent. Nothing is broken; it is unlaunched.

## How it works (verified in code)

Two ways in:

1. **Manual upload** (Call Notes page): browser → Supabase `calls` bucket →
   transcribed → recording is then MOVED to the uploader's Drive folder and the
   Supabase copy deleted. Supabase is transient only — house rule respected.
2. **Auto-sweep** (the good path): each person gets a personal folder in Drive
   ("Create my folder" on the page). A phone's recording app syncs into it;
   the in-app cron sweeps every few minutes, skips files younger than 2 min
   (may still be syncing), takes at most 5 per folder per sweep, and reads the
   audio straight from Drive — never copied to Supabase.

Processing: ffmpeg squeezes audio to 16kHz mono 32kbps (~14MB/hour — ffmpeg and
ffprobe ARE in the Docker image), splits into 15-minute chunks if still over
Whisper's 25MB cap, transcribes with a Hinglish/jewellery-terms steer, then
Claude Sonnet 4.6 extracts ONLY genuine commitments — one draft per piece of
work, each carrying the exact quoted words it came from. Drafts land in the
same approval tray as WhatsApp drafts; the person who recorded the call
approves them. Failures are written on the recording's row, retryable.

Ownership is settled by which Drive folder the file landed in, not guessed
from the audio — the founder's folder is separate for exactly this reason.

## Findings

1. **Never used.** `call_recordings` and `call_watch_folders` are both empty.
   The end-to-end path has not been proven with a real recording.
2. **Unverified prerequisite: `OPENAI_API_KEY`.** Whisper transcription calls
   OpenAI directly (OpenRouter has no transcription endpoint), so the server
   needs the OpenAI key in `/opt/tbw-os/.env` — separate from the OpenRouter
   key everything else uses. If it is missing, every recording fails at step
   one (the sweep at least says so plainly).
3. **Access wider than intended.** The founder states this is founder-only,
   but the code and sidebar admit employees too (each seeing only their own
   recordings; the founder seeing all). Decision taken: restrict to founder —
   sidebar entry, `/api/calls`, and `/api/calls/folders` all founder-only.
   (The per-person folder architecture stays; it costs nothing and allows
   reopening to staff later by loosening one guard.)
4. **Minor**: if transcription fails repeatedly on a manual upload, the audio
   stays in Supabase (parking to Drive happens after a successful transcribe).
   Acceptable for now; worth a cleanup sweep only if failures accumulate.

## Next steps

- [junior dev] Founder-only restriction (finding 3). Nothing else needs code.
- [founder] Verify the OpenAI key exists on the server (command provided in
  chat — it checks presence without printing the secret).
- [founder] Launch test: open Call Notes → "Create my folder" → drop one real
  call recording into that Drive folder (or upload one on the page) → within a
  few minutes expect a transcript and drafted tasks awaiting approval.
