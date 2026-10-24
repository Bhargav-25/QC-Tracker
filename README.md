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

### Machines API (inventory bot)

A second HTTPS function, `machinesApi`, is read-only. It uses its own secret,
`MACHINES_READ_API_KEY`. The orders key is not accepted here, and this key
is not accepted by `api`. Send it the same way as the orders API:

```
X-API-Key: <MACHINES_READ_API_KEY>
```

`Authorization: Bearer <MACHINES_READ_API_KEY>` also works. A missing or
wrong key is `401`. Any method other than `GET` is `405`.

The base URL is printed at deploy. It looks like:

```
https://<region>-<project-id>.cloudfunctions.net/machinesApi
```

Find it in the deploy log (`Function URL (machinesApi)`) or in Firebase
console → Functions → `machinesApi`. Paths below are relative to that base.
A `/v1` prefix is accepted and optional.

| Method | Path | Purpose |
|---|---|---|
| GET | `/machines` | List machines. |
| GET | `/machines/<machineNumber>` | One machine. `404` if it does not exist. |
| GET | `/inventory/machine-stand` | Stand stock `{ count, updatedAt }`. |
| GET | `/parts` | Catalog plus revived stock. |
| GET | `/part-movements` | Append-only part ledger. |

`GET /machines` query parameters:

- `updatedSince` — ISO datetime. Keeps machines whose `updatedAt` is at or after that instant.
- `status` — one status or several separated by commas. Applied after the status is computed. The values are the same strings the app shows: `Returned`, `Refurbishing`, `Assembly stage`, `Testing`, `Packed`, `Dispatched`, `Delivered`, `Installed`. `Assembly` is accepted as an alias for `Assembly stage`.
- `limit` — default 200, maximum 1000 (higher values are clamped).
- `pageToken` — the previous response's `nextPageToken`. `cursor` is an alias.

Results are ordered by `updatedAt`, then `id`, oldest first. `nextPageToken`
is `null` on the last page.

Each machine includes `machineNumber`, `id`, `createdAt`, `updatedAt` (ISO),
`batch` (`X33M002` → `33`, otherwise `null`), `status` from the same
`computeStatus` function the app uses, `statusReachedAt` (a best estimate
for every status), and `sectionTimestamps` (each section's `updatedAt`, so
a consumer can apply its own rule). Testing is the earliest of resistance,
temperature, photos, packing, and final packing. Packed is the final-packing
timestamp once all four photos exist. Dispatched, Delivered, and Installed
use that section's timestamp. Assembly uses `createdAt`.

`dispatch`, `delivery`, and `installation` include the flags and dates, plus
courier and tracking fields on dispatch. `groupNo` is the linked order, or
`null`. Media is presence only: photo counts, final-packing booleans,
`installationPhotos`, and `hasVideo`. URLs and storage paths are not returned.

```
curl -sS \
  -H "X-API-Key: $MACHINES_READ_API_KEY" \
  "$BASE/machines?updatedSince=2026-10-01T00:00:00.000Z&status=Packed,Dispatched&limit=200"

curl -sS \
  -H "X-API-Key: $MACHINES_READ_API_KEY" \
  "$BASE/machines/X33M047"

curl -sS \
  -H "X-API-Key: $MACHINES_READ_API_KEY" \
  "$BASE/inventory/machine-stand"
```

`GET /machines/X33M047`:

```json
{
  "ok": true,
  "machine": {
    "id": "m47",
    "machineNumber": "X33M047",
    "createdAt": "2026-10-01T00:00:00.000Z",
    "updatedAt": "2026-10-21T08:30:00.000Z",
    "batch": 33,
    "status": "Dispatched",
    "statusReachedAt": {
      "Assembly stage": "2026-10-01T00:00:00.000Z",
      "Testing": "2026-10-04T00:00:00.000Z",
      "Packed": "2026-10-18T00:00:00.000Z",
      "Dispatched": "2026-10-21T08:30:00.000Z",
      "Delivered": null,
      "Installed": null
    },
    "sectionTimestamps": {
      "resistance": "2026-10-04T00:00:00.000Z",
      "temperature": null,
      "photos": "2026-10-06T00:00:00.000Z",
      "packing": null,
      "finalPacking": "2026-10-18T00:00:00.000Z",
      "dispatch": "2026-10-21T08:30:00.000Z",
      "delivery": null,
      "installation": null
    },
    "dispatch": {
      "dispatched": true,
      "date": "2026-10-21",
      "includeStand": true,
      "courier": "Safexpress",
      "trackingNumber": "18471189815",
      "accessoriesSeparate": true,
      "accessoriesCourier": "Delhivery",
      "accessoriesTracking": "2780 4413 096",
      "accessoriesSentOn": "2026-10-22",
      "accessoriesStatus": "In transit"
    },
    "delivery": { "delivered": false, "date": "" },
    "installation": { "installed": false, "date": "" },
    "groupNo": "G1443",
    "photos": { "ropeBurn": 2, "shoulderPulley": 0, "led": 0, "armEnd": 0 },
    "finalPacking": {
      "machineBolted": true,
      "fastnersBox": true,
      "frontCover": true,
      "finalPacked": true
    },
    "installationPhotos": 0,
    "hasVideo": false
  }
}
```

`GET /machines` returns `{ "ok": true, "machines": [ ...same shape ], "nextPageToken": null }`.

`GET /part-movements` is the append-only part ledger, ordered by `timestamp` then `id`.
Query parameters: `updatedSince` (ISO datetime), `type` (one or more of
`NEW_PART_USED`, `REVIVED_PART_USED`, `SENT_TO_REVIVE`, `REVIVED_TO_STOCK`,
`SCRAPPED`), `limit` (default 200, max 1000), and `pageToken`. Undo does not
delete a row. It appends another row with the same `type`, a negative `qty`,
`reversal: true`, and `reversesId` set to the original id. Sum `qty` per part
and type. Ids are stable, so a client can dedupe if a page is fetched twice.

`GET /parts` is the catalog plus the revived-stock count for each part.
Same `limit`, `updatedSince`, and `pageToken`. Ordered by `code`. `frequency`
is `common`, `occasional`, or `null`.

```
curl -sS \
  -H "X-API-Key: $MACHINES_READ_API_KEY" \
  "$BASE/part-movements?updatedSince=2026-10-01T00:00:00.000Z&type=SENT_TO_REVIVE,REVIVED_TO_STOCK&limit=200"

curl -sS \
  -H "X-API-Key: $MACHINES_READ_API_KEY" \
  "$BASE/parts"
```

`GET /part-movements`:

```json
{
  "ok": true,
  "movements": [
    {
      "id": "3f1c0a2e-7b14-4a2e-9c11-0b5a6d7e8f90",
      "type": "SENT_TO_REVIVE",
      "partCode": "0000018",
      "qty": 1,
      "machineNumber": "X33M047",
      "cycle": 2,
      "timestamp": "2026-10-21T10:15:00.000Z",
      "user": "workshop@example.com",
      "reversal": false,
      "reversesId": null
    }
  ],
  "nextPageToken": null
}
```

`GET /parts`:

```json
{
  "ok": true,
  "parts": [
    {
      "code": "0000044",
      "name": "Slider Spacer",
      "group": "Slider",
      "unit": "pcs",
      "revivable": false,
      "frequency": "occasional",
      "revivedStock": 0,
      "updatedAt": "2026-10-20T00:00:00.000Z"
    },
    {
      "code": "0000056",
      "name": "Hooks (carabiners)",
      "group": "Main Sub",
      "unit": "pcs",
      "revivable": false,
      "frequency": "common",
      "revivedStock": 0,
      "updatedAt": "2026-10-20T00:00:00.000Z"
    }
  ],
  "nextPageToken": null
}
```

A machine that has been returned also includes `cycle`, `refurbished`,
`cycles` (previous customers: dispatch, delivery, installation, warranty,
group number, and the return that closed that cycle), and `return` (the
open or latest intake, with refurb lines). Photo fields are counts only.
There are no URLs or storage paths.

`GET /inventory/machine-stand`:

```json
{ "ok": true, "count": 6, "updatedAt": "2026-05-01T00:00:00.000Z" }
```

Deploy this function yourself (Blaze plan). Do not commit the key.

```
openssl rand -hex 32
firebase functions:secrets:set MACHINES_READ_API_KEY
firebase deploy --only functions
```

`firebase deploy --only functions:machinesApi` deploys just this function
after the secret exists. The placeholder in the curl examples is the shell
variable, not a real key.

## Returns, refurbishment, and the revive queue

A customer can send a machine back. The workshop inspects it, fits replacement
parts, re-runs QC, and sells it to the next customer under the **same
machine number**.

1. **Return** (Admin or Production, on the machine). Enter the return date,
   reason, the group number it came from (prefilled from the current order
   link), the date it was received at the workshop, inspection notes, and
   photos. Saving archives that customer as the next entry in `cycles`
   (cycle 1 is the first customer): dispatch, delivery, installation, the
   order link, and warranty. The active checks are cleared so the machine
   can be tested, packed, and linked to a new order. The previous order is
   unlinked. Status becomes **Returned**.
2. **Refurbish.** Log each replacement: part, qty, whether the fitted part
   was **New** or **Revived**, and whether the part that came off is **Scrap**
   or **Revive queue**. Common parts are quick-pick chips, then occasional
   parts, then a search of the full catalog. Mark the refurb complete with a
   date. Status is **Refurbishing** from the first logged part until that
   date. After that, the normal Testing → Packed → Dispatched → Delivered →
   Installed rules apply to the new cycle. Machines with more than one cycle
   show a **Refurbished** badge.
3. **Revive queue.** Lists parts waiting for an acid dip and recoat. **Revived**
   adds them to that part's revived stock. **Failed** scraps them. Fitting a
   Revived part decrements that stock and is blocked at zero, same as the
   machine stand.
4. **Ledger.** Every one of those actions appends a `partMovements` document
   in the same transaction. Undo appends a reversing row. Rows are not deleted.

Only parts flagged **revivable** can be sent to the revive queue (coated metal:
frame and arm plates, Arm End SM Bend, shoulder plates, Slider SM, the
electronics plate, and covers). Plastic and 3D-printed parts can only be
scrapped. The revive option is hidden for them, and the security rules reject
a revive-queue write for a part that is not revivable. Quantities for `mtr`
parts (braided rope, LED channel) can be decimal. `pcs` quantities are whole
numbers.

`frequency` is `common`, `occasional`, or empty. It only changes the refurb
picker. Common parts are the ones replaced most often (covers, rope end, arm
end, hooks, accessories, arm, shoulder, knobs, caps, braided rope). Occasional
parts are the slider family, the assembled motor, and the assembled controller.
Hooks is displayed as **Hooks (carabiners)**.

The revivable column in the seed file is a **default guess** (30 parts). The
frequency column is also a default. Bhargav should review both on the Parts
page. Admin edits stick: the seed will not overwrite `revivable` or `frequency`
after an admin has changed them unless `--force` is passed.

### Seed the catalog

The file is `scripts/parts-catalog.csv` (112 rows:
`code,name,group,unit,revivable,frequency`). Codes stay strings (`0000044`,
`RM_TAB_MOUNT_SHAFT`).

```
node scripts/seed-parts.mjs
```

That is a dry run. It does not write. When the summary looks right:

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
  node scripts/seed-parts.mjs --commit
```

`--force` overwrites admin-edited revivable and frequency values. Revived
stock is never changed by the seed. A service account with the Cloud
Datastore User role is enough. Do not commit a key.

### Rules

`firestore.rules` covers `parts`, `partMovements`, `reviveQueue`, and
`partCounts`. Admin and Production can write. Sales cannot read them.
Dashboard can read `partCounts` (the revive-queue count) and still cannot
read part rows, movements, or the queue. Publish the rules yourself. This
repo does not deploy them.

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
4. **Orders API key.** Pick a long random string and store it only as a
   secret: `firebase functions:secrets:set ORDERS_API_KEY`. Do not put it in
   `.env`, GitHub, or the sheet.
5. **Machines read API key.** Generate a different key and store it as its
   own secret. The orders key will not authorize these reads.
   `openssl rand -hex 32`, then
   `firebase functions:secrets:set MACHINES_READ_API_KEY`.
6. **Sheets service account.** In Google Cloud (same project, or any project
   you control): APIs & Services → enable **Google Sheets API**. IAM →
   create a service account. Create a JSON key. Share the orders spreadsheet
   with that service account's email as **Editor**. Then
   `firebase functions:secrets:set SHEETS_SERVICE_ACCOUNT` and paste the
   whole JSON when prompted. An empty secret skips the mirror; a bad key is
   logged and not retried forever. Sheets rate limits are retried.
7. **Deploy functions.** `npm install` inside `functions/`, then
   `firebase deploy --only functions`. The predeploy hook bundles
   `functions/lib` (the directory Cloud Functions actually uploads). Note
   both URLs from the deploy output: `api` for the sales bot and
   `machinesApi` for the inventory bot. If a function rejects anonymous
   callers, the deploy used a private invoker: both are declared
   `invoker: "public"` and the API key is what authorizes the caller.
8. **Sales user.** Authentication → Add user (email + password). Have them
   sign in once. As Admin, open Manage Users and set the role to **Sales**.
9. **Import.** Dry-run the script, read the unmatched report, then
   `--commit` if you want Firestore filled from the sheets.
10. **Bots.** Point the sales bot at `POST` and `PATCH` on the `api` URL.
    Point the inventory bot at `GET` on the `machinesApi` URL with
    `MACHINES_READ_API_KEY`. Stop writing new rows to the sheet; QC Track is
    the source of truth and the sheet is the read-only mirror.
11. **Rules again, after this change.** `firebase deploy --only firestore:rules`
    publishes `parts`, `partMovements`, `reviveQueue`, and `partCounts`.
    It does not write documents.
12. **Functions again.** `firebase deploy --only functions:machinesApi` picks
    up `GET /parts`, `GET /part-movements`, and the return fields on machines.
    Still GET-only, still `MACHINES_READ_API_KEY`.
13. **Parts seed.** Dry-run `node scripts/seed-parts.mjs`, then `--commit`
    with a service account. Bhargav should review the 30 revivable defaults
    and the common / occasional frequency flags on the Parts page. Edits
    there are kept on the next seed unless `--force` is used.

`npm test` covers order status, the sheet row, import matching, the orders
HTTP handler, the read-only machines API (auth, filters, status, and no
media URLs), and returns / refurb / the part ledger (including that the
screen status and the API status match). `npm run build` is still the
GitHub Pages build and does not deploy functions.
