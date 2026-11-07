# Speech evaluation

Measures how well each speech provider turns real consultation audio into text, and how often it gets the **drug names** right, which matters more than the rest of the sentence.

**Status: the harness is built and its scoring is unit-tested. It has not been run on real audio, because no real recordings exist yet.** `docs/PROGRESS.md` has an empty accuracy table for that reason. Do not quote a figure until a run has filled it.

## What to collect

At least 50 short clips (15-60 seconds) recorded the way vets will really dictate: the clinic's own phones, background noise, accents, and a few in Hindi if Hindi is required. For each clip, someone types **exactly what was said**.

```
eval/asr/clips/
  001.wav        # or mp3, m4a, webm, ogg, flac
  001.txt        # the words actually spoken, verbatim
  001.lang       # optional: en, hi, de, fr, es (default: --language)
eval/asr/drugs.txt   # one drug name per line, the names that must come out right
```

Copy `drugs.example.txt` to `drugs.txt` and replace it with the clinic's catalogue. Recordings contain animal owners' details: keep `clips/` out of git (it is ignored) and get consent first.

## Run

```bash
pnpm eval:asr                         # every configured provider (GROQ_API_KEY and/or ASR_URL in .env)
pnpm eval:asr --provider local --language hi
```

It prints, per provider and language: word error rate (corpus level: total errors divided by total reference words), the drug-name hit rate (a listed drug said in the reference counts as hit if the same word sequence appears in the output), and seconds per clip. Results are also saved under `eval/asr/results/`.

To compare Canary and Whisper locally, run the `asr` service twice with `ASR_PROVIDER=canary` and `ASR_PROVIDER=whisper` and point `ASR_URL` at each.

## Reading the numbers

- Word error rate over about 10% starts to cost the vet more editing time than typing. Drug-name hit rate is the number to watch: a missed drug is a prescription line a vet must fix by hand.
- The deterministic matcher in `server/modules/voice/structure.ts` rescues some misheard names ("Car Pro FN"); this harness scores the raw transcript, before that step, so it measures the recogniser alone.
