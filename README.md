# AI-MD

AI-MD is a browser extension that converts web pages into clean Markdown so you can copy or download content for LLM workflows.

## Features

- Convert main content, full page, or selection
- Preserve tables and embedded iframe content (when accessible)
- Toggle title, images, links, and metadata
- Copy to clipboard or download as a `.md` file
- Multi-tab conversion via context menu or shortcuts

## Privacy

AI-MD runs fully client-side inside your browser. Extracted content is processed locally.

## Install (Developer Mode)

### Chrome / Chromium

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click “Load unpacked”
4. Select the `extension/` directory

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click “Load Temporary Add-on…”
3. Select `extension/manifest.json`

## Build Packages

```bash
./scripts/build.sh chrome
./scripts/build.sh firefox
./scripts/build.sh source
./scripts/build.sh all
```
