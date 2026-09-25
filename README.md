# RentBook

**A local-first rent & expense ledger for landlords with a handful of units.**

No account. No cloud. No subscription. One HTML file — open it in a browser and it works, offline included.

➡️ **[Open the app](https://lyt123422.github.io/rentbook/)**

## What it does

- **Rent ledger** — per-unit monthly tracking with automatic status: paid / partial / **LATE** (you set the due day). Handles partial payments, late fees and other income.
- **Expense log** — every expense tied to a unit and to an **IRS Schedule E category**, so tax season is a printout instead of an archaeology project.
- **Tax report** — one click generates a Schedule E-shaped summary (one column per unit + a shared column for whole-building expenses like property tax). Print it for your preparer or export CSV.
- **Dashboard** — collection rate, who's late, year-to-date income/expenses/net.
- **Your data stays yours** — everything lives in your browser's local storage. There is no server, no sign-up, no telemetry. Backups are a JSON file you export yourself (do it regularly, e.g. into your Dropbox folder).

## Privacy model

Your tenants' names and your finances never leave your browser — the app contains no server code at all. It works fully offline. The trade-off: backups are on you.

## Notes

- Keep one browser tab only when bookkeeping (two tabs on the same browser share storage).
- The tax report is an organization aid shaped like Schedule E — it is not tax advice; depreciation (Form 4562) is handled with your preparer.
- Free plan covers 3 units, forever. A paid Pro upgrade (more units, multi-year reports, tenant PDF statements) is planned as a one-time purchase — no subscription.

## For developers

`license-server/` contains the optional license server (Node 22+, libSQL/Turso storage, Creem webhook fulfillment). See [license-server/DEPLOY.md](license-server/DEPLOY.md) if you want to self-host the Pro tier.

MIT licensed.
