# Student Grade Portal (React + Firebase Realtime Database)

* `/` – students sign in with **student number + PIN** and see their grades (same layout as your class record: category weights, every score, final grade, equivalent, remarks).
* `/teacher` – you sign in with email + password, edit scores in a spreadsheet-style grid, import the Excel class record, see/reset PINs, and edit weights and maximum scores.

Stack: React 19, Vite, Firebase Realtime Database + Auth (Spark/free plan), hosted on Vercel.

## 1. Firebase setup (about 10 minutes)

1. https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Realtime Database → Create database**. Pick a location (e.g. Singapore), start in **locked mode**.
3. Open the **Rules** tab, paste the contents of `database.rules.json`, **Publish**.
4. **Build → Authentication → Get started → Email/Password → Enable**. Then **Users → Add user** (your email + password).
5. Copy that user's **User UID**. In Realtime Database → **Data**, add:
   `admins` → child named by your UID → value `true`. (Only you can do this; the app cannot.)
6. **Project settings → General → Your apps → Web (</>)**, register an app, copy the config values.
7. Authentication → Settings → **Authorized domains**: add your Vercel domain after step 2 below.

## 2. Run and deploy

```
cp .env.example .env     # fill in the 5 Firebase values
npm install
npm run dev              # http://localhost:5173  (teacher: /teacher)
```

Vercel: push to GitHub → **Add New Project** → framework Vite (auto) → add the same `VITE_FIREBASE_*` variables (leave `VITE_USE_EMULATOR` unset) → Deploy. `vercel.json` handles `/teacher` routing and security headers.
If sign-in or data loading is blocked after deploy, check the browser console for a Content-Security-Policy message and loosen `connect-src` in `vercel.json`.

## 3. First use

1. Go to `/teacher`, sign in, open **Import**, choose your class record `.xlsx`, review the summary, **Import**.
2. **Students & PINs** → download or print the PIN list and give each student their own PIN privately.
3. Edit scores in **Grades**; each cell saves when you leave it. Students see updates when they open the page or press Refresh.

Before importing, you can check a workbook from the terminal:
`npm run check-workbook -- "Class Record.xlsx"`

## How it protects grades

Students have no accounts. Each record is stored under a secret key derived (PBKDF2) from student number + PIN + a private salt. The rules allow reading **one** record if you know its key and never allow listing, so students cannot browse others' grades. Only the teacher (listed in `admins`) can write.

Things to know:
* **No lockout**: Firebase rules cannot rate-limit guesses. Random 6-character PINs (about 887 million combinations) make guessing impractical, but do not replace them with short or easy PINs.
* PINs are stored in plain text in `roster` (readable only by you) so you can look them up and re-issue them.
* Data Privacy Act (RA 10173): grades are personal data. Keep the Firebase project private, share PINs individually, and delete data when no longer needed.
* Free plan limit: 100 simultaneous database connections. Students connect only briefly (one read, then disconnect), so a class opening the page at once is fine; the teacher view keeps one live connection.

## Tests

* `npm test` – grading, keys, import and rules checks (rules via the `targaryen` simulator).
* `npm run test:rules` – same rules checks against the official Firebase emulator (needs Java 11+ and `npx firebase-tools`).
