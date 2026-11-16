# Quickfill Registry

A dependency-free Chromium Manifest V3 extension for reusable form data.

## Load it

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `extension/` directory.
3. Open or reload a normal web page. Press **Ctrl+B**, or click the extension's toolbar icon.
4. Create an entry, select a color, and add key/value pairs such as `email`, `name`, and `company`.

If Ctrl+B is unassigned or conflicts with another shortcut, assign it under `chrome://extensions/shortcuts`. On macOS the suggested shortcut is Control+B.

## Languages

The extension follows Chrome's interface language: English or Russian, with English as the fallback for other languages. Sidebar text, context menus, confirmations, validation messages, and extension metadata are translated. Saved entry names, keys, and values are kept as entered.

Translations live in `extension/_locales/en/messages.json` and `extension/_locales/ru/messages.json`, using [Chrome's i18n API](https://developer.chrome.com/docs/extensions/reference/api/i18n). After changing Chrome's interface language, restart Chrome and reload open pages.

## Fill and save

- **Right-click an input → Quickfill: suggest saved values.** The sidebar shows compatible values whose keys match the field's name, ID, label, placeholder, or autocomplete hint. Common aliases such as `phone` / `tel` and `first_name` / `given-name` work together. Click a suggestion to fill the field.
- **Right-click an input → Quickfill: save this field value…** Choose an entry and key, review the value, and save. This replaces that entry's existing value for the key. The field association is remembered for that origin, URL path, form, and field identity.
- **Drag a value from the sidebar into an input.** The value replaces the field's contents and emits `input` and `change` events. Alternatively, focus a field, then click a sidebar value.
- Search entries by name, key, or value; edit names, colors, and values; delete entries with confirmation.

The sidebar overlays the right edge of the page. Frames have independent sidebars so a context-menu action stays with its field. Only explicitly selected values are filled; nothing is submitted automatically.

## Browser playground

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://localhost:8765/tests/test.html** after loading the extension. The page includes a manual workflow, multiple input types, a custom association field, read-only and disabled fields, an iframe, dynamic inputs, and a live event log.

You can also open `tests/test.html` directly after enabling **Allow access to file URLs** in the extension's details.

## Automated checks

```sh
node --test tests/*.test.cjs
node --check extension/background.js
node --check extension/content.js
```

`tests/browser.py` exercises the actual extension in Chrome through the DevTools Protocol. It checks creation/color, suggestions, filling events, drag/drop handlers, saving associations, reload persistence, frame filling, and registered Ctrl+B binding. Native context-menu selection, physical drag gestures, and shortcut activation still need the manual playground check.

To reproduce the browser checks, install Python's `websocket-client`, serve the repo as above, and start a **disposable** Chrome profile:

```sh
google-chrome --headless=new --disable-gpu \
  --remote-debugging-port=9223 \
  --remote-allow-origins=http://localhost:9223 \
  --enable-unsafe-extension-debugging \
  --user-data-dir=/tmp/quickfill-test-profile about:blank
```

Load `extension/` with the CDP `Extensions.loadUnpacked` command using its absolute path (recent branded Chrome may ignore `--load-extension`). Pass the returned extension ID to:

```sh
python3 tests/browser.py EXTENSION_ID en
```

For Russian checks, start the disposable browser with the Russian UI locale and pass `ru` instead of `en`. On Linux, launch with `LANGUAGE=ru` in the environment and `--lang=ru`. The browser test verifies translated labels and placeholders against the selected catalog while exercising the same filling workflow.

The browser test clears this extension's storage in the test profile. It writes a screenshot to `/tmp/quickfill-test.png`.

## Storage and scope

Data is stored in `chrome.storage.local`, with no server, telemetry, or network requests. It is not encrypted and is not a password vault. Extension removal clears its local data. Editing an entry replaces that entry; simultaneous edits to the same entry use the last saved version. Worker-side serialization preserves unrelated mutations.

Supported targets are editable text-like inputs and textareas, including dynamically added fields and open shadow roots. Disabled/read-only fields, select boxes, contenteditable editors, closed shadow roots, browser-internal pages, the Chrome Web Store, and built-in PDF viewers are outside this version's scope. Site scripts can still reject or override filled values. Date/number/URL/email compatibility checks are basic; the site's own validation remains authoritative.

## Files

- `extension/manifest.json`: permissions, shortcut, and content script registration.
- `extension/background.js`: native context-menu actions, toolbar/shortcut routing, serialized storage mutations.
- `extension/core.js`: key normalization, aliases, and compatibility matching.
- `extension/content.js`: Shadow DOM sidebar, entry forms, field tracking, fill and drop handlers.
- `extension/styles.js`: isolated sidebar styling.
- `extension/icons/`: editable SVG logo and transparent PNG icons at 16, 32, 48, and 128 pixels, registered for the toolbar and extension listing.
- `extension/_locales/`: English and Russian message catalogs.
- `tests/`: matching tests, actual-extension browser checks, and manual HTML playground.
