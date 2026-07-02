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

## Access control (Admin / Production / Installation / Dashboard)

The app now requires sign-in, with four roles that see different things:

- **Admin** — full access to everything, including Manage Users and the
  global Maintenance page.
- **Production** — Machines list, Add Machine, Stand Inventory,
  Notifications, and (inside a machine) Resistance, Temperature, Photos,
  Packing Checklist, Final Packing, and Dispatch.
- **Installation** — a filtered Machines list (machines ready for them, plus
  ones they've already installed) and, inside a machine, only the Delivery
  and Installation tabs. Installation photos automatically capture GPS
  coordinates (the browser will prompt for location permission).
- **Dashboard** — the numbers-only Dashboard page and nothing else.

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
console (Firestore → Rules, and Storage → Rules) and publish both.
