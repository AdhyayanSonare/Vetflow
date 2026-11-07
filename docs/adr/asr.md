# ADR: Speech to text and note drafting

Status: accepted for the demo; the local-model part is built but **not benchmarked**.

## Context

Vets dictate consultations in a noisy clinic, often in Indian-accented English, sometimes Hindi, and say drug names that general speech models misspell ("Car Pro FN" for carprofen). The brief asked for a local model (NVIDIA Canary-180M-Flash, which runs on a CPU), a provider interface, voice-activity detection, an evaluation harness, and no language model in the first pass. The collaborators' branches already used Groq's hosted Whisper and a hosted language model, and the product owner then said hosted APIs are acceptable for now.

## Decision

1. **A provider interface, chosen by configuration** (`server/modules/voice/asr.ts`, `server/config/env.ts`):
   - `GROQ_API_KEY` set: hosted Whisper (`GROQ_TRANSCRIBE_MODEL`, default `whisper-large-v3`).
   - else `ASR_URL` set: the local `asr/` service.
   - else none: recording is switched off in the interface and typed dictation still works.
   The browser never sees a key. Audio is never stored; only the transcript text is, and only when the vet saves it. Transcripts are deleted after the clinic's retention period (default 365 days) by the nightly job.
2. **The local service** (`asr/app.py`, FastAPI) has one `POST /transcribe` and a model behind it: Canary-180M-Flash (English, German, French, Spanish) when built with `requirements-canary.txt`, and `faster-whisper` for Hindi and as a general fallback. Silero VAD removes silence before decoding. Models are CC-BY-4.0 (Canary) and MIT (Whisper, Silero); the credit is shown in **Settings, Licences**. The service is optional and off by default in Compose (`--profile asr`).
3. **Drug names are fixed after recognition, not trusted to the model.** `server/modules/voice/structure.ts` matches what was heard against the clinic's own catalogue with `pg_trgm` similarity, rejoins split words, uses strength to choose between pack sizes, and reads dose, frequency and duration. Anything it cannot match with confidence is shown to the vet as unmatched.
4. **A language model may draft notes, but only inside guard rails** (`server/modules/voice/extract.ts`): the model is asked for structured output; every medicine it returns must appear in the transcript (checked in code, case-insensitively) or it is dropped; the lines are then matched to the catalogue by the same deterministic code; failures return a retryable error without provider details. This departs from "no language model in this pass"; it exists because the collaborators' branch shipped it and the owner asked for it to be kept. It is off when there is no key.
5. **Nothing speech produces is ever final.** A draft cannot be dispensed. A vet reviews it, completes the clinical fields, and approves a prescription as a separate step that the database enforces.
6. Transcripts are shown verbatim and clinical fields are not auto-filled as final answers.

## What is verified, and what is not

- Verified by automated tests: endpoint validation (type by bytes, size, rate limit, role, tenant switch), provider failure handling, the catalogue matcher (dose, frequency, duration, quantity, strength choice, mis-hearings, split words), grounding of the hosted extraction, and that voice never changes stock or prescriptions.
- Verified once, by hand: the local service starts and transcribes a synthetic clip with `whisper-tiny` (cold start 39.7 s, then 0.44 s). That checks the code path only. **It says nothing about accuracy.**
- **Not measured:** word error rate and drug-name hit rate on real clinic audio, for either Canary or Whisper, in English or Hindi. No real recordings exist yet. The accuracy table in `docs/PROGRESS.md` is empty on purpose and stays empty until they do. Do not quote a figure for this feature.
- **Not built:** the evaluation harness under `eval/asr/`. The plan is a script that reads a folder of `clip.wav` + `clip.txt` pairs plus a list of drug names, runs each provider, and prints word error rate and drug-name hit rate per provider and language. It needs the clinic's recordings.

## Consequences

- The demo works end to end with a Groq key and degrades cleanly without one.
- Sending audio to a hosted provider leaves the clinic's network. This is acceptable for the demo with synthetic or consented audio; a clinic with a data-residency requirement must use the local service and accept its accuracy until it is measured.
- Switching provider is a configuration change; adding one is one function.
