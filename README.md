# Ward Round

A quarantine centre ward app with nurse and doctor rounds, discharges, beds and a quality dashboard.
It runs on Vercel's free Hobby plan with a free Neon Postgres database. No card is needed for either, and neither plan bills you if it goes over its limits.

## Demo sign-in

| Role | PIN |
| --- | --- |
| Nurse | 1111 |
| Doctor | 2222 |
| Admin | 3333 |
| Head doctor | 4444 |

After you sign in, the role buttons at the top switch accounts.

## Deploy for free (about 10 minutes)

1. **Put the code on GitHub.** Create a free account at github.com and make a new repository named `ward-round`. On the repository page, choose "uploading an existing file" and drag in everything inside this folder (the `api`, `lib`, `public` and `dev` folders plus the files at the top level). Then commit.
2. **Import it into Vercel.** Sign up free at vercel.com with "Continue with GitHub" and choose the Hobby plan. Click Add New → Project, pick `ward-round`, leave every setting as it is, and click Deploy. The first deploy shows a "database is not connected" message until you finish step 3.
3. **Add the free database.** In the Vercel project, open Storage → Create Database → Neon, and choose the Free plan. Pick the region closest to Washington, D.C. (AWS US East 1), because Vercel runs the server code there by default. Then connect the database to the project. Vercel adds the `DATABASE_URL` setting for you.
4. **Redeploy.** Open Deployments, click the three dots on the latest one, and choose Redeploy.
5. **Check it.** Open the link in a private window. The first load takes a few seconds while the database wakes up and creates the example ward. Sign in as Nurse with PIN 1111.

Optional: under Settings → Environment Variables, add `SESSION_SECRET` set to any long random text, then redeploy. Without it, sessions are signed with a key derived from the database address, which also works.

## How it is built

| Part | What it does |
| --- | --- |
| `public/index.html` | The screens. It shows the ward and sends every change to the server. |
| `public/rules.js` | The rule engine (fever-free days, eligibility, forecasts, statistics). The browser uses it for display and the server uses the same file for enforcement. |
| `api/login.js` | PIN sign-in, which locks the account for 5 minutes after 5 wrong PINs. It returns a signed session that expires after 10 minutes without activity. |
| `api/state.js` | Returns the ward. Screens poll it every 10 seconds, so changes from other devices appear on their own. |
| `api/action.js` | The only way to change data. It checks the role and every rule on the server inside a database transaction. |
| `lib/schema.js` | The tables. These are created on the first request, with constraints so that two patients can never share a bed. |
| `lib/seed.js` | The example ward and the demo accounts. |
| `dev/server.mjs` | Local testing only, with an in-memory Postgres. Run `npm install` then `npm run dev`. It is not deployed. |

## Free-plan limits worth knowing

- **Neon Free:** 1 GB of storage and 100 compute hours a month. The database sleeps after 5 minutes idle and wakes on the next request, which adds about a second.
- **Vercel Hobby:** 1,000,000 function calls a month and personal, non-commercial use only. If a limit is reached, the feature pauses; you are never charged.
