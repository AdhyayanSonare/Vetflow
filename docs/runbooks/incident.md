# Incident runbook

First: stay calm, write down the time, and change nothing you cannot undo. Most of these have a quick, safe answer.

## The app is down

1. `curl https://<your domain>/api/health`. If it answers, the problem is the browser or the network.
2. `docker compose ps`. Anything not `running`/`healthy`?
3. `docker compose logs --tail 100 api proxy postgres`.
4. Common causes:
   - **Disk full:** `df -h`; clear old Docker images with `docker image prune`.
   - **Database not accepting connections:** `docker compose restart postgres`, wait until healthy, then `docker compose restart api worker`.
   - **A bad update:** check out the previous commit, `docker compose up -d --build`.
   - **Certificate problem:** `docker compose logs proxy`; confirm the domain still points at this VM and ports 80/443 are open.

## Someone cannot sign in

- **Forgot the password:** email reset is **not set up** (there is no mail server). The reset page says so and tells the person to ask their admin. An admin opens **Settings, Users**, edits the person, and sets a new password. That also clears a lock and signs out their old sessions. Tell them the new password in person or by phone, and ask them to change it.
- **"This account is locked":** five wrong passwords lock an account for 15 minutes. An admin setting a new password unlocks it at once.
- **"Too many sign-in attempts":** the limit is 10 tries per 15 minutes for one address and email. It is kept in the API's memory, so it clears after the window or when `api` restarts: `docker compose restart api`.
- **The only admin cannot sign in:** from the server, as someone with the database credentials:

  ```bash
  docker compose run --rm migrate node dist/user-set-password.js --email owner@greenfield.example
  ```

  It prints a new one-time password, clears the lock, signs the user out everywhere and writes an audit entry. If it says the account is deactivated, that is a separate setting an admin must change.

## Stock figures look wrong

1. **Inventory, Alerts** shows differences found by the nightly check, which compares each balance with the sum of its ledger rows.
2. Open the item: **Movement history** lists every change with who made it and when. The balance is only ever the sum of these.
3. Correct it with **Adjust stock** (needs a reason) or a **stock count**. Do not edit the database by hand: the application cannot update or delete ledger rows, on purpose.
4. If a *difference between the balance and the ledger* persists after that, treat it as a bug: keep the movement history, note the time, and open an issue.

## A mistake was approved or dispensed

- **Prescription:** frozen once approved, even at the database level. Use **Cancel prescription** on its page (a reason is required and is recorded) and have the vet write a new one.
- **Dispense:** there is no "undo" button in this release. Put the stock back with **Adjust stock, Count correction: add stock**, and give a reason that names the prescription. Both entries stay in the history. (A "return to store" screen is on the list of gaps; the server already supports the movement.)

## Suspected misuse or a leaked password

1. Deactivate the user (**Settings, Users**). This signs them out immediately.
2. Read **Settings, Audit** for that user and period. Sign-ins, stock changes, approvals and settings changes are recorded and cannot be edited by the application.
3. Rotate secrets that may have leaked:
   - `APP_DB_PASSWORD`: edit `.env`, run `docker compose run --rm migrate` (it sets the app role's password), then `docker compose up -d`.
   - `POSTGRES_PASSWORD` is only used the first time the database is created, so changing `.env` alone does nothing. Run `docker compose exec postgres psql -U postgres -c "alter user postgres password 'NEW'"` first, then put the same value in `.env` and `docker compose up -d`.
   - `GROQ_API_KEY` at the provider, then in `.env`; and `SITE_PASSWORD`.
4. If client data may have been exposed, tell the clinic owner the same day. They decide whether others must be told.

## After any incident

Write four lines in `docs/PROGRESS.md` or an issue: what happened, when, what fixed it, what stops it happening again.
