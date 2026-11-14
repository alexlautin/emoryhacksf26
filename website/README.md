# Harness website and Gemini demo

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

Only the four fixed scenarios in `lib/demo.js` are accepted; visitors cannot submit their own prompts. Generated sessions are cached for one hour per warm function instance, and concurrent requests for a scenario share a generation. This cache is not a global quota or durable rate limiter. Configure Vercel Firewall rate limits and a Gemini project quota before opening a public deployment.

Without the API key the site still builds. Visitors can play the explicitly labeled scripted example; Gemini generation shows an unavailable message. API errors and timeouts show a retryable error; there is no canned response presented as a live Gemini result.

## Demo boundaries

Gemini writes the story: a title, a command line, an explanation, how deep in the process chain the step is, and whether the agent's window would show it. It does not decide risk. Every command is classified by `lib/rules.js`, a browser-safe copy of the desktop monitor's command rules (`src/rules.js`), and scored by `lib/score.js`. Auto-protect stops the replay at the first critical event. Because the story varies, a generated session can come out milder than its scenario card suggests; the page says so.

Nothing executes, no files are inspected, and no desktop agent is contacted. Scenario choices are sent to Google Gemini through the server. The installed desktop monitor's local privacy model is unchanged. Keep `lib/rules.js` and `lib/score.js` in sync with the app when rules or scoring change.

## Content

The landing page is `app/page.jsx`, with the scroll walkthrough in `app/_components/scenario.jsx` and the score widget in `app/_components/scoreplay.jsx`. Styles are in `src/site.css` (`app/demo.css` for `/demo`). `whitepaper.md` is rendered at `/whitepaper`, and the build copies it to `public` for download. The pug mark is `src/assets/pug.png`; the tab icon is `app/icon.png`. `releases.js` remains the single download configuration. The Mac URL is explicitly a placeholder; Windows stays disabled. Add `?os=mac` or `?os=windows` to preview OS-specific cards.
