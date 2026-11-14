# Lookout website and Gemini demo

Next.js App Router site for Vercel. The homepage and white paper are prerendered; `/demo` is an interactive client and `/api/demo` calls Gemini on the server.

## Run

```sh
cd website
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set GEMINI_API_KEY in .env.local.
pnpm dev
```

Open http://127.0.0.1:3000. `pnpm test` checks downloads, Markdown, replay scoring, model validation, and API boundaries. `pnpm build` produces the production app; `pnpm start` serves it.

## Vercel

Import this repository, set **Root Directory** to `website`, and select **Next.js**. Keep the output directory at its framework default. Set `GEMINI_API_KEY` as a server environment variable for Preview and Production, then deploy. Never prefix the key with NEXT_PUBLIC_. `GEMINI_MODEL` optionally overrides the default `gemini-2.5-flash`.

Only three fixed scenarios are accepted; visitors cannot submit arbitrary prompts. Generated sessions are cached for one hour per warm function instance, and concurrent requests for a scenario share a generation. This cache is not a global quota or durable rate limiter. Configure Vercel Firewall rate limits and a Gemini project quota before opening a public deployment.

Without the API key the site still builds. Visitors can play the explicitly labeled scripted example; Gemini generation shows an unavailable message. API errors and timeouts show a retryable error; there is no canned response presented as a live Gemini result.

## Demo boundaries

Gemini generates fictional commands, explanations, and risk classifications. Nothing executes, no files are inspected, and no desktop agent is contacted. The simulation replays those events with Lookout's score weights, and Auto-protect stops at the first critical event. The desktop monitor uses deterministic rules; Gemini's demo classifications are illustrative, not evidence of detection accuracy.

Scenario choices are sent to Google Gemini through the server. The installed desktop monitor's local privacy model is unchanged. `lib/score.js` mirrors the score module introduced by PR #9; keep the two in sync when changing scoring.

## Content

Edit `src/home.html` and `src/site.css` for the landing page, and `whitepaper.md` for `/whitepaper`. The build copies the favicon and downloadable Markdown to `public`. `releases.js` remains the single download configuration. The Mac URL is explicitly a placeholder; Windows stays disabled. Add `?os=mac` or `?os=windows` to preview OS-specific cards.
