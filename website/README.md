# Lookout site

Static pages for Lookout. HTML, CSS, and a bit of JavaScript. Nothing to install.

## Run it

From the repo root:

```bash
node website/serve.mjs
```

That rebuilds `website/dist` and serves it at http://127.0.0.1:4173. Set `PORT` if 4173 is taken.

`node website/build.mjs` only builds. `node --test website/logic.test.mjs` checks OS detection, the download buttons, and the white paper renderer.

## Deploy

Point Vercel or Netlify at this folder (`website/`) as the project root. Both configs are here. The build command is `node build.mjs` and the published directory is `dist`. The host only has to serve files. There is no server in production.

Pretty URLs are on: `/whitepaper` is the rendered paper. `whitepaper.md` is the source, and the build copies it into `dist` so the footer link works.

## Downloads

`releases.js` is the only place URLs live. The Mac button points at `macos.url`. While `published` is false, the page says the file is not actually hosted there. Windows shows "Coming soon" and is not a link, even if you paste a URL in, until `comingSoon` is false and `published` is true.

Add `?os=mac`, `?os=windows`, `?os=linux`, `?os=ios`, `?os=ipad`, or `?os=android` to preview another computer. The page says it is a preview.

## White paper

Edit `whitepaper.md`. The next build turns it into the page at `/whitepaper`. The renderer covers headings, lists, fenced code, links, bold, and inline code.
