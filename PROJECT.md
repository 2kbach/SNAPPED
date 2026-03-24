# SNAPPED

## What We're Building
A Safari extension that lets you select UI elements on any webpage and recreate them as pixel-perfect replicas in Figma — preserving fonts, colors, spacing, shadows, borders, layout, and everything else. The source URL is referenced in the Figma document.

## Why
Designers and developers frequently need to capture existing UI patterns for reference, inspiration, or recreation. Currently this requires manual screenshot tracing or painstaking measurement. SNAPPED automates the entire process.

## Architecture
Three components:
1. **Safari Web Extension** — Content script for element selection + DOM/CSS extraction
2. **Figma Plugin ("SNAPPED Receiver")** — Receives extracted JSON and builds Figma nodes
3. **Data Transfer** — Clipboard (paste JSON) initially, cloud relay (`snapped.kevinauerbach.com`) later

The Figma REST API is read-only for file contents, so a companion Figma Plugin (using the Plugin API) is required to create nodes.

## Tech Stack
- Safari WebExtension (Manifest V3, vanilla JS)
- Xcode project (generated via `safari-web-extension-converter`)
- Figma Plugin API (TypeScript) — planned
- Cloudflare Worker + KV (cloud relay) — planned

## Key Decisions
- **Figma Plugin API over REST API**: REST API can't create arbitrary nodes. Plugin API has full control over fills, strokes, effects, auto-layout, text.
- **Clipboard transfer first**: Simplest approach, no server needed. User copies JSON from extension, pastes in Figma plugin.
- **Base64 images**: Convert images to data URLs in content script to avoid CORS issues in Figma plugin.

## Version History
- **v0.1** — Safari extension with element selector, DOM extractor, CSS-to-Figma mapper, popup UI

## Changelog
- ✅ 2026-03-23 22:25 — v0.1: Safari extension scaffolding complete. Element selector, DOM extractor, CSS-to-Figma mapper, popup UI. Xcode project builds.
- ✅ 2026-03-23 23:10 — v0.3: Figma plugin built. Loads JSON, recursively creates frames/text/SVGs with fills, strokes, shadows, corner radius.
- ✅ 2026-03-23 23:20 — v0.3.2: Fixed element stacking (shared coordinate offset), verified positioning works.
- ✅ 2026-03-23 23:27 — v0.3.3: Added image support (`figma.createImageAsync`), per-side border rendering. Netflix avatars render.
- ✅ 2026-03-24 00:00 — v0.3.4: Decorative pseudo-elements (::after dividers) now captured. Netflix separator lines render.
- ✅ 2026-03-24 00:05 — v0.3.5: Browser zoom normalization for accurate sizing.

## Case Study

**2026-03-23** — The idea: capture real website UI and bring it into Figma with perfect fidelity. Started by researching the Figma API and discovered a critical constraint — the REST API is essentially read-only for file content. You can't create nodes through it. This immediately forced the architecture toward a companion Figma plugin that receives extracted data and uses the Plugin API to build nodes. This is actually better anyway, since the Plugin API gives full control over every node property.

Chose Safari WebExtension (Manifest V3) as the foundation. The content script handles two jobs: (1) an interactive element selector with hover highlighting and click-to-select UX, and (2) a recursive DOM walker that extracts every computed style, image, SVG, and even pseudo-elements from the selected subtree.

The trickiest part of the mapper is the CSS-to-Figma property translation. CSS `box-shadow` maps to Figma's `DropShadowEffect` with different parameter names. CSS `display: flex` maps to Figma's auto-layout system. Font weights (400, 700) need to become style names ("Regular", "Bold"). Built a comprehensive mapper covering ~40 CSS properties.

Used `safari-web-extension-converter` to generate the Xcode project. Hit a bundle identifier case mismatch (`snapped` vs `SNAPPED`) that caused the embedded binary validation to fail — fixed by aligning the extension's bundle ID prefix with the parent app.

**2026-03-24** — Built the Figma plugin (`figma-plugin/code.js`) after the ClaudeTalkToFigma MCP bridge proved unreliable. The plugin approach is actually more robust — no WebSocket server needed, just paste or load the JSON file. The recursive node builder maps every CSS property to Figma equivalents: fills, strokes, corner radii, shadows, opacity, text styles, and images.

Hit three interesting bugs in succession: (1) All elements stacked at origin because each selected element used its own top-left as (0,0) — fixed by computing a shared coordinate offset across all selections. (2) Avatar images missing because the plugin wasn't handling `<img>` tags — added `figma.createImageAsync()` support. (3) Divider lines between list items missing — Netflix uses `::after` pseudo-elements with `content: ""` as decorative separators, and we were filtering those out. Fixed by checking if "empty content" pseudo-elements have visible backgrounds or borders before skipping.

Tested on Netflix Account Profiles page — captures profile avatars, section headers, card containers with rounded borders, divider lines, and chevron SVGs. The end-to-end flow works: Safari extension → JSON file → Figma plugin → pixel-accurate UI recreation.

## Feature Parking Lot
- **2026-03-23** — Cloud relay via `snapped.kevinauerbach.com` for seamless Safari→Figma transfer without clipboard *(suggested by Claude)*
- **2026-03-23** — CSS Grid layout support (currently only flexbox + absolute positioning) *(suggested by Claude)*
- **2026-03-23** — Pseudo-element (::before, ::after) rendering improvements *(suggested by Claude)*
- **2026-03-23** — Multi-page capture (scroll and capture below-the-fold content) *(suggested by Claude)*
- **2026-03-23** — Chrome/Firefox extension port *(suggested by Claude)*
