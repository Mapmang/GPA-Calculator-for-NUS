# GPA Calculator for NUS 
GPA Calculator for NUS or other schools with GPA out of 5.0 with S/U options

API connecting Module search up - updated once a day through the hosted backend cache.

## Run with shared API cache

Production users should not run `localhost`. They should visit one deployed website URL.

Recommended deployment:

1. Deploy this repo to Cloudflare Pages.
2. Bind a Workers KV namespace named `NUSMODS_CACHE`.
3. Let the Pages Function in `functions/api/nusmods/[[path]].js` serve `/api/nusmods/*`.

The browser calls `/api/nusmods/*` on the same public site URL. The Cloudflare Function stores NUSMods responses in Workers KV for 24 hours, so users share one deployed cache instead of each browser calling NUSMods separately.

### Cloudflare setup

Create the KV namespace:

```bash
npx wrangler kv namespace create NUSMODS_CACHE
npx wrangler kv namespace create NUSMODS_CACHE --preview
```

Copy the returned IDs into `wrangler.toml`, then deploy through Cloudflare Pages or run:

```bash
npm run build:cloudflare
npx wrangler pages deploy dist
```

For Cloudflare Pages Git integration, use `npm run build:cloudflare` as the build command and `dist` as the build output directory.

### Local development only

Use the Python server only when developing locally:

```bash
python server.py
```

Then open `http://localhost:8000`.

`server.py` imitates the deployed cache behavior and stores local cache files in `.cache/nusmods`. It is not something end users should run.


## Vibecoding project
UI - Made with **Gemini**
Backend - Made with **Claude** 
