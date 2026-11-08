# StarShots

A multi-page web workspace for StarShots operations, client delivery, and supporting tools.

The project is built as a Vite multi-page application and deployed to Cloudflare Pages. React powers the application surfaces; a custom Cloudflare Pages Worker (`_worker.js`) handles server-side routes and integrations.

## Application surfaces

| Path | Purpose |
| --- | --- |
| `/db` | Main database and operations workspace |
| `/g` | Client delivery and gallery experience, including payment-proof actions |
| `/l` | Delivery link generator |
| `/inv` | Invoice generator and composer |
| `/subs` | Subscription management |
| `/t` | Standalone reading / recitation page |
| `/eng` | Standalone English-learning page |

The first five routes are the core StarShots operations surfaces. `/t` and `/eng` are standalone pages built and hosted in the same project.

## Technology

- **UI:** React 19
- **Build:** Vite 6 (multi-page inputs are declared in `vite.config.js`)
- **Hosting and server runtime:** Cloudflare Pages, Wrangler, and the root `_worker.js`
- **Serverless endpoints:** the root `_worker.js` (Cloudflare Pages advanced mode); it handles every `/api/*` route
- **Data and file storage:** Supabase REST API and Storage
- **Optional receipt parsing:** Cloudflare Workers AI binding, with an OpenAI fallback when configured

## Repository layout

| Location | Responsibility |
| --- | --- |
| `src/pages/` | React entry points and page-specific UI |
| `src/components/` | Shared React components |
| `src/features/` | Domain-specific features |
| `_worker.js` | Custom Cloudflare Pages Worker and API routing |
| `db/`, `g/`, `l/`, `inv/`, `subs/`, `t/`, `eng/` | HTML entry points for the multi-page build |
| `scripts/copy-static.mjs` | Copies required root-level static assets and the Worker into `dist/` |
| `*.sql` | Versioned database migration/reference scripts |
| `.kiro/steering/` | Repository-specific development and architecture guidance |
| `docs/archive/` | Dated historical checkpoints; not the source of current runtime behavior |

## Getting started

Use a Node.js version compatible with the dependencies in `package.json`.

```bash
npm ci
npm run dev
```

Vite starts the development server on `127.0.0.1`. Open the local URL printed by the command and navigate to the required route, for example `/db` or `/g`.

## Build and preview

```bash
npm run build
npm run preview
```

The build runs `vite build` and then `scripts/copy-static.mjs`. The resulting site is written to `dist/`, which is the Cloudflare Pages build output directory.

For local Cloudflare Pages / Worker behavior, use:

```bash
npm run pages:dev
```

This runs Wrangler's Pages development mode. Features that depend on Cloudflare bindings or secrets may require local Wrangler configuration.

## Deployment

The configured Cloudflare Pages project is `starshots`.

```bash
npm run deploy
```

The deployment script publishes the existing `dist/` directory with Wrangler. Authenticate Wrangler with the intended Cloudflare account first, and confirm the target project and environment before deploying.

The repository also includes `npm run secret:admin` for setting the `ADMIN_PASSWORD` Pages secret. Configure all required production secrets and bindings in Cloudflare; never commit credentials, tokens, or production data to this repository. Local `.env*` and Wrangler `.dev.vars*` files are ignored by Git.

## Data and migration safety

The SQL files in the repository are migration/reference scripts. Their presence in Git does **not** prove that they have been applied to the live Supabase project. Check the live schema and migration state before applying or troubleshooting a database change.

Payment/deposit state, payment-proof review state, and an active payment request are related but distinct parts of the application. Preserve their separate semantics when changing invoice or delivery flows.

## Security notes

- `noindex` / `nofollow` page metadata is a crawler hint, **not** an access-control mechanism.
- Enforce authorization on the server and through the intended Supabase policies; do not rely on hidden routes or obscure URLs to protect private data.
- Keep production credentials in Cloudflare secrets or an approved local secret store, never in source files or commits.
- Treat database migrations and Worker/API changes as production-sensitive. Verify their effects independently from a successful frontend build.

## Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build all configured pages and copy required static assets |
| `npm run preview` | Preview the production build locally |
| `npm run pages:dev` | Run the site through Wrangler Pages locally |
| `npm run deploy` | Deploy `dist/` to the `starshots` Cloudflare Pages project |
| `npm run secret:admin` | Set the `ADMIN_PASSWORD` Pages secret |
| `node scripts/screenshot.mjs` | Generate the configured desktop/mobile UI screenshots |

## Historical references

- [Project and payment-proof checkpoint (2026-10-29)](docs/archive/2026-10-29-project-checkpoint.md)
- [Delivery design checkpoint (2026-10-25)](docs/archive/2026-10-25-design-checkpoint.md)

Use the current source on `main` for actual behavior. Archived checkpoints describe the state and validation known on their stated dates.
