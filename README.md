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

### Ops write API (dispatch and installation)

A third HTTPS function, `opsApi`, updates a machine after it leaves the
factory. It has its own secret, `OPS_WRITE_API_KEY`. The orders key and the
machines read key are not accepted. This function does not receive those
secrets, and the handler compares the presented key only with
`OPS_WRITE_API_KEY` (the same constant-time `X-API-Key` / `Authorization:
Bearer` check as the other APIs).

```
X-API-Key: <OPS_WRITE_API_KEY>
```

The base URL is printed at deploy (`Function URL (opsApi)`):

```
https://<region>-<project-id>.cloudfunctions.net/opsApi
```

A `/v1` prefix is optional. A machine is addressed by its machine number
(`X34M005`) or by a group number (`G1435`). A group number is resolved from
the order's machine link first (`machineId`, then `machineNumber`), then
from `machine.groupNumber`. If more than one machine shares the group and
the order does not point at one of them, the call is `409`. Encode a `/` in
a group number (`G338%2F9`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/groups/<groupNumber>` | Machine number and current status. |
| POST | `/v1/machines/<machineNumber>/dispatch` | Mark dispatched. |
| POST | `/v1/groups/<groupNumber>/dispatch` | Same, by group number. |
| POST | `/v1/machines/<machineNumber>/installation` | Mark installed. |
| POST | `/v1/groups/<groupNumber>/installation` | Same, by group number. |
| POST | `/v1/machines/<machineNumber>/installation/photos` | Add one installation photo. |
| POST | `/v1/groups/<groupNumber>/installation/photos` | Same, by group number. |

Every other method is `405`. There is no delete, and no way to edit
assembly, QC, packing, or delivery. A linked order's `fulfillmentStatus`
is refreshed when the computed status changes. The sheet mirror runs from
the existing machine trigger. `updatedBy` on the machine, and
`sectionMeta` for the section that was saved, is `ops-api`.

Each successful change also appends one `auditLog` document in the same
batch as the machine update (the same transaction, for a photo). That is
the collection the Audit Log page reads. The row's user is `ops-bot`. It
stores the machine number, the group number, the section, the action, and
a server timestamp. The action includes the previous and new status, plus
the previous and new courier, tracking number, tracking link, and date for
dispatch; the previous and new date for installation; and the file name
and SHA-256 for each new photo. An identical retry (`"unchanged": true` or
`"duplicate": true`) does not add a row, and neither does a rejected call
(`401`, `400`, `409`, `413`, or `405`).

Dates are `YYYY-MM-DD`. When a date is omitted and the section does not
already have one, it defaults to **today in IST** (`Asia/Kolkata`). Sending
the same dispatch tracking again does not write and does not move
`sectionMeta.dispatch.updatedAt` (that timestamp is what the app treats as
when the machine became Dispatched). The same rule applies to installation.

Mark dispatched. `courier` is free text (`DP World`, `Delhivery`,
`Allcargo`, …). `shipper` is an alias. Send a tracking number, an
`http`/`https` tracking link, or both. `trackingUrl` is an alias for
`trackingLink`. The call sets `dispatch.dispatched`, the date, the courier,
and the tracking fields, and leaves stand, accessories, and the comment as
they were. A link with no number is also stored in the tracking-number
field so the Dispatch tab and the sheet still show it.

```
POST /v1/groups/G1435/dispatch
X-API-Key: $OPS_WRITE_API_KEY
Content-Type: application/json

{
  "courier": "DP World",
  "trackingNumber": "DP9981",
  "trackingLink": "https://track.example/DP9981"
}
```

```
200
{
  "ok": true,
  "unchanged": false,
  "machineNumber": "X34M005",
  "machineId": "m1",
  "groupNumber": "G1435",
  "status": "Dispatched",
  "updatedBy": "ops-api",
  "dispatch": {
    "dispatched": true,
    "date": "2026-10-26",
    "courier": "DP World",
    "trackingNumber": "DP9981",
    "trackingLink": "https://track.example/DP9981"
  }
}
```

The same body again returns `"unchanged": true` and does not write.

Mark installed. The machine must already be dispatched or delivered, otherwise
the response is `409` and names the current status. `notes` and `installer`
are optional. `installer` is stored as `installation.installedBy` (the
Installation tab shows it). `notes` is stored on `installation.notes` and
shown on that tab. Photos and video already on the machine are kept.

```
POST /v1/machines/X34M005/installation
X-API-Key: $OPS_WRITE_API_KEY
Content-Type: application/json

{ "date": "2026-10-26", "installer": "Ravi", "notes": "Lobby install" }
```

Installation photos are **one image per request**, JSON, not multipart.
Cloud Functions parses a JSON body directly, and one base64 image stays
inside the request size limit. Fields: `filename`, `contentType`, `data`
(raw base64 or a `data:image/...;base64,...` URL), and optional `id` (a
retry key). JPEG, PNG, WebP, or GIF, at most **8 MB** decoded. The type is
taken from the file bytes. The file is stored at
`machines/<machineId>/installation/<timestamp>-<filename>`, the same prefix
the app uses, and appended into the first empty slot of
`installation.photos` (the tab shows four). A repeat of the same bytes
(SHA-256) or the same `id` returns the existing photo with `"duplicate": true`
and does not add a second row. A fifth photo is `409`.

```
POST /v1/machines/X34M005/installation/photos
X-API-Key: $OPS_WRITE_API_KEY
Content-Type: application/json

{
  "filename": "lobby.jpg",
  "contentType": "image/jpeg",
  "id": "job-42",
  "data": "<base64>"
}
```

`201` is a new photo. `200` with `"duplicate": true` is a retry. The
response includes `photo.url`, `photo.path`, `photo.contentHash`, and
`photo.clientId`.

Lookup:

```
GET /v1/groups/G1435
X-API-Key: $OPS_WRITE_API_KEY
```

```
200
{ "ok": true, "groupNumber": "G1435", "machineNumber": "X34M005", "machineId": "m1", "status": "Packed" }
```

No Firestore or Storage rules change is required. The function uses the
Admin SDK, which bypasses the client rules. The app's signed-in users still
read and write `machines/{machineId}/...` in Storage the same way as before.

Generate a key that is different from the other two, store it only as a
secret, and deploy this function:

```
openssl rand -hex 32
firebase functions:secrets:set OPS_WRITE_API_KEY
firebase deploy --only functions:opsApi
```

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

`GET /machines` query parameters:

- `updatedSince` — ISO datetime. Keeps machines whose `updatedAt` is at or after that instant.
- `status` — one status or several separated by commas. Applied after the status is computed. The values are the same strings the app shows: `Assembly stage`, `Testing`, `Packed`, `Dispatched`, `Delivered`, `Installed`. `Assembly` is accepted as an alias for `Assembly stage`.
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
   `firebase functions:secrets:set MACHINES_READ_API_KEY`. The ops write key
   is a third secret. In **Ops write API**, run
   `firebase functions:secrets:set OPS_WRITE_API_KEY`.
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
   the URLs from the deploy output: `api` for the sales bot, `machinesApi`
   for the inventory bot, and `opsApi` for dispatch and installation writes.
   To deploy only the ops function after its secret exists:
   `firebase deploy --only functions:opsApi`. If a function rejects anonymous
   callers, the deploy used a private invoker: all three are declared
   `invoker: "public"` and the API key is what authorizes the caller.
8. **Sales user.** Authentication → Add user (email + password). Have them
   sign in once. As Admin, open Manage Users and set the role to **Sales**.
9. **Import.** Dry-run the script, read the unmatched report, then
   `--commit` if you want Firestore filled from the sheets.
10. **Bots.** Point the sales bot at `POST` and `PATCH` on the `api` URL.
    Point the inventory bot at `GET` on the `machinesApi` URL with
    `MACHINES_READ_API_KEY`. Stop writing new rows to the sheet; QC Track is
    the source of truth and the sheet is the read-only mirror.

`npm test` covers order status, the sheet row, import matching, the orders
HTTP handler, the read-only machines API (auth, filters, status, and
no media URLs), and the ops write API. `npm run build` is still the GitHub
Pages build and does not deploy functions.
