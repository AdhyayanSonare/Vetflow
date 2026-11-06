# Demo guide

The demo clinic is **Greenfield Veterinary Group (demo data)**: two branches, three stores, forty catalogue items, eight patients and six staff accounts. Everything in it is invented, including the phone numbers and the supplier details.

## Starting it

```bash
pnpm install
pnpm demo
```

Open <http://localhost:3000>. On a phone or tablet on the same Wi-Fi, open `http://<laptop address>:3000`.

## Accounts

Every account uses the same password, which is printed when `pnpm demo` starts and is defined in `shared/demo.ts`. It is public. It exists only for this demo.

| Account | Role | What to show |
|---|---|---|
| `dr.sharma@greenfield.demo` | Vet | Patients, a voice or typed consultation, prescription approval |
| `dr.rao@greenfield.demo` | Vet | A second vet at the other branch |
| `pharmacy@greenfield.demo` | Pharmacist | Dispensing queue, batch preview, open vials |
| `stores@greenfield.demo` | Inventory manager | Receipts, orders, transfers, counts, alerts, reports |
| `admin@greenfield.demo` | Admin | Users, branches, feature switches, audit log |
| `viewer@greenfield.demo` | Viewer | Read-only access |

## A ten-minute walkthrough

1. **Vet, on a phone.** Sign in as Dr. Sharma. Tap **Record** (the round button), then choose "Type or paste a dictation instead". Paste: *Give doxycycline 100 mg one tablet twice daily for seven days and metronidazole 200 mg one tablet three times a day for five days.* Tap **Draft from text**, review the notes, add a diagnosis, and open the prescription. Both medicines are matched to the catalogue. Approve it.
2. **Pharmacist.** Sign in as Kavya Nair, open **Dispensing**, and dispense Max's approved prescription. The dialog shows which batches will be used, earliest expiry first.
3. **Stock changed.** Sign in as the inventory manager and open the item. The batch quantity has dropped, and the movement history shows who did it and when.
4. **Alerts.** The demo is seeded with an expired batch, batches expiring soon, low-stock items and a transfer that arrived short. Open **Inventory, Alerts**.
5. **A receipt.** Create a receipt with a batch and expiry date. Stock does not change until you confirm it.
6. **A count.** Start a count, change a number, and see that a reason is required before it can be posted.
7. **Admin.** Open **Settings, Features** and switch voice off. The Record flow now offers typing only. Everything else still works.

## Voice in the demo

- With `GROQ_API_KEY` in `.env`, recording and uploading audio are transcribed, and notes are drafted by a language model, then matched to the catalogue.
- Without a key, the **Record** screen says transcription is not set up, and typed dictation still drafts the medicines using the catalogue matcher.
- Whatever the source, the draft is only a draft. A vet reviews it, and only a vet's approval makes a prescription real.

## Resetting

`pnpm demo:reset` deletes the demo database and starts again from the seed.

## Using a hosted database instead

Point `.env` at a PostgreSQL (for example Supabase), run `pnpm db:migrate`, and on an **empty** database run `pnpm db:seed`. The seed refuses to run if any tenant already exists. The hosted demo has the same public accounts, so keep it behind `SITE_PASSWORD` if it is reachable from the internet.
