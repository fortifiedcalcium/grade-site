# Student Grade Portal (React + Supabase)

* `/` – students sign in with **student number + PIN** and see their grades (same frame as the instructor page: header, tabs, cards and tables).
* `/teacher` – you sign in with email + password, edit scores in a spreadsheet-style grid, import the Excel class record, add and delete students and sections, see/reset PINs, and edit weights and maximum scores.

Stack: React 19, Vite, Supabase (Postgres + Auth + Realtime), hosted on Firebase Hosting.

## 1. Supabase setup (about 10 minutes)

1. https://supabase.com → **New project**. Pick a region near your students and save the database password.
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` and **Run**. This creates the tables, the access rules, and live updates. It is safe to run again.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key (never the `service_role` key).
4. **Authentication → Sign In / Providers → Email**: keep it enabled. While you are the only user you can turn off **Confirm email** to sign in right after registering; otherwise confirm the email Supabase sends.
5. **Authentication → URL Configuration**: set **Site URL** to your site address (for the confirmation email link).

## 2. Move the existing data (only if you used the old Firebase version)

```
npx firebase database:get / > fb-export.json
npm run migrate-data -- fb-export.json
```

Paste `supabase/seed.local.sql` into the SQL Editor and run it (after `schema.sql`). Students keep their PINs. The file has names and PINs, so git ignores it; delete it and `fb-export.json` afterwards.

## 3. Make yourself an instructor

1. Open `/teacher` → **Register** with your email and a password.
2. In the SQL Editor run the statement at the end of `supabase/schema.sql` (it looks up your email), or the one the "No access yet" screen shows with your user id.
3. Reload `/teacher` and sign in. You sign in again on every new visit; closing the tab signs you out.

## 4. Run and deploy

```
cp .env.example .env     # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173  (teacher: /teacher)
npm run deploy           # builds and publishes to Firebase Hosting
```

The keys are read when the site is built, so run `npm run deploy` from a machine that has the `.env` file.

## 5. First use

1. Go to `/teacher`, sign in, open **Import**, choose your class record `.xlsx`, review the summary, **Import**.
2. **Students & PINs** → download or print the PIN list and give each student their own PIN privately.
3. Edit scores in **Grades**; each cell saves when you leave it. Students see updates when they open the page or press Refresh.
4. **Settings** adds and deletes sections, categories and score items. **Grades** and **Students & PINs** add and delete students.

Before importing, you can check a workbook from the terminal:
`npm run check-workbook -- "Class Record.xlsx"`

## How it protects grades

Students have no accounts. Each record is stored under a secret key derived (PBKDF2) from student number + PIN + a private salt. Row level security gives students no access to the `records` table at all; the only door is the `get_record(key)` function, which returns **one** record for a key and never lists. Only accounts in `public.admins` can write, and the app cannot add to that table.

Things to know:
* **No lockout**: guesses are not rate-limited. Random 6-character PINs (about 887 million combinations) make guessing impractical, but do not replace them with short or easy PINs.
* PINs are stored in plain text in `roster` (readable only by instructors) so you can look them up and re-issue them.
* Data Privacy Act (RA 10173): grades are personal data. Keep the Supabase project private, share PINs individually, and delete data when no longer needed.
* Students use plain HTTPS requests, so there is no cap on how many can open the page at once. Free Supabase projects pause after a week without activity; open the dashboard to resume.

## Tests

`npm test` – grading, keys, import, the sign-in screen, the Supabase data layer, and **the database rules**: `supabase/schema.sql` is run in an in-process Postgres (PGlite) and checked for who can read and write what.
