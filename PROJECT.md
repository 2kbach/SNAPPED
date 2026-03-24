# SNAPPED

## What We're Building
A Safari extension that lets you select UI elements on any webpage and recreate them as pixel-perfect replicas in Figma — preserving fonts, colors, spacing, shadows, borders, layout, and everything else. The source URL is referenced in the Figma document. Web fonts are automatically extracted and can be installed locally.

## Why
Designers and developers frequently need to capture existing UI patterns for reference, inspiration, or recreation. Currently this requires manual screenshot tracing or painstaking measurement. SNAPPED automates the entire process.

## Architecture
Three components:
1. **Safari Web Extension** — Content script for element selection + DOM/CSS extraction + font extraction
2. **Figma Plugin ("SNAPPED")** — Receives extracted JSON and builds Figma nodes using Plugin API
3. **Data Transfer** — JSON file auto-download to ~/Downloads. Cloud relay planned.

The Figma REST API is read-only for file contents, so a companion Figma Plugin (using the Plugin API) is required to create nodes.

## Tech Stack
- Safari WebExtension (Manifest V3, vanilla JS)
- Xcode project (generated via `safari-web-extension-converter`)
- Figma Plugin API (vanilla JS)
- Cloudflare Worker + KV (cloud relay) — planned

## Key Decisions
- **Figma Plugin API over REST API**: REST API can't create arbitrary nodes. Plugin API has full control over fills, strokes, effects, auto-layout, text.
- **JSON file transfer**: Extension auto-downloads JSON to Downloads. Simpler than clipboard or WebSocket bridge (ClaudeTalkToFigma MCP proved unreliable).
- **Font extraction via CSS fetch**: Cross-origin stylesheets block CSSOM access, so extension fetches CSS text directly and parses @font-face with regex.
- **Actual fonts over fallbacks**: Plugin tries the original CSS font family first, falls back to Inter only if unavailable. Fonts can be installed via the plugin's Install button.

## Current Version: v0.4.2

## Changelog
- ✅ 2026-03-23 22:25 — v0.1: Safari extension scaffolding complete. Element selector, DOM extractor, CSS-to-Figma mapper, popup UI. Xcode project builds.
- ✅ 2026-03-23 22:45 — v0.2: Auto-save JSON to Downloads. Popup simplified to show "snap it" instruction.
- ✅ 2026-03-23 23:10 — v0.3: Figma plugin built. Loads JSON, recursively creates frames/text/SVGs with fills, strokes, shadows, corner radius.
- ✅ 2026-03-23 23:20 — v0.3.2: Fixed element stacking (shared coordinate offset), verified positioning works.
- ✅ 2026-03-23 23:27 — v0.3.3: Added image support (`figma.createImageAsync`), per-side border rendering. Netflix avatars render.
- ✅ 2026-03-24 00:00 — v0.3.4: Decorative pseudo-elements (::after dividers) now captured. Netflix separator lines render.
- ✅ 2026-03-24 00:05 — v0.3.5: Browser zoom normalization for accurate sizing.
- ✅ 2026-03-24 07:35 — v0.3.6: Actual font families used instead of always falling back to Inter. Multi-family fallback chain with style variations.
- ✅ 2026-03-24 07:40 — v0.4: Font extraction added. Scans @font-face rules, downloads woff2 files, embeds as base64 in JSON. Figma plugin shows Install button per font family.
- ✅ 2026-03-24 07:45 — v0.4.1: Fixed cross-origin font extraction. Fetches CSS text directly instead of relying on CSSOM. Netflix Sans now captured successfully.
- ✅ 2026-03-24 07:55 — v0.4.2: Captures ALL page fonts, not just fonts used in selected elements. Netflix Sans installed to ~/Library/Fonts/ via woff2→ttf conversion.
- ✅ 2026-03-24 08:10 — v0.4.3: Redesigned status bar and overlays to match Apple native UI. Frosted glass, system blue, symbol glyphs, pill buttons.
- ✅ 2026-03-24 08:15 — v0.4.4: Fixed shadow effects validation — added required blendMode property.
- ✅ 2026-03-24 08:20 — v0.4.5: Added install-fonts.sh for woff2→ttf conversion. Plugin UI shows terminal command.
- ✅ 2026-03-24 08:35 — v0.4.6: Fixed obfuscated font names. Netflix strips name tables (replaces with ".") — install script now patches proper family/style names. Netflix Sans fully working in Figma.
- ✅ 2026-03-24 08:39 — v0.4.7: Added date/time stamp to Figma frame names (YYYY-MM-DD HH:MM).

## Case Study

**2026-03-23** — The idea: capture real website UI and bring it into Figma with perfect fidelity. Started by researching the Figma API and discovered a critical constraint — the REST API is essentially read-only for file content. You can't create nodes through it. This immediately forced the architecture toward a companion Figma plugin that receives extracted data and uses the Plugin API to build nodes. This is actually better anyway, since the Plugin API gives full control over every node property.

Chose Safari WebExtension (Manifest V3) as the foundation. The content script handles two jobs: (1) an interactive element selector with hover highlighting and click-to-select UX, and (2) a recursive DOM walker that extracts every computed style, image, SVG, and even pseudo-elements from the selected subtree.

The trickiest part of the mapper is the CSS-to-Figma property translation. CSS `box-shadow` maps to Figma's `DropShadowEffect` with different parameter names. CSS `display: flex` maps to Figma's auto-layout system. Font weights (400, 700) need to become style names ("Regular", "Bold"). Built a comprehensive mapper covering ~40 CSS properties.

Used `safari-web-extension-converter` to generate the Xcode project. Hit a bundle identifier case mismatch (`snapped` vs `SNAPPED`) that caused the embedded binary validation to fail — fixed by aligning the extension's bundle ID prefix with the parent app.

**2026-03-24** — Built the Figma plugin (`figma-plugin/code.js`) after the ClaudeTalkToFigma MCP bridge proved unreliable. Spent significant time trying to get the WebSocket-based MCP bridge working (multiple channel join failures, stale MCP server instances interfering), before pivoting to a self-contained Figma plugin. The plugin approach is actually more robust — no WebSocket server needed, just paste or load the JSON file.

Hit three interesting bugs in succession: (1) All elements stacked at origin because each selected element used its own top-left as (0,0) — fixed by computing a shared coordinate offset across all selections. (2) Avatar images missing because the plugin wasn't handling `<img>` tags — added `figma.createImageAsync()` support. (3) Divider lines between list items missing — Netflix uses `::after` pseudo-elements with `content: ""` as decorative separators, and we were filtering those out. Fixed by checking if "empty content" pseudo-elements have visible backgrounds or borders before skipping.

Font extraction was its own challenge. First attempt used `document.styleSheets` CSSOM API, but Netflix loads fonts from cross-origin CDN (`assets.nflxext.com`), which blocks `cssRules` access. Solution: fetch the CSS file text directly from the content script (which can fetch any URL the page loaded) and parse `@font-face` blocks with regex. Downloaded woff2 files are embedded as base64 in the JSON. Since macOS can't install woff2 directly, converted to ttf using `fonttools` Python library.

Tested on Netflix Account Profiles page — captures profile avatars (with rounded corners), section headers, card containers with rounded borders, divider lines, chevron SVGs, and Netflix Sans fonts. The end-to-end flow works: Safari extension → JSON file → Figma plugin → pixel-accurate UI recreation with correct fonts.

Font name obfuscation turned out to be a fascinating problem. Netflix's woff2 files contain 1228 real glyphs with valid character maps, but the `name` table is stripped to just `.` — making the fonts invisible to Font Book and Figma. Solution: detect single-character names in the `name` table and patch with proper family/style/PostScript names derived from the CSS `@font-face` weight declarations. This is now automated in `install-fonts.sh` and works for any site that obfuscates font names.

## Feature Parking Lot
- **2026-03-23** — Cloud relay via `snapped.kevinauerbach.com` for seamless Safari→Figma transfer without clipboard *(suggested by Claude)*
- **2026-03-23** — CSS Grid layout support (currently only flexbox + absolute positioning) *(suggested by Claude)*
- **2026-03-23** — Multi-page capture (scroll and capture below-the-fold content) *(suggested by Claude)*
- **2026-03-23** — Chrome/Firefox extension port *(suggested by Claude)*
- **2026-03-24** — Auto-convert woff2→ttf in the Figma plugin so user doesn't need Python *(suggested by Claude)*
- **2026-03-24** — Font preview in plugin UI showing sample text in each captured font *(suggested by Claude)*
