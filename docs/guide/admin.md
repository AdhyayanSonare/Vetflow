# Admin guide

For the person who looks after the clinic's Vetflow: staff, branches, switches and the audit trail. Server tasks (deploying, backups, recovery) are in the [runbooks](../runbooks/deploy.md).

## First steps for a new clinic

1. The person who set up the server creates the first admin (see [deploy.md](../runbooks/deploy.md), step 3) and gives you a one-time password. Sign in and set your own password under **Settings, Users**.
2. **Settings, Branches.** Add each branch. Each new branch gets a store of its own, and a head-office store exists from the start.
3. **Settings, Users.** Add staff. Choose a role (Admin, Inventory manager, Pharmacist, Vet, Viewer) and the branches they work in. Give each person their own account: never share one, because the audit log records who did what.
4. **Inventory, Import.** Load your medicine list and opening stock from Excel. Review the preview before confirming. Or add items by hand under **Inventory, Items**.
5. **Settings, Features.** Decide on voice and barcodes (below).
6. Walk through one real prescription, from consultation to dispense, with a vet and a pharmacist before going live.

## Users

- **Add:** email, name, role, a starting password (at least 10 characters with a letter and a number) and branches. Tell the person their password in person or by phone, and ask them to change it.
- **Forgotten password:** edit the user and set a new one. This unlocks the account and signs out their old sessions.
- **Leaving staff:** set the user to inactive. They are signed out at once and history is kept.
- **Roles** are fixed (see the table in the [user guide](users.md)). There must always be one active admin, and the app will not let you remove the last.
- Someone who cannot reach their admin and is locked out of everything: see the incident runbook.

## Features

Under **Settings, Features** each clinic group has switches. Everything works with both off.

- **Voice** (on by default): recording and uploading audio for consultations. Off, the Record flow offers typing only. It needs a speech service set up by whoever runs the server (a hosted API key, or the local speech service).
- **Barcodes** (off by default): a scan button in the item search, which uses the phone or laptop camera where the browser supports barcode scanning. Typing a code or a name always works.
- **Stock rules.** Whether selling below zero may be overridden (off by default; when on, it needs an admin or inventory manager and a written reason, and is logged), and how many days before expiry to warn (default 90, 60 and 30).
- **Transcript retention.** How long dictation text is kept, in days (0 keeps it forever). A nightly job removes older transcripts and records that it did. Audio is not stored.

## Audit log

**Settings, Audit** lists every sign-in (and failure), stock change, receipt, dispense, approval, user and settings change: who, when, what, and the reason where one was needed. Filter by dates. It can only be added to, never edited, by the application. Reports has the same log for download.

Use it when stock does not match, when someone says "I did not do that", or when you need to show a regulator what happened.

## Subscription and licences

**Settings, Subscription** shows the plan, billing period (monthly or quarterly), next invoice date and invoices. Invoices are issued by Astraon Labs. **Licences** lists the software and models Vetflow is built on, with the credits their licences require.

## Good habits

- Review **Inventory, Alerts** daily, and **Reports, Expiry** weekly.
- Do a count of each store regularly, starting with controlled medicines.
- Check **Settings, Users** every few months and deactivate anyone who has left.
- Keep the demo accounts away from real data: demo sign-ins (`@greenfield.demo`) are public.
