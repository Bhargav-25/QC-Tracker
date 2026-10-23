# QC Track — Machine QC & Dispatch Tracker

A React web app for tracking quality-control checks on machines: resistance
testing, temperature testing, stage photos, packing checklist, final packing,
and dispatch — with a dashboard showing packed inventory by machine number.

Built with React + Vite + Firebase (Firestore for data, Storage for photos),
designed to run as a static site on GitHub Pages first, and to become the
base for an iOS/Android app later.

## 1. Firebase setup

You said you already have a Firebase project with Firestore and Storage
enabled. You still need to do three things:

**a. Get your web app config**
Firebase console -> Project settings (gear icon) -> General -> "Your apps" ->
add a Web app (`</>` icon) if you don't have one yet -> copy the config
object it gives you.

**b. Create your local `.env` file**
```
cp .env.example .env
```
Paste your config values into `.env`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```
`.env` is already in `.gitignore` — it will never be committed.

**c. Set your security rules**
This repo includes starter `firestore.rules` and `storage.rules` that allow
open read/write, so the app works immediately for a small internal team with
no login screen. In the Firebase console, go to Firestore Database -> Rules,
and Storage -> Rules, and paste in the matching file's contents, then Publish.

> Before this is used outside your own team, add Firebase Authentication and
> change `allow read, write: if true;` to `if request.auth != null;` in both
> rule files. The comments in each file flag exactly where.

## 2. Run it locally

```
npm install
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`). Try adding a
machine, filling in a few tabs, and confirm the data shows up in your
Firestore console.

## 3. Push to GitHub

```
git init
git add .
git commit -m "Initial QC tracker"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 4. Deploy to GitHub Pages

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that builds and deploys automatically on every push to `main`.

**One-time setup:**

1. **Set the base path.** Open `vite.config.js` and set `base` to
   `/<your-repo-name>/` (matching the exact repo name). If you're deploying
   to a custom domain instead, set it back to `/`.
2. **Add your Firebase config as GitHub secrets** (so the deployed build has
   them — `.env` itself is never pushed). Go to your repo -> Settings ->
   Secrets and variables -> Actions -> New repository secret, and add each of
   the six `VITE_FIREBASE_...` values from your `.env` file as its own
   secret with the matching name.
3. **Enable Pages.** Repo -> Settings -> Pages -> Source -> select
   "GitHub Actions".
4. Push to `main`. The Actions tab will show the build/deploy run; when it
   finishes, your site is live at `https://<your-username>.github.io/<your-repo>/`.

## How the data is structured

Each machine is one document in the `machines` Firestore collection:

- `machineNumber` — string, entered when the machine is created
- `resistance` — array of 6 rows `{ current, eccentric, concentric }` for the
  fixed current values 4, 9, 14, 18, 22, 37.5
- `temperature` — `{ temp, time }`, one reading per machine
- `photos` — object keyed by category (`ropeBurn`, `shoulderPulley`, `led`,
  `armEnd`), each an array of `{ url, path }` uploaded to Storage
- `packingChecklist` — 7 booleans for items that go in the shipped box
- `packingSentBack` — booleans marking which missing items have since been
  sent separately (clears the notification)
- `finalPacking` — 4 booleans for the physical packing steps
- `dispatch` — `{ dispatched, date, comment }`

**Status** shown on the dashboard is computed automatically from this data,
not stored separately, so it can't drift out of sync:

- **Assembly stage** — machine number saved, nothing else started
- **Testing** — any of resistance / temperature / photos / packing checklist
  has been started
- **Packed** — all 4 final-packing steps are checked
- **Dispatched** — manually marked on the Dispatch tab (this is the one
  status that's a deliberate action rather than a computed state)

## Notifications

Any packing-checklist item left unchecked shows up on the Notifications page
as "Machine X — missing: Item". Once that part is sent to the customer
separately, click "Mark sent" to clear it.

## Next step: mobile app

This was built with the mobile app in mind: the Firestore data model and the
`src/utils` and `src/constants.js` logic are framework-agnostic, so they can
be reused almost as-is in a React Native app with the same Firebase project
— you'd rebuild the screens with React Native components but keep the same
`machinesApi.js` functions and status logic.

## Access control (Admin / Production / Installation / Dashboard / Sales)

The app now requires sign-in, with five roles that see different things:

- **Admin** — full access to everything, including orders, Manage Users and
  the global Maintenance page.
- **Production** — Machines list, Orders (assign a Packed machine, not edit
  the customer), Add Machine, Stand Inventory, Notifications, and (inside a
  machine) Resistance, Temperature, Photos, Packing Checklist, Final Packing,
  and Dispatch.
- **Installation** — a filtered Machines list (machines ready for them, plus
  ones they've already installed) and, inside a machine, only the Delivery
  and Installation tabs. Installation photos automatically capture GPS
  coordinates (the browser will prompt for location permission).
- **Dashboard** — the numbers-only Dashboard page and nothing else.
- **Sales** — the Orders pages only. Can create and edit orders. Cannot
  assign machines, and cannot change machines, tickets, inventory, or users.
  The order badge still reads the linked machine's computed status, so a
  Sales login can read machine documents; the app does not give them a
  Machines page.

### One-time setup

**1. Enable Firebase Authentication**
Firebase console → Authentication → get started → enable the **Email/Password** sign-in provider.

**2. Create your own login**
Authentication → Users → Add user → enter your own email and a password.

**3. Sign in once on the site**
Visit your deployed app and log in with that email/password. You'll land on
a "Waiting for access" screen — that's expected, and confirms your account
was created.

**4. Make yourself Admin (bootstrapping the first account)**
This one step has to be done manually, because the app itself won't let
anyone assign the very first Admin role (by design — otherwise anyone could
grant themselves Admin). In the Firebase console:
- Firestore Database → Data tab → `users` collection
- Find the document with your email
- Edit the `role` field, set it to exactly `Admin` (capital A), save

Reload the app — you're now Admin, and can assign roles to everyone else
from **Manage Users** instead of doing this console step again.

**5. Add everyone else**
For each teammate: create their login in Authentication → Users (same as
step 2), have them sign in once, then assign their role from Manage Users.

**6. Re-publish the rules**
`firestore.rules` and `storage.rules` in this repo were updated to require
sign-in and enforce these roles — paste the new versions into the Firebase
console (Firestore → Rules, and Storage → Rules) and publish both. Orders
need the rules in this repo (the `orders` collection and the Sales role).
Deploying them is a manual step; see the checklist below. Do not deploy from
CI.

## Orders

Customer orders live in Firestore at `orders/{groupNumber}`. The document id
is the group number (`G1458`). A `/` in a historical group number is stored
as `~` in the id (`G338/9` → `G338~9`); the `groupNumber` field keeps the
original text.

Sales status on the order is **Pause Shipment**, **Please Ship**, or
**Cancelled**. Payment is **Paid**, **Advance**, **COD**, or **Cancelled**.
The other columns from the "Move to this slowly" tab (customer, contact,
city, address, comments, order date, Tab, Accessories, Hanger, Bench,
Glass/Metal, warranty, order type, payment status) are stored on the same
document.

Machine status is still computed, never stored as the source of truth. Once
a machine is assigned, the badge on the order uses that computed status
(Packed / Dispatched / Delivered / Installed). Cancelled still shows as
Cancelled. Imported rows whose sheet status was something else (Installed,
Shipped, …) keep that label in `sheetStatus` until someone sets a sales
status or a machine is linked, so the sheet mirror does not flatten history.

Each machine may store `groupNumber`. Production or Admin assigns one from
the order page, and only Packed machines that are not already assigned are
offered. The machine page shows an order card that links back.

The Dispatch tab stores the machine courier (Smartr, Safexpress, Delhivery,
Other) and tracking number, plus accessories shipped separately (their own
courier, tracking number, sent-on date, and status Not sent / In transit /
Delivered).

GitHub Pages deploy is unchanged. Nothing here deploys functions or rewrites
Firestore for you.

### Orders API (sales bot)

One HTTPS function, `api`, authenticated with a shared key stored as the
Functions secret `ORDERS_API_KEY`. The key is never committed. Send it as
`Authorization: Bearer <key>` or `x-api-key: <key>`.

Cloud Functions need the **Blaze** plan. The function URL is printed when
you deploy. It looks like:

```
https://<region>-<project-id>.cloudfunctions.net/api
```

Routes (the `/api` prefix is optional; `/v1` is the version):

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1` | Lists resources. `tickets` is reserved and not implemented. |
| POST | `/v1/orders` | Create an order. Idempotent on `groupNumber`. |
| GET | `/v1/orders/<groupNumber>` | Read one order. |
| PATCH or PUT | `/v1/orders/<groupNumber>` | Update any order field (status, payment, comments, customer, …). |

A second POST for a group number that already exists returns the stored
order with `created: false` and does **not** overwrite it. Retries are safe.
To change fields, PATCH. Machine assignment is not accepted on this API;
Production does that in the app. The same function is the place to add
`/v1/tickets` later (maintenance) under the same API key. That route
currently returns 501.

Group numbers that contain `/` must be percent-encoded in the path
(`G338%2F9`).

Create:

```
POST /v1/orders
Authorization: Bearer $ORDERS_API_KEY
Content-Type: application/json

{
  "groupNumber": "G1458",
  "status": "Please Ship",
  "payment": "COD",
  "customer": "Dr Shouvick",
  "city": "Kolkata",
  "contact": "98366000082",
  "orderDate": "2026-10-22",
  "comments": "COD paid 22 Oct"
}
```

```
201
{ "ok": true, "created": true, "order": { "groupNumber": "G1458", "status": "Please Ship", "payment": "COD", "customer": "Dr Shouvick" } }
```

The same POST again:

```
200
{ "ok": true, "created": false, "order": { "groupNumber": "G1458", "status": "Please Ship" } }
```

Update and read:

```
PATCH /v1/orders/G1458
{ "status": "Pause Shipment", "comments": "Customer asked to wait" }
```

```
200
{ "ok": true, "order": { "groupNumber": "G1458", "status": "Pause Shipment", "comments": "Customer asked to wait", "payment": "COD" } }
```

```
GET /v1/orders/G1458
```

`status` must be Pause Shipment, Please Ship, or Cancelled. `payment` must
be Paid, Advance, COD, or Cancelled. Dates are `YYYY-MM-DD`.

### Sheet mirror

`syncOrderToSheet` runs when an order is written. `syncMachineToSheet` runs
when a linked machine is written (dispatch, delivery, installation, packing).
Both update the tab **Move to this slowly** on spreadsheet
`1oCZ75jD-Xw2peBZZ2DSp2z9gFRsdQtXy3XSAZZ34WHE`.

Column order is unchanged. Columns Z (Days since Shipped) and AB (Days Left
Under Warranty) are formulas and are not overwritten. A newly appended row
gets those formulas copied. Warranty Period (column AA) is filled from the
warranty text.

While no machine is linked, a historical status such as Installed is written
back as it was imported. After a machine is linked, the Status cell becomes
the machine's computed status (unless the order is Cancelled). Smartr and
Safexpress tracking go in their existing columns. Delhivery and Other have
no column of their own; that tracking is written in the Safexpress column,
prefixed with the courier name for Delhivery. Accessories courier, tracking,
and status go in Acc Tracking and Acc Status.

The mirror is one-way: edits people type into the sheet are replaced the
next time the order or machine is saved in QC Track.

### One-time import

`scripts/import-orders.mjs` reads the two exported workbooks. It does not run
on its own, and it does not run in CI.

```
cd scripts
npm install
cd ..
node scripts/import-orders.mjs \
  --orders /path/to/orders.xlsx \
  --machines /path/to/machine-records.xlsx \
  --report import-report.json
```

That is a dry run. It writes `import-report.json` (gitignored; it contains
customer data) and does not contact Firebase. Review:

- duplicate group numbers with different customers are skipped
- a machine is linked only when the batch-tab customer name matches exactly
  one order and exactly one machine number
- everyone else is listed under `unmatched` or `orderIssues`, with the reason

When the report looks right, and only then:

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
  node scripts/import-orders.mjs \
  --orders /path/to/orders.xlsx \
  --machines /path/to/machine-records.xlsx \
  --report import-report.json \
  --commit
```

`--commit` creates orders that are not already in Firestore and links
machines that already exist in QC Track. It does not create machines, and it
does not overwrite an order or a machine link that is already there. The
service account needs the Firebase Admin / Cloud Datastore User role on the
QC Track project. Prefer a key file via `GOOGLE_APPLICATION_CREDENTIALS`,
not a key pasted into the command line.

### Manual setup checklist

Do these yourself. This repo does not deploy functions, does not publish
rules, and does not write to the live project.

1. **Blaze plan.** Firebase console → the QC Track project → upgrade to
   Blaze. Cloud Functions will not deploy on the free plan.
2. **CLI.** `npm install -g firebase-tools`, then `firebase login`, then
   `firebase use <project-id>` in this repo. The project id is the one in
   your existing web config, not the display name "QC Track".
3. **Rules.** Review `firestore.rules`, then
   `firebase deploy --only firestore:rules`. This publishes the Sales role
   and the `orders` collection. It does not touch existing documents.
4. **API key secret.** Pick a long random string and store it only as a
   secret: `firebase functions:secrets:set ORDERS_API_KEY`. Do not put it in
   `.env`, GitHub, or the sheet.
5. **Sheets service account.** In Google Cloud (same project, or any project
   you control): APIs & Services → enable **Google Sheets API**. IAM →
   create a service account. Create a JSON key. Share the orders spreadsheet
   with that service account's email as **Editor**. Then
   `firebase functions:secrets:set SHEETS_SERVICE_ACCOUNT` and paste the
   whole JSON when prompted. An empty secret skips the mirror; a bad key is
   logged and not retried forever. Sheets rate limits are retried.
6. **Deploy functions.** `npm install` inside `functions/`, then
   `firebase deploy --only functions`. The predeploy hook bundles
   `functions/lib` (the directory Cloud Functions actually uploads). Note
   the `api` URL from the deploy output and give it to the sales bot with
   the API key. If the function rejects anonymous callers, the deploy used
   a private invoker: the function is declared `invoker: "public"` and the
   API key is what authorizes the bot.
7. **Sales user.** Authentication → Add user (email + password). Have them
   sign in once. As Admin, open Manage Users and set the role to **Sales**.
8. **Import.** Dry-run the script, read the unmatched report, then
   `--commit` if you want Firestore filled from the sheets.
9. **Bot.** Point the sales bot at `POST` and `PATCH` on the `api` URL.
   Stop writing new rows to the sheet; QC Track is the source of truth and
   the sheet is the read-only mirror.

`npm test` covers order status, the sheet row, import matching, and the HTTP
handler. `npm run build` is still the GitHub Pages build and does not deploy
functions.
