# Quickfill Registry

A dependency-free Chromium Manifest V3 extension for reusable form data.

## Load it

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `extension/` directory.
3. Open or reload a normal web page. Press **Ctrl+B**, or click the extension's toolbar icon. The first-run **Quick start** walkthrough can create an example entry and let you practice on a sample field.
4. Create an entry, select a color, and add key/value pairs such as `email`, `name`, and `company`.

Use **Ctrl+Shift+Space** for the command palette. If Ctrl+B is unassigned or conflicts with another shortcut, assign it under `chrome://extensions/shortcuts`. On macOS the suggested shortcut is Control+B.

After installing or reloading the extension, clicking its toolbar icon initializes Quickfill in an already-open page without refreshing it or clearing form values. This recovery uses the `activeTab` and `scripting` permissions. If the browser blocks access to a page, the icon shows a **!** badge with an explanatory tooltip.

## Interface

The compact header keeps search and New entry within reach. Settings has its own icon; Import, Export, and the command palette are in the header's three-dot menu. Settings → Data tools also provides Import and Export icon buttons with tooltips. Entry menus contain Edit, Duplicate, and Delete. Pin and expand/collapse controls remain beside the title, with Fill form below it.

Use the **Move sidebar to the left/right** icon in the header to switch sides. The choice is saved for all websites and updates open tabs without losing editor drafts. The button is hidden while expanded to the full window; returning to the sidebar restores the selected side.

Drag the gripper on the sidebar's inner edge to resize it between **320 and 640 px**, within the available screen width. The width is saved for the current website when you release it. Press **Escape** during a drag to cancel, or double-click the gripper to reset to 380 px. With the gripper focused, use the left/right arrow keys to move the edge, **Shift** for larger steps, and **Home/End** for the minimum/maximum width. Resizing keeps unsaved form edits intact.

The entry editor uses a key/value table with multiline values, per-row transformations, Add value, and Remove value. The header's **Expand to full window** control gives the editor and settings more room. **Escape** returns to the sidebar without losing edits; the same header control also restores the sidebar width.

Choose **Open in new tab** in the sidebar header or **Settings → General** to open Quickfill on its own page. Switch between **Saved entries** and **Settings** to edit typed values, change global and saved website preferences, and import or export backups. The page fills the tab and works independently of the source website. Both views share saved data; unsaved drafts stay in the tab where you edit them. The browser's extension **Options** action opens the same page.

Choose **Value type** below each key: String, Boolean, Number, Date, Date & time, JSON, or XML. Typed values are validated before saving and filling. JSON/XML previews highlight their syntax; saved values, suggestions, and palette results show their types. Existing entries default to String. Values keep their original text, with type metadata included in backups.

Date fields have a calendar button; Date & time adds hour and minute controls. Dates use `YYYY-MM-DD`, and date/time values use local `YYYY-MM-DDTHH:mm` without timezone conversion. The calendar supports arrow keys and Page Up/Down. Themed dropdowns support arrow keys, typing to find an option, Enter to select, and Escape to dismiss. XML accepts one root element, namespaces, comments, and CDATA; DTDs and custom entities are unsupported.

Use Filters to show collection/tag selectors, remove individual filter chips, or clear search and filters from an empty result. Search highlights matching text and reveals matching values. Long values have a Show full value disclosure.

Editor, preview, and settings screens have a Back control instead of registry search. Back and closing the sidebar preserve the current editor draft in that page until reload; reopening always starts at the entry list with Resume draft and Discard draft. Cancel discards the active draft. Drafts are not written to extension storage. Save and Cancel remain visible while scrolling. Website restrictions, tags, collections, and transformations are expandable.

Inline suggestions show the value first and entry/key below it. Entry colors identify suggestions; hover and keyboard focus trigger one sparkle burst followed by a static glow. Reduced-motion mode uses only the highlight. The popup measures available space and opens above or below its field. The command palette groups values and actions, keeps typing focus in search, and uses arrow keys plus Enter to select (Page Up/Down moves five results). Search and controls remain visible while results scroll. Matching text is highlighted, counts explain truncated lists, and selected long values have an expandable full preview. The palette appears above the sidebar, temporarily prevents interaction with it, and restores the previous control on Escape. Value backgrounds use their entry color at 5% opacity; focus outlines and magic effects use that same color.

Form preview summarizes ready, review, and skipped fields, with an optional Needs attention filter. Its Fill button counts actionable fields. Saving a page value offers Create new entry and shows existing/new values before replacement. Import previews show additions, updates, and unchanged duplicates before applying.

The footer identifies the selected field and shows feedback with Undo when available. With the sidebar closed, feedback appears in a dismissible page notification. Settings groups general options, website preferences (including appearance), and data tools. Violet controls use white labels with a darker surface tint for contrast; the brand accent remains `#a05dff`.

## Languages

Open **Settings → Language** and choose **Auto**, **English**, or **Русский**. The selection is saved and updates sidebars in open tabs, context menus, and the toolbar tooltip immediately. Auto follows Chrome's interface language, falling back to English. The extension listing and shortcut description in Chrome always follow the browser language. Entry names, keys, and values stay as entered.

Translations live in `extension/_locales/en/messages.json` and `extension/_locales/ru/messages.json`. The manifest uses [Chrome's i18n API](https://developer.chrome.com/docs/extensions/reference/api/i18n); the sidebar uses those same catalogs for the language override.

## Fill and save

- **Focus a field → Quickfill button.** Inline suggestions work without opening the sidebar. Use arrow keys to navigate and Escape to close; website settings can show the button or disable inline suggestions. Quickfill opens only when requested and moves focus into its own list; typing and native autofill keep control of the page field. Selecting a value keeps focus on Quickfill instead of refocusing the page input and reopening native suggestions. Older automatic-mode preferences are treated as button mode.
- **Right-click the Quickfill button** to open suggestions, save the current field, change its association, open the sidebar or settings, or undo the last fill. **Shift+F10** opens the same menu from the focused button; arrow keys select actions and Escape returns to the button.
- **Command palette → Save all field values…** captures the focused form, or the current page when no form is focused. Review the captured values, change keys/types, choose a new or existing entry, and uncheck unwanted fields before saving. Existing keys are shown before replacement; unrelated keys remain. Passwords, excluded, hidden, disabled, and read-only fields are skipped. Saving the selected values and their associations is one storage operation.
- **Checkboxes and radio buttons:** checkboxes store `true` or `false`, including unchecked boxes when capturing a form. Radio groups store one selected option value. Filling and Undo update checked states and emit input/change events. Select comboboxes accept an option value or visible label; editable comboboxes with a datalist accept text.
- **Right-click an input → Quickfill: suggest saved values.** The sidebar shows compatible values whose keys match the field's name, ID, label, placeholder, or autocomplete hint. English and Russian aliases such as `phone` / `tel` / `телефон` and `first_name` / `given-name` / `имя` work together. Suggestions explain whether they matched a field hint or a saved association. **Change field association** lets you correct the key or clear the association without changing entry values. Click a suggestion to fill the field.
- **Right-click an input → Quickfill: save this field value…** Choose an entry and key, review the value, and save. This replaces that entry's existing value for the key. The field association is remembered for that origin, URL path, form, and field identity.
- **Drag a value from the sidebar into an input.** The value replaces the field's contents and emits `input` and `change` events. Alternatively, focus a field, then click a sidebar value.
- **Undo last fill** restores the preceding single-field or whole-form fill. Fields changed since filling or removed from the page are skipped. Undo is kept in memory per frame and cleared on page reload.
- **Fill form…** on an entry opens a field-by-field preview. Focus a field first to limit filling to its form; otherwise the preview includes visible fields in the current document, including open shadow roots. Resolve ambiguous matches, leave unwanted fields on Skip, and apply. **Fill empty fields only** is enabled by default; uncheck it deliberately to overwrite existing content. Every selected row shows the resolved value and whether it will be skipped. Fields changed during the preview are skipped. Password fields are excluded from whole-form filling.
- Search entries by name, key, or value. Searching a key or value narrows the displayed values; matching an entry name displays all its values. From search, use **↑/↓** to navigate results and **Enter** to fill. **Esc** closes the sidebar and resets it to the entry list.
- **☆/★** pins an entry. Pinned entries appear first, followed by entries for the current website. **Collapse/Expand** controls long entries; both settings persist.
- Edit names, colors, and values; delete entries with confirmation. In **Websites**, enter one exact origin per line, such as `https://example.com`. Leave it blank for all websites. Scheme and port matter; subdomains are separate. **Show entries for all websites** temporarily reveals other entries.

The sidebar overlays the selected edge of the page, starting on the right. Frames have independent sidebars so a context-menu action stays with its field. Only explicitly selected values are filled; nothing is submitted automatically.

## Faster workflows

- **Command palette:** Ctrl+Shift+Space or the sidebar button searches all saved entries and actions, independently of sidebar filters. Choose “Fill with …” to review a form, save the current field, undo, create an entry, open settings, or start the walkthrough. Arrow keys navigate; Tab stays within the dialog; Escape returns focus.
- **Templates and copies:** New entries can start from Person, Company, Address, or Test Account templates. **Duplicate** opens a separate draft with the same values, tags, collection, website restrictions, and transformations. Save it to create the copy.
- **Tags and collections:** Add comma-separated tags and a collection in the entry editor. Their sidebar filters combine with search and website filtering. Text search also matches tags and collection names.
- **Global inline suggestions:** Settings → General → Inline suggestions chooses Show button or Off for all websites. Changes apply immediately in open tabs. Website preferences default to **Use global setting**; choose Show button or Off there to override the default for one website. Existing explicit website choices remain in effect.
- **Website preferences:** Settings includes the current origin's preferred entry, sidebar width (320–640 px), inline suggestion override, and excluded fields. Preferences persist and update open tabs. Exclusions apply to single-field fills, drag/drop, inline suggestions, and form previews.
- **Accessibility:** Controls have visible keyboard focus, labels, status announcements, and larger click targets. The UI respects reduced-motion preferences. The walkthrough can be reopened from Settings.

## Saved mappings and transformations

Form preview lets you choose any entry key for each visible field, even if automatic matching found nothing. **Save form mapping** remembers the choices and transformations for this entry, origin, and URL path. Each rule retains a DOM locator and field identity, including open shadow roots. Removed fields, changed identities, and missing keys are reported on the next preview. Review/remap current fields and save to replace the old rules, including broken ones.

Each value's **Value options** sets its default transformation: unchanged, trim whitespace, uppercase, lowercase, digits only, or a format pattern. A form mapping can override it for a specific field. Saved source values remain unchanged. In a format pattern, `{value}` inserts the source string; otherwise each `#` takes the next digit, for example `+# (###) ###-####`.

## Generated values

Saved values can contain these explicit variables:

| Variable | Value |
| --- | --- |
| `{{date}}` | Current UTC date, `YYYY-MM-DD` |
| `{{uuid}}` | UUID generated for the preview |
| `{{timestamp}}` | Unix timestamp in milliseconds |
| `{{counter}}` | Increasing number local to this entry |

For example, `test+{{counter}}@example.com` produces numbered test addresses. Single-field generation opens a review before filling. Form previews share one generation context across their fields; Apply uses exactly the displayed values. Transformations run after variable resolution. Unknown variables are rejected; no expressions or scripts are evaluated.

Counters are reserved atomically when a preview uses them, so cancelled previews can leave gaps. Undo does not decrement them. Counters and walkthrough completion are local preferences and are not exported. Separate browser profiles have independent sequences.

Fill failures distinguish incompatible values, disabled/read-only fields, excluded fields, cancelled input events, removed fields, and immediate page overrides. Form previews also skip fields changed after review. Applications that overwrite values asynchronously can still require their own editor integration.

## Backup and sharing

**Export** downloads `quickfill-backup.json`. **Import** accepts a file or pasted JSON and shows a preview before writing anything. Duplicates are matched by entry ID:

- **Merge:** retain existing keys, overwrite matching keys with imported values, and use imported entry metadata.
- **Replace:** replace only duplicate entries entirely; unrelated entries remain.
- **Keep existing:** skip duplicate entries while adding new ones.

Merge and replace overwrite conflicting field associations; keep-existing preserves them. Backups contain plain saved values, tags, collections, transformations, site restrictions, pin/collapse settings, field associations, saved mappings, global preferences for inline suggestions and sidebar position, and website preferences. They do not include the UI language preference, generated-value counters, or walkthrough completion. Older version-1 backups without the new fields still import. Mapping and preference conflicts follow the same merge/replace versus keep-existing policy as associations. Older backups without global preferences leave your current global choice unchanged. Limits are 2 MB per backup, 500 entries, and 200 keys per entry. Invalid files are rejected before storage changes.

Example backup format:

```json
{
  "version": 1,
  "entries": [{
    "id": "work-profile",
    "name": "Work",
    "color": "#315de4",
    "values": {"email": "alex@example.com", "country": "Russia"},
    "sites": ["https://example.com"],
    "pinned": true,
    "collapsed": false
  }],
  "associations": {}
}
```

## Browser playground

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://localhost:8765/tests/test.html** after loading the extension. The page includes a manual workflow, multiple input types, a custom association field, read-only and disabled fields, an iframe, dynamic inputs, and a live event log. **tests/advanced.html** adds a checklist for the new features, ambiguous matches, Russian labels, a select, a rich editor, and separate forms. **tests/power.html** exercises inline controls, mappings, variables, and website preferences. **tests/frameworks.html** tests React and Vue controls after fetching the test dependencies below.

**http://localhost:8765/tests/controls.html** has checkboxes, a radio group, select and editable comboboxes, numbers, dates, JSON, and XML. Use its Clear editable values button after capturing the form, then fill it from the saved entry and try Undo. The event log shows which controls changed.

You can also open `tests/test.html` directly after enabling **Allow access to file URLs** in the extension's details.

## Automated checks

```sh
node --test tests/*.test.cjs
node --check extension/background.js
node --check extension/content.js
```

`tests/browser.py` exercises the actual extension in Chrome through the DevTools Protocol. It checks creation/color, suggestions, filling events, drag/drop handlers, saving associations, reload persistence, frame filling, and registered Ctrl+B binding. Native context-menu selection, physical drag gestures, shortcut activation, and the visual interaction with Chrome’s saved-address popup still need a headed manual check. The autofill-coexistence suite verifies explicit activation, focus ownership, launcher placement, unchanged autocomplete attributes, untouched page arrow/Enter keys, and stale-popup cleanup.

To reproduce the browser checks, install Python's `websocket-client`, serve the repo as above, and start a **disposable** Chrome profile:

```sh
google-chrome --headless=new --disable-gpu \
  --remote-debugging-port=9223 \
  --remote-allow-origins=http://localhost:9223 \
  --enable-unsafe-extension-debugging \
  --user-data-dir=/tmp/quickfill-test-profile about:blank
```

Fetch pinned test-only distributions (React 18.3.1 and Vue 3.5.13), then load the unpacked extension and run the complete suite:

```sh
python3 tests/fetch-frameworks.py
python3 tests/run-browser.py en
```

The runner loads `extension/` using CDP `Extensions.loadUnpacked`, runs the basic, advanced, power-feature, autofill-coexistence, and UI checks, and closes the disposable browser. No framework packages are included in the extension. The advanced suite covers undo, form preview/ambiguity/conflicts, select and rich-text filling, associations, sites, pin/collapse, keyboard navigation, import/export, language persistence, and React/Vue model updates on fill and undo. The power-feature suite adds inline filling, palette navigation/focus trapping, saved and broken mappings, empty-only filling, stable generated previews, transformations, templates, duplication, tags/collections, website preferences/exclusions, and onboarding.

For Russian checks, start the disposable browser with the Russian UI locale and pass `ru` instead of `en`. On Linux, launch with `LANGUAGE=ru` in the environment and `--lang=ru`. The browser test verifies translated labels and placeholders against the selected catalog while exercising the same filling workflow.

The UI suite checks keyboard menus, filters, draft recovery, field validation, replacement review, preview counts, import summaries, palette focus, popup positioning, reduced motion, and 320 px sidebars at 200% browser zoom. Screen captures are written to `/tmp/quickfill-polish-en-screens/` or `/tmp/quickfill-polish-ru-screens/`.

The sidebar recovery suite uses real toolbar actions to check tabs opened before installation, extension reloads with stale UI, delayed startup, repeated script injection, and disabled inline suggestions while preserving unsaved page form values.

The options-page suite checks the dedicated settings tab, commands targeting the correct tab, typed entry editing, shared preferences, import/export, language changes, narrow layouts, and continued use after closing the source website.

The additional polish suite checks table editing and persistence, full-window draft retention, recovery after page DOM replacement, launcher menus, stale asynchronous previews, and undo when page handlers modify or remove fields.

The typed suite adds whole-form capture, type persistence and validation, safe highlighting, checkbox/radio/select filling and Undo, dropdown keyboard behavior, calendar navigation, and datetime editing.

The browser test clears this extension's storage in the test profile. It writes a screenshot to `/tmp/quickfill-test.png` and test exports to `/tmp/quickfill-exports/`.

## Storage and scope

Data is stored in `chrome.storage.local`, with no server, telemetry, or network requests. It is not encrypted and is not a password vault. Extension removal clears its local data. Editing an entry replaces that entry; simultaneous edits to the same entry use the last saved version. Worker-side serialization preserves unrelated mutations.

Supported targets are editable text-like inputs, checkboxes, radio groups, textareas, native selects, inputs with datalists, and contenteditable editors, including dynamic fields and open shadow roots. Selects accept an option's value or visible label; a fill selects one option, and undo restores the previous selection. Rich-text filling inserts plain text; undo restores the original DOM markup. Cancelled `beforeinput` events are respected, and successful writes emit `input` and `change` events.

Controlled input/select/editor examples are tested with React and Vue. Editors with their own document models can still reject or override DOM changes; this is not a dedicated adapter for every rich-text library. Disabled/read-only fields, closed shadow roots, browser-internal pages, the Chrome Web Store, and built-in PDF viewers remain unsupported. Date/number/URL/email compatibility checks are basic; the site's validation remains authoritative.

## Files

- `extension/manifest.json`: permissions, shortcut, and content script registration.
- `extension/background.js`: native context-menu actions, toolbar/shortcut routing, serialized storage mutations.
- `extension/core.js`: key normalization, aliases, matching, site ordering, and message formatting.
- `extension/registry.js`: backup, mapping, and preference validation and duplicate-resolution rules.
- `extension/power.js`: templates, transformations, and generated-value resolution.
- `extension/types.js`: typed value validation and safe syntax tokens.
- `extension/controls.js`: themed dropdowns, calendars, and datetime controls.
- `extension/surface.js`: inline controls and keyboard command dialog.
- `extension/fields.js`: field detection, snapshots, filling, and undo.
- `extension/content.js`: Shadow DOM sidebar, entry forms, field tracking, fill and drop handlers.
- `extension/styles.js`: isolated sidebar styling.
- `extension/icons/`: editable SVG logo and transparent PNG icons at 16, 32, 48, and 128 pixels, registered for the toolbar and extension listing.
- `extension/_locales/`: English and Russian message catalogs.
- `tests/`: matching tests, actual-extension browser checks, and manual HTML playground.
