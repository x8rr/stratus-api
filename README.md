# Stratus API — Landing Page

Marketing site for Stratus, a cloud game streaming API. Built with React 19, Tailwind CSS v4, and Bun.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [Bun](https://bun.sh) | 1.1+ |
| Node.js | Not required (Bun only) |

Install Bun if you don't have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

---

## Install

```bash
bun install
```

---

## Development

```bash
bun run dev
```

Opens a dev server with hot module replacement. Check the terminal output for the exact port (usually `http://localhost:3000`).

The server watches `src/` for changes. React components update in the browser without a full reload.

---

## Build

```bash
bun run build
```

Outputs to `dist/`. The build is minified and includes sourcemaps (`dist/*.js.map`).

To preview the production build locally, serve the `dist/` folder with any static file server:

```bash
bunx serve dist
```

---

## Project structure

```
stratus-api/
├── src/
│   ├── index.html        # HTML shell — title, meta, Google Fonts import
│   ├── index.css         # Global base styles + Tailwind v4 theme tokens
│   ├── frontend.tsx      # React root mount (do not edit)
│   ├── App.tsx           # Full landing page — all sections live here
│   └── logo.webp         # Stratus logo
│
├── stratus-api-main/     # Backend API source (separate deployment)
│   └── api.js
│
├── build.ts              # Bun bundler script
├── package.json
├── tsconfig.json
└── bunfig.toml
```

### `src/App.tsx` sections

| Component | Description |
|-----------|-------------|
| `useInView` | Intersection Observer hook for scroll-triggered fade-ins |
| `tokenize` / `Code` | Minimal JS syntax highlighter — no external deps |
| `Nav` | Fixed top navigation bar |
| `Hero` | Full-height hero with headline, stats, and live code window |
| `Features` | 6-card feature grid |
| `HowItWorks` | 3-step numbered flow |
| `QuickStart` | Tabbed code blocks (JavaScript / cURL) + endpoint reference |
| `Footer` | Links and copyright |

---

## Customisation

### Swap in the logo

The logo lives at `src/logo.webp` and is referenced in `Nav` and `Footer` as `./logo.webp`.

### Colors

All tokens live in `src/index.css` inside the Tailwind `@theme` block:

```css
@theme {
  --color-yellow: #D4F000;   /* primary accent */
  --color-surface: #111111;  /* card backgrounds */
  --color-border: #1a1a1a;   /* dividers */
  --color-muted: #6b7280;    /* secondary text */
}
```

Change `--color-yellow` here and every `text-yellow`, `bg-yellow`, `border-yellow` class updates automatically.

### CTA / contact links

The "Get API Key" button and footer "Contact" link both point to a `mailto:` address. Search for `mailto:` in `src/App.tsx` to update them.

### Content copy

All headlines, feature descriptions, step text, and code snippets are plain string constants at the top of each section component in `App.tsx`, or in the `FEATURES` / `STEPS` arrays. No CMS or data layer.

---

## Environment variables

This is a fully static site — no environment variables are required at build or runtime.

---

## Tech stack

| Layer | Package |
|-------|---------|
| Runtime & bundler | [Bun](https://bun.sh) |
| UI library | [React 19](https://react.dev) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4) via `bun-plugin-tailwind` |
| Language | TypeScript (strict) |

No UI component libraries are used. Every element is hand-rolled with Tailwind utility classes.
