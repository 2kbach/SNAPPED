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
- ✅ 2026-03-23 22:25 — v0.1: Safari extension scaffolding complete. Element selector with hover highlight, click-to-select, shift multi-select. DOM extractor captures computed styles recursively. CSS-to-Figma mapper handles colors, shadows, borders, gradients, fonts, layout. Popup UI with idle/selecting/ready states. Xcode project builds successfully.

## Case Study

**2026-03-23** — The idea: capture real website UI and bring it into Figma with perfect fidelity. Started by researching the Figma API and discovered a critical constraint — the REST API is essentially read-only for file content. You can't create nodes through it. This immediately forced the architecture toward a companion Figma plugin that receives extracted data and uses the Plugin API to build nodes. This is actually better anyway, since the Plugin API gives full control over every node property.

Chose Safari WebExtension (Manifest V3) as the foundation. The content script handles two jobs: (1) an interactive element selector with hover highlighting and click-to-select UX, and (2) a recursive DOM walker that extracts every computed style, image, SVG, and even pseudo-elements from the selected subtree.

The trickiest part of the mapper is the CSS-to-Figma property translation. CSS `box-shadow` maps to Figma's `DropShadowEffect` with different parameter names. CSS `display: flex` maps to Figma's auto-layout system. Font weights (400, 700) need to become style names ("Regular", "Bold"). Built a comprehensive mapper covering ~40 CSS properties.

Used `safari-web-extension-converter` to generate the Xcode project. Hit a bundle identifier case mismatch (`snapped` vs `SNAPPED`) that caused the embedded binary validation to fail — fixed by aligning the extension's bundle ID prefix with the parent app.

## Feature Parking Lot
- **2026-03-23** — Cloud relay via `snapped.kevinauerbach.com` for seamless Safari→Figma transfer without clipboard *(suggested by Claude)*
- **2026-03-23** — CSS Grid layout support (currently only flexbox + absolute positioning) *(suggested by Claude)*
- **2026-03-23** — Pseudo-element (::before, ::after) rendering improvements *(suggested by Claude)*
- **2026-03-23** — Multi-page capture (scroll and capture below-the-fold content) *(suggested by Claude)*
- **2026-03-23** — Chrome/Firefox extension port *(suggested by Claude)*
