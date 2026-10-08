# MathSprint

AI-powered maths practice with timed learning. Students create a practice deck with Claude, practise one question at a time against the clock, and get results that cover both accuracy and pace.

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
```

### Answer checking

Claude returns each question as structured JSON (prompt, answer, solution steps, concept) plus a `check`: the same problem restated in SymPy syntax. `functions/validator.py` solves or evaluates that check itself and compares the result with Claude's answer. Mismatches go back to Claude with the reason; anything still wrong after two repair rounds is left out of the deck. Expressions are parsed against a strict allow-list before SymPy sees them.

### Timed practice

The signature screen (`web/src/pages/Practice.tsx`, logic in `web/src/lib/pace.ts`):

- The background tints from calm blue to a muted red as time runs out, in the bands from the design plan (75%, 50%, 25%, 10%). It is a wash with stronger edges, never a solid red screen.
- A target marker moves along the progress bar: `expected question = elapsed / total × questions`. The pace chip compares it with questions finished ("On pace", "Slightly behind", ...).
- Each question shows its own time against the target per-question time.
- Answers save to Firestore as you type (and to local storage), and every question's start and submit time is recorded, so a refresh resumes exactly where the student was.

Practice has three modes, chosen on the setup screen: **Learn** (no clock; time per question is still recorded), **Practise** (the student's own limit, with quick picks of 10/15/20/30 minutes) and **Challenge** (one minute per question). Students can take the first N, a random N, the questions they haven't practised yet, or the ones they got wrong last time.

Results show score, the timing verdict, time per question against the target, the concept that took longest, and every question with its worked solution and the "I don't understand this" explainer. From there the student can retry just the questions they missed, or build a new deck on their weakest concept.

The dashboard adds overall progress (questions, accuracy, time, average pace against target) and a "Practise next" list of the weakest concepts across sessions (`web/src/lib/insights.ts`), which can be turned into a new deck in one click.

### Data model

| Collection | Fields |
| --- | --- |
| `decks/{id}` | ownerId, title, topic, level, difficulty, topics, questionCount, source, createdAt |
| `decks/{id}/questions/{id}` | order, prompt, math, type (numeric/choice), choices, answerValues, answerChoice, answerDisplay, tolerance, concept, difficulty, steps[{description, expression}], check, verified |
| `sessions/{id}` | ownerId, deckId, deckTitle, mode (learn/practice/challenge), questionIds, timeLimitSec (0 in learn mode), startedAtMs, currentIndex, answers{i}, timings{i: {startedAt, answeredAt}} (ms from start), status, endReason, usedSec, score, accuracy, results{i}, conceptStats{concept: {attempted, correct, seconds}} |

Security rules (`firestore.rules`) keep every deck and session private to its owner and make finished sessions read-only.

## Setup

You need Node 20+, Python 3.12, the Firebase CLI (`npm i -g firebase-tools`), a Firebase project on the Blaze plan (Cloud Functions needs it), and an Anthropic API key.

1. Put your project ID in `.firebaserc`.
2. In the Firebase console, enable **Authentication** (Google and Email/Password providers) and create a **Firestore** database.
3. Copy `web/.env.example` to `web/.env.local` and fill in the web app config from Project settings.
4. Store the Claude key as a secret: `firebase functions:secrets:set ANTHROPIC_API_KEY`
5. Install:
   ```bash
   npm --prefix web install
   python3.12 -m venv functions/venv && functions/venv/bin/pip install -r functions/requirements.txt
   ```
6. Deploy: `firebase deploy`

### Run locally with the emulators

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > functions/.secret.local   # only needed for deck generation
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
