# MathSprint

AI-powered math practice for high school and college students with timed learning. Students create a practice deck with Claude, practice one question at a time against the clock, and get results that cover both accuracy and pace.

This is MVP 1: the six core screens (Dashboard, AI Deck Creator, Deck Review, Practice Setup, Timed Practice, Results & Solutions) on Firebase.

## How it fits together

```text
React + TypeScript (Vite, Tailwind)  ── Firebase Hosting
        │
        ├── Firebase Auth            Google or email sign-in
        ├── Cloud Firestore          decks, questions, practice sessions
        └── Cloud Functions (Python)
              generate_deck          Claude writes the deck → SymPy checks every answer
                                     → Claude rewrites anything that failed (2 rounds) → saved
              explain_step           "I don't understand this": Claude re-explains a step
              get_account            the student's plan, usage and status
              admin_list_accounts    admin only: every sign-in with plan, usage, status, access code
              admin_update_account   admin only: change plan, suspend/reactivate, set access code, reset count
              admin_delete_account   admin only: delete a sign-in with its decks, sessions and settings
              request_upgrade        a student asks for a bigger plan, with an optional note
              list_upgrade_requests  the student's own requests, or every request for the admin
              admin_reply_upgrade    admin only: reply to a request, optionally upgrading the plan
              reply_upgrade          a student writes back on one of their requests
              record_activity        one heartbeat per active minute, for time on site
              create_invite          a student invites a friend's email and gets a link to share
              list_invites           the student's invites and who has joined
              list_groups, save_group, delete_group   Pro and Pro Max: contact groups of emails
              assign_test            Pro and Pro Max: a deck for a group, one link and access code per member
              create_class_test      Pro and Pro Max: one class link for a deck; students sign in with Google
              open_class_test, submit_class_test   a student's one try on a class link, graded on the server
              list_tests, get_test_results, reset_test_link, delete_test   the owner's tests and results
              open_test, submit_test no sign-in: a member opens their test with link + code, graded here
              create_challenge, open_challenge, submit_challenge, claim_challenge, list_challenges   head-to-head challenges
              delete_deck            the owner deletes a deck, its questions and its practice history
              report_problem, list_reports, reply_report, admin_reply_report   problem reports to the admin
              admin_offer_promotion, admin_end_promotion, respond_promotion    time-limited plan promotions
```

### Accounts and plans

The admin is `prasad.writes@gmail.com` (only when Firebase has verified the email, which Google sign-in always does). The admin opens **Accounts** from the top bar to see every account, change its plan, give it its own access code, reset its deck count, suspend it, or delete it. Deleting asks the admin to type the account's email first, then removes the sign-in, decks, practice history and access code for good.

| Plan | Decks | Questions per deck |
| --- | --- | --- |
| Free (default) | 5 | 20 |
| Pro | 50 | 120 |
| Pro Max | 100 | 200 |

Everything is enforced server-side. `generate_deck` checks the plan and takes one deck from it in a Firestore transaction before calling Claude, and gives it back if generation fails. Decks count when created, so deleting one doesn't free a slot (the admin can reset the count). Students delete a deck from its card or page after confirming; `delete_deck` removes its questions and practice sessions, and tests already assigned from it keep their own copy. The admin account has no limits and needs no access code.

Everyone's first 5 decks need no access code (`CODE_FREE_DECKS` in `functions/accounts.py`), so Free accounts never need one. From the sixth deck on, an account's own access code replaces the shared `DECK_ACCESS_CODE` for that person; accounts without one keep using the shared code. Suspending an account disables its sign-in, revokes its open sessions, and makes Firestore rules refuse its reads and writes until it is reactivated.

### Upgrade requests

Students ask for a bigger plan from **Request an upgrade** in the profile menu (or the link on Create deck). They can have one request waiting at a time. When the admin signs in, the home page shows how many requests are waiting and the **Accounts** link carries a count. On the Accounts page the admin can **Upgrade and reply** (changes the plan) or **Reply without upgrading**. The student then sees a dot on their avatar and a banner on the home page, and reads the reply on the Upgrade page. Each request is a conversation: either side can keep writing back, and a student's message puts the request back in the admin's waiting count. On the Accounts page each request's messages stay folded until the admin opens them, and the admin can delete one message or the whole request (`admin_delete_upgrade`, with a confirm step); deleting removes it for the student too and never changes a plan already approved. Requests live in `upgradeRequests/{id}`, which only the Cloud Functions can read or write.

### Invites

Students invite friends from **Invite friends** in the top bar. Each invite is a unique link (`/?invite=TOKEN&email=...`) they can copy or email. When a friend signs up with that email after the invite was made, the inviter gets one bonus deck: it raises both their plan's deck limit and their code-free decks by one. Friends who already had an account don't count, and each email can earn one inviter one deck. Invites live in `invites/{token}`, which only the Cloud Functions can read or write.

### Sharing decks

On Pro and Pro Max (and for the admin), a deck's page has **Share this deck**: the owner enters the email another person signs in with, and the deck shows up in that person's decks to practice (their sessions and stats are their own). If no account uses the email, the owner gets an error and a link to invite them. Shared decks cost no generation, so they don't count toward the recipient's plan or need an access code, and anyone on any plan can receive one. Free owners see an upgrade note instead (checked in `share_deck` with the plan in effect, so a promotion counts); an owner whose Pro ends keeps their existing shares and can still stop them, but can't add new ones. Only the owner can share, assign or delete a deck; up to 50 people per deck. The owner can **Stop sharing** with anyone, and a recipient can **Remove** a shared deck from their decks; either way that person's practice history for it goes too, and deleting the deck removes everyone's. `share_deck`, `list_deck_shares` and `unshare_deck` do the writes; the deck's `sharedWith` uids are what the Firestore rules check, and emails live in `decks/{id}/shares/{uid}`, which only functions read.

### Head-to-head challenges

After any finished session, **Challenge a friend** on the results page makes a link (`/c/TOKEN`) with a line to share, such as "I got 16/20 in 7:10 on SAT Geometry. Beat me!". `create_challenge` grades the session again on the server, because the browser wrote its score, and copies its questions into `challenges/{token}/questions`; asking again for the same session returns the same link. A friend opens the link with no account, types a name, and plays the same questions under the same time limit (`open_challenge`, `submit_challenge`; graded on the server like group tests). The higher score wins and the faster time breaks a tie. The friend then sees both results side by side and question by question, with worked solutions. **Sign up** remembers the attempt on that device, and `claim_challenge` saves it to the new account once they're signed in. The home page's **Challenges** section lists the challenges you sent with every friend's result, and the ones you played and saved. Each link takes up to 200 players. Everything lives in `challenges` and `challengeAttempts`, which only the Cloud Functions can read or write.

**Sharing.** The challenge panel and the friend's result both have Facebook, Instagram, WhatsApp, X and Copy buttons. Hosting sends `/c/**` to the `challenge_page` function, which serves the app's `index.html` with this challenge's title, description and preview picture, so a link posted on Facebook, X, WhatsApp or iMessage shows the score card. `/c/TOKEN/card.png` is that card, drawn with Pillow (`functions/cards.py`): 1200x630 for link previews, or `?size=story` for a 1080x1920 Instagram story. A friend's result has its own public `shareId` (`?r=...`), so sharing it never exposes their attempt token. Instagram has no web share link, so on a phone the Instagram button hands the story picture to the share sheet, and on a computer it downloads it; either way the link is copied for a Link sticker. If the function can't load `index.html` from Hosting, it sends the visitor to `/play/TOKEN`, the same page without the preview.

### Groups and group tests

Pro and Pro Max accounts (and the admin) get **Groups** in the top bar. A teacher creates a group such as "8th Grade" and adds, edits or removes any number of emails (paste many at once, one per line or comma separated). On a deck's page, **Assign to a group** picks a group and a time limit (or none). Every member gets their own link (`/t/TOKEN`) and a 6-character access code; the teacher copies or emails each one, or copies everyone's at once. Members don't need an account: they open the link, enter the code, and the clock starts. Answers are graded by `submit_test` on the server, so the answer key never reaches their browser, and they see only their own result with worked solutions. The teacher's results page shows how many finished, the average score and time, how often each question was answered correctly, and each member's answers. Ten wrong codes lock a link until the teacher gives it a **New code**. Assigning the same deck to the same group again adds links for people added to the group since. The test keeps its own copy of the questions, so deleting the deck or the group doesn't break it. All of this lives in `groups`, `tests/{id}/questions` and `testTakers/{token}`, which only the Cloud Functions can read or write; the plan check is in `functions/groups.py`.

**One class link** is the other choice on the same panel, for a class that signs in with Google (for example Google Classroom school accounts). The teacher gets a single link (`/class/TOKEN`) to post anywhere, with an optional class name and an optional school domain such as `lincolnhigh.org` that turns away every other account. A student must sign in with Google; `open_class_test` reads their name and email from the Google sign-in (never from what the browser says), and each account gets one try, stored as `testTakers/class_{testId}_{uid}`. The results page lists students by their Google name and email, and the teacher can close the link to new students. Hosting needs no rewrite for `/class/`; the Google provider must be on in Firebase Auth, with the site's domains under Authorized domains.

The member's test page also measures how long each question is on screen (only while the tab is visible), how often each question is opened, and how often an answer is changed after it was first given. `submit_test` stores these as `times`, `visits` and `changes`; since a browser can't be trusted, the times are scaled down to fit the time the server saw the member take. **See their result** on the results page opens `/tests/TEST/m/TOKEN`, one member's page: score, place among finishers, right, wrong and skipped, total time and time per question against the group's average, accuracy by topic, and every answer, with a summary to copy or email to them. The results page adds the median, best and lowest scores, median time, late finishes, a score spread, the hardest and easiest questions with each question's average time, accuracy by topic, and sorting members by score. The statistics are worked out in `web/src/lib/testStats.ts`. Members who finished before this was added have no per-question times.

### Plan comparison

`/plans` compares Free, Pro and Pro Max and opens with or without signing in (from the sign-in page, the profile menu and the Upgrade page). Deck and question limits come from `PLANS` in `web/src/lib/types.ts`, which mirrors the server.

### Problem reports

Signed-in users pick **Report a problem** in the profile menu, which records the page they came from. The admin sees waiting reports on the home page, as a count on **Accounts**, and in **Problem reports** on the Accounts page, where they can reply or mark a report resolved. Either side can keep writing back; a user's message reopens it. Reports live in `reports/{id}`, functions only.

### Promotions

On the Accounts page the admin can **Offer a promotion**: a bigger plan for 1, 2, 3, 6 or 12 months, with an optional note. The user sees the offer on their home page and accepts or declines it. Accepting stores `promo {plan, startedAt, endsAt}` on the account; the term runs in calendar months from that moment. `plan_id()` in `functions/accounts.py` uses the promotion's plan only while it lasts, so the account is back on its own plan the moment the term ends, with nothing scheduled to switch it. Changing someone's plan during a promotion changes the plan they return to. The admin can withdraw an offer or end a promotion early. Offers live in `promotions/{id}`, functions only.

### Payments

The Upgrade page shows Square's **Pay now** button for Pro and Pro Max. Each press asks `create_checkout` for a Square payment link made for that student and plan (Square API, the seller's main location), and saves the link's order id in `squareCheckouts`. Square brings the student back to `/upgrade?paid=PLAN`, which waits for the plan to switch.

When the payment completes, Square calls `square_webhook` (Hosting sends `https://mathsprint.org/square/webhook` there). It checks Square's signature, finds the checkout by order id, checks the amount, and sets the account's plan once, however many times Square sends the event. The student's waiting upgrade request is marked **Paid** with a note (or a new one is added), so the payment shows on their Upgrade page and on the admin's requests list. A paid plan lasts until the admin changes it, the same as an approved request. Refunds don't change the plan by themselves; lower it on the Accounts page. Requests still work for anyone who paid another way.

Prices are in cents in `SQUARE_PRO_PRICE_CENTS` and `SQUARE_PROMAX_PRICE_CENTS` (the first deploy asks for them and saves them in `functions/.env.<project>`). Set `SQUARE_ENVIRONMENT=sandbox` there, with sandbox keys, to test with Square's test cards.

### Claude credit

The admin's profile menu shows about how much Anthropic API credit is left. The API has no endpoint for a prepaid balance, so this is an estimate: the admin types in the balance from the Anthropic console (Settings > Billing), every Claude call made by `generate_deck` and `explain_step` adds its cost from the response's token counts (`functions/credit.py`, at list prices), and the menu shows the balance minus what was spent since. Spending outside this app with the same key or account isn't counted, so re-enter the balance after topping up, or now and then to correct drift. Stored in `settings/claudeCredit`, which only the functions read and write.

### Time on site

While someone has MathSprint open in a visible tab and has touched the page in the last 5 minutes, the app sends one heartbeat a minute to `record_activity`. Each heartbeat adds a minute to the account (extra beats inside the same minute, such as from a second tab, add nothing). The Accounts page shows each person's total time, the last 7 days, today, and when they were last active, and can sort by time. Days are UTC, and daily totals older than 35 days are dropped; the all-time total is kept.

Decks over 20 questions are written in parts of 20 that run in parallel (`functions/generator.py`), so a 200-question deck stays inside Claude's output limit and the function timeout.

### Answer checking

Claude returns each question as structured JSON (prompt, answer, solution steps, concept) plus a `check`: the same problem restated in SymPy syntax. `functions/validator.py` solves or evaluates that check itself and compares the result with Claude's answer. Mismatches go back to Claude with the reason; anything still wrong after two repair rounds is left out of the deck. Expressions are parsed against a strict allow-list before SymPy sees them.

### Subjects

Every deck has a subject, Math by default; decks made before subjects existed count as Math. The admin adds and removes subjects on the Accounts page or from "Edit subjects" on the create page (stored in `settings/subjects`; a starter list of Math, Physics, Chemistry, Biology and General Knowledge applies until the admin first saves). The create page, including PDF decks, has a subject picker, and the dashboard filters decks by subject or shows All. Share text, link previews and cards use the deck's subject ("Calling all Biology fans", "Can you answer this?") instead of saying math.

SymPy can't solve a biology or history question, so other subjects are checked differently (`functions/generator.py`): questions are mostly multiple choice, and a second Claude call answers each one without seeing the key. A question it answers differently, or finds unclear or wrong, goes back for repair like a failed SymPy check. Calculation questions in those subjects (physics, chemistry) still carry a SymPy check.

### Timed practice

The signature screen (`web/src/pages/Practice.tsx`, logic in `web/src/lib/pace.ts`):

- The background tints from calm blue to a muted red as time runs out, in the bands from the design plan (75%, 50%, 25%, 10%). It is a wash with stronger edges, never a solid red screen.
- A target marker moves along the progress bar: `expected question = elapsed / total × questions`. The pace chip compares it with questions finished ("On pace", "Slightly behind", ...).
- Each question shows its own time against the target per-question time.
- Answers save to Firestore as you type (and to local storage), and every question's start and submit time is recorded, so a refresh resumes exactly where the student was.

Practice has three modes, chosen on the setup screen: **Learn** (no clock; time per question is still recorded), **Practice** (the student's own limit, with quick picks of 10/15/20/30 minutes) and **Challenge** (one minute per question). Students can take the first N, a random N, the questions they haven't practiced yet, or the ones they got wrong last time.

Results show score, the timing verdict, time per question against the target, the concept that took longest, and every question with its worked solution and the "I don't understand this" explainer. From there the student can retry just the questions they missed, or build a new deck on their weakest concept.

The dashboard adds overall progress (questions, accuracy, time, average pace against target) and a "Practice next" list of the weakest concepts across sessions (`web/src/lib/insights.ts`), which can be turned into a new deck in one click.

### Data model

| Collection | Fields |
| --- | --- |
| `decks/{id}` | ownerId, title, subject (absent means Math), topic, level, difficulty, topics, questionCount, source, createdAt, sharedWith[uid], sharedBy |
| `decks/{id}/shares/{uid}` | email, name, sharedAt. Read and written only by functions |
| `decks/{id}/questions/{id}` | order, prompt, math, type (numeric/choice), choices, answerValues, answerChoice, answerDisplay, tolerance, concept, difficulty, steps[{description, expression}], check, verified |
| `accounts/{uid}` | email, displayName, plan (free/pro/promax), status (active/suspended), decksCreated, createdAt. Written only by functions |
| `accessCodes/{uid}` | code. Read and written only by functions |
| `settings/subjects` | names[]. Read by anyone signed in, written only by the admin |
| `sessions/{id}` | ownerId, deckId, deckTitle, mode (learn/practice/challenge), questionIds, timeLimitSec (0 in learn mode), startedAtMs, currentIndex, answers{i}, timings{i: {startedAt, answeredAt}} (ms from start), status, endReason, usedSec, score, accuracy, results{i}, conceptStats{concept: {attempted, correct, seconds}} |

Security rules (`firestore.rules`) keep every deck and session private to its owner (a deck is also readable by the people it was shared with), make finished sessions read-only, only let the app write sample decks (AI decks come from the function), and lock out suspended accounts.

## Setup

You need Node 20+, Python 3.12, the Firebase CLI (`npm i -g firebase-tools`), a Firebase project on the Blaze plan (Cloud Functions needs it), and an Anthropic API key.

1. Put your project ID in `.firebaserc`.
2. In the Firebase console, enable **Authentication** (Google and Email/Password providers) and create a **Firestore** database.
3. Copy `web/.env.example` to `web/.env.local` and fill in the web app config from Project settings.
4. Store the Claude key as a secret: `firebase functions:secrets:set ANTHROPIC_API_KEY`
   Then set the access code people must enter to build decks after their first 5: `firebase functions:secrets:set DECK_ACCESS_CODE`. Change it any time by running the same command and redeploying the functions.
   For Square payments: in the [Square Developer Dashboard](https://developer.squareup.com/apps), open your app's **Production** credentials and run `firebase functions:secrets:set SQUARE_ACCESS_TOKEN` with the access token. Then under **Webhooks > Subscriptions**, add a subscription with the URL `https://mathsprint.org/square/webhook` and the events `payment.created` and `payment.updated`, and run `firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY` with its signature key.
5. Install:
   ```bash
   npm --prefix web install
   python3.12 -m venv functions/venv && functions/venv/bin/pip install -r functions/requirements.txt
   ```
6. Deploy: `firebase deploy`

### Run locally with the emulators

```bash
printf "ANTHROPIC_API_KEY=sk-ant-...\nDECK_ACCESS_CODE=local-code\n" > functions/.secret.local   # only needed for deck generation
firebase emulators:start --project demo-mathsprint
# in another terminal, with VITE_USE_EMULATORS=true in web/.env.local
npm --prefix web run dev
```

New accounts can add a ready-made quadratics deck from the dashboard, so the practice flow works without an API key.

### Tests

```bash
npm --prefix web test                                   # grading, pace and timing feedback
cd functions && venv/bin/python -m pytest tests          # SymPy checks and the repair loop
```

## Not in MVP 1 yet

From the design plan's Version 2 and 3: editing questions in a deck, adaptive difficulty, and per-topic progress charts over time.
