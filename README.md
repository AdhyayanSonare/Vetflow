# VetFlow AI

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

## Deploying (Render)

`render.yaml` is a Blueprint that builds the existing `Dockerfile`. In Render: **New > Blueprint**, pick this repo and the `voice-transcription` branch, then fill in the two secrets it asks for:

- `GROQ_API_KEY`: your Groq key (stays on the server).
- `SITE_PASSWORD`: one shared password for the whole site (browser prompts for it; any username works). If unset, the site and the Groq-backed endpoints are open to anyone with the URL.

The microphone only works over HTTPS, which Render provides. Data is still stored in each browser (localStorage). Free instances sleep after idle time, so the first load can take about a minute.

## Voice transcription

Consultation recording and audio upload use Groq's Whisper (`whisper-large-v3`). Set `GROQ_API_KEY` in the server environment (`.env`, gitignored); `GROQ_API_URL` is optional and defaults to `https://api.groq.com/openai/v1`. The key is only read on the server and is never sent to the browser.

- **Browser:** Start/Pause/Resume/Stop use `getUserMedia` + `MediaRecorder` (`client/src/hooks/useAudioRecorder.ts`); microphone tracks are released on stop and on unmount. "Upload audio file" feeds the same flow. Both validate type and size before upload (`client/src/lib/voice.ts`). Failed transcriptions keep the audio so the user can retry.
- **Server:** `POST /api/voice/transcribe` (`server/voiceUpload.ts`) takes the raw audio bytes as the request body with an `audio/*` Content-Type and returns `{ transcript, language, requestId }` or `{ error: { code, message } }`. It enforces the 25 MB Groq limit, checks the declared type and the file's magic bytes, rate-limits per client (12/min), never fetches user-supplied URLs, and does not log audio or secrets. The previous URL-based `voice.transcribe` tRPC mutation was removed because it allowed server-side requests to arbitrary URLs.
- **Supported formats:** MP3, WAV, M4A/MP4, WebM, OGG/Opus, FLAC; max 25 MB.
- **Extraction:** after transcription, the browser POSTs the transcript to `POST /api/consultation/extract` (`server/consultationExtract.ts`, `server/_core/consultationExtraction.ts`). A Groq chat model (default `openai/gpt-oss-120b`, override with `GROQ_EXTRACTION_MODEL`) returns JSON for the clinical notes and medicines. The prompt allows only what was explicitly said (unstated fields stay empty), the transcript is treated as data, and medicines whose name never appears in the transcript are dropped. Output is validated, and the transcript is never logged. If extraction fails the vet can retry or fill the notes in manually.
- **Clinical notes:** the transcript is shown verbatim. Extracted notes and medicines are drafts for veterinarian review; diagnosis defaults to "Pending doctor's confirmation" unless one was stated, and nothing is final until the vet saves and approves. Note: the endpoint has no sign-in check because the app currently has no login flow in the UI; add `protectedProcedure`-style auth before exposing it publicly.
- **Tests:** `pnpm test` covers the upload and extraction routes (Groq mocked), the Groq helper and client helpers. Browser recording itself needs a real microphone and is verified manually.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.
