# Daily English

A single-page English practice tool: one short story, three 60-minute channels — **Listening**, **Reading**, and **Speaking** — all built around the same story so vocabulary reinforces itself across all three skills.

Live site: https://artharn.github.io/daily-english/

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup only. Links `style.css`, loads `app.js`. |
| `style.css` | All styling — Material Design 3 tokens (color roles, type scale, shape scale, elevation). |
| `app.js` | All app logic, wrapped in a single `App` namespace (see below). |
| `test_suite.js` | Automated functional tests. Run this before pushing any change to `app.js`. |

No build step, no bundler, no `node_modules` needed to run the site itself — `index.html` just needs `style.css` and `app.js` sitting next to it. `test_suite.js` is a dev-only tool and needs Node + jsdom to run (not needed by the live site).

## How a story is chosen

Each time someone taps **Ready**, `generateSession()` tries three sources in order, falling back automatically:

1. **Mock API** — `https://private-13f363-dailyenglish.apiary-mock.com/story{1-100}`. A random unused story ID is picked; IDs already shown are remembered in the browser's persistent storage (`usedStoryIds`) so nothing repeats until all 100 have been seen, at which point the tracker resets.
2. **AI generation** — if the API call fails, Claude generates a fresh story on the spot (only works when this page is embedded as a Claude.ai artifact, since that's the only context with API access — it will fail gracefully on a plain web host and fall through to step 3).
3. **Offline set** — 25 built-in stories bundled directly in `app.js`, with the same persistent no-repeat-until-exhausted tracking (`usedFallbackTitles`).

## `app.js` structure

The whole file is one IIFE assigned to `window.App`, so nothing leaks into the global scope except the single `App` object. Section order (see the header comment in the file):

```
CONFIG            → constants: API URL, storage keys, speech rates, etc.
STATE             → single object holding all mutable app state
DATA              → the 25 offline fallback stories
UTILS             → pick(), shuffle(), randFreq()
STORY SOURCES     → fetchStoryFromAPI(), generateStoryViaAI(), nextFallbackUnit()
SPEECH SYNTHESIS  → play/pause/resume/stop for the Listening audio
VOCAB TRAINER     → the "hear a random word" ear-training game
AI REVIEW PROMPTS → builds the Thai-language feedback prompts sent to Claude
READING CHECK     → "Check my understanding" → opens claude.ai with the prompt pre-filled
SPEAKING FLOW     → mic recording, live transcript, review handoff
UI RENDERING      → builds the HTML for each of the 3 channel cards
SESSION LIFECYCLE → generateSession() ties everything together
PUBLIC API        → the ~11 functions exposed as window.App.* for onclick="" handlers
```

Only `window.App.*` is public. Everything else is a private function inside the closure — if you need to add a new feature, add it inside the IIFE and expose it in the `return { ... }` block at the bottom only if the HTML needs to call it directly.

## Making a change safely

1. Edit `app.js` (or `style.css` for visual changes only).
2. Run the test suite:
   ```bash
   npm install jsdom
   node test_suite.js
   ```
   It spins up a fake browser (jsdom), mocks `fetch`, `speechSynthesis`, `window.storage`, the microphone, and `window.open`, then clicks through every flow: generating a story from each of the 3 sources, play/pause/resume/stop, the vocab word game, both review hand-offs, and the empty-input guards. 42 checks total.
3. If everything passes, commit and push. GitHub Pages redeploys automatically within about a minute.

## Deploying

Upload `index.html`, `style.css`, and `app.js` to the repo root (same folder). GitHub Pages will serve `index.html` automatically at the repo's Pages URL. `test_suite.js` doesn't need to be deployed — it's a local dev tool — but there's no harm leaving it in the repo for future reference.

## A note on the AI features

"Check my understanding" and "Send for AI review" both open a new tab at `claude.ai/new?q=...` with the story, questions, and the learner's answers pre-filled — this works from any host, no API key required, since it runs through the person's own logged-in Claude session.

Fresh AI-generated stories (source #2 above) only work when this page is loaded as a Claude.ai artifact, since that's the only context with a proxied, authenticated path to the Anthropic API. On a plain static host like GitHub Pages, that step fails silently and the app falls through to the offline story set — this is expected, not a bug.
