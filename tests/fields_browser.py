"""Focused native-DOM undo regressions; call run_undo_regressions(page) from a CDP suite."""
from pathlib import Path


def run_undo_regressions(page):
    extension = Path(__file__).resolve().parent.parent / 'extension'
    page.js((extension / 'core.js').read_text())
    page.js((extension / 'fields.js').read_text())
    results = page.js(r'''(() => {
      const fields = QuickfillFields, completed = [];
      function check(name, make, install, expected, verify = () => true) {
        const el = make(); document.body.append(el);
        try {
          const state = fields.snapshot(el);
          if (!fields.write(el, el.localName === 'select' ? 'C' : 'Filled')) throw Error(name + ': setup fill failed');
          state.after = fields.snapshot(el);
          install(el);
          if (fields.restore(state) !== expected || !verify(el)) throw Error(name + ': wrong undo result');
          completed.push(name);
        } finally { el.remove(); }
      }
      function input() { const el = document.createElement('input'); el.value = 'Original'; return el; }
      check('successful undo', input, () => {}, true, el => el.value === 'Original');
      check('removed during beforeinput', input, el => el.addEventListener('beforeinput', () => el.remove()), false);
      check('edited during beforeinput', input, el => el.addEventListener('beforeinput', () => {el.value = 'Page edit';}), false, el => el.value === 'Page edit');
      check('read-only during beforeinput', input, el => el.addEventListener('beforeinput', () => {el.readOnly = true;}), false, el => el.value === 'Filled');
      check('cancelled beforeinput', input, el => el.addEventListener('beforeinput', event => event.preventDefault()), false, el => el.value === 'Filled');
      check('overridden during input', input, el => el.addEventListener('input', () => {el.value = 'Page override';}), false, el => el.value === 'Page override');
      check('removed during change', input, el => el.addEventListener('change', () => el.remove()), false);
      check('rich markup overridden', () => {
        const el = document.createElement('div'); el.contentEditable = 'true'; el.innerHTML = '<b>Original</b>'; return el;
      }, el => el.addEventListener('input', () => {el.innerHTML = '<i>Original</i>';}), false);
      check('multiple selection overridden', () => {
        const el = document.createElement('select'); el.multiple = true;
        el.innerHTML = '<option selected>A</option><option selected>B</option><option>C</option>'; return el;
      }, el => el.addEventListener('input', () => {el.value = 'A';}), false);
      return completed;
    })()''')
    assert len(results) == 9, results
    print('PASS: undo handles cancellation, removal, concurrent edits, read-only changes, and text/rich/select overrides')
