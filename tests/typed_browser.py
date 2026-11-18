"""Typed values, capture-all, and native choice-control extension integration checks."""
import json
import runpy
from pathlib import Path


def run_typed_regressions(state):
    page, worker, wait, send, js, navigate, labels, click, key, screenshot = [
        state[name] for name in ['page', 'worker', 'wait', 'send', 'js', 'navigate',
                                 'labels', 'click', 'key', 'screenshot']]

    def storage():
        return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

    def capture():
        send('palette')
        js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot;u.querySelector('.palette input').value=" + json.dumps(labels['saveAllFields']) + ";u.querySelector('.palette input').dispatchEvent(new Event('input'))")
        assert js("u.querySelectorAll('[role=option]').length===1 && !!u.querySelector('[role=option] svg')")
        js("u.querySelector('[role=option]').click()")
        wait(lambda: js("!!s.querySelector('.capture-form')"))

    def edit_value(name, value):
        js("(()=>{const input=typedRow(" + json.dumps(name) + ").querySelector('[data-value-input]');input.value=" + json.dumps(value) + ";input.dispatchEvent(new Event('input',{bubbles:true}));})()")

    worker.js('chrome.storage.local.set({registry:' + json.dumps({'entries': [], 'associations': {}, 'language': 'auto', 'onboardingDone': True}) + '})')
    navigate('controls.html')
    page.call('Page.bringToFront')
    page.call('Emulation.setFocusEmulationEnabled', enabled=True)
    # A field in another form proves that capture follows the currently selected form.
    js("globalThis.otherForm=document.createElement('form');otherForm.id='other-form';otherForm.innerHTML='<input name=outside_form value=outside>';document.body.append(otherForm);document.querySelector('#quantity').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
    capture()
    js("globalThis.captureRow=k=>Array.from(s.querySelectorAll('.capture-field')).find(row=>row.querySelector('[data-capture-key]').value===k)")
    keys = js("Array.from(s.querySelectorAll('[data-capture-key]'),input=>input.value)")
    assert set(keys) == {'subscribed', 'terms', 'plan', 'country', 'city', 'quantity', 'birthday', 'appointment', 'json_value', 'xml_value', 'display_name'}, keys
    assert keys.count('plan') == 1
    assert js("captureRow('terms').querySelector('[data-value-input]').value==='false' && captureRow('terms').querySelector('[data-capture-include]').checked")
    assert js("captureRow('subscribed').querySelector('[data-value-type]').value==='bool' && captureRow('quantity').querySelector('[data-value-type]').value==='number' && captureRow('birthday').querySelector('[data-value-type]').value==='date' && captureRow('appointment').querySelector('[data-value-type]').value==='datetime'")
    assert js("captureRow('plan').querySelector('[data-value-input]').value==='basic' && captureRow('country').querySelector('[data-value-input]').value==='de'")
    # Type controls retain raw text and immediately provide structured highlighting.
    js("for(const [name,type] of [['json_value','json'],['xml_value','xml']]){const select=captureRow(name).querySelector('[data-value-type]');select.value=type;select.dispatchEvent(new Event('change',{bubbles:true}));}")
    assert js("!!captureRow('json_value').querySelector('.typed-preview .token-key') && !!captureRow('xml_value').querySelector('.typed-preview .token-tag')")
    js("captureRow('display_name').querySelector('[data-capture-include]').click()")
    assert js("captureRow('display_name').querySelector('[data-capture-key]').disabled && captureRow('display_name').querySelector('[data-value-input]').disabled")
    js("captureRow('display_name').querySelector('[data-capture-include]').click();s.querySelector('.capture-form>input').value='Captured controls';s.querySelector('.capture-form>input').dispatchEvent(new Event('input',{bubbles:true}))")
    screenshot('capture-form-typed')
    js("s.querySelector('.capture-form').requestSubmit()")
    wait(lambda: len(storage()['entries']) == 1)
    wait(lambda: js("!s.querySelector('.capture-form')"))
    entry = storage()['entries'][0]
    assert entry['name'] == 'Captured controls'
    assert entry['values']['terms'] == 'false' and entry['values']['subscribed'] == 'true'
    assert entry['values']['plan'] == 'basic' and entry['values']['country'] == 'de'
    assert entry['types']['terms'] == 'bool' and entry['types']['quantity'] == 'number'
    assert entry['types']['birthday'] == 'date' and entry['types']['appointment'] == 'datetime'
    assert entry['types']['json_value'] == 'json' and entry['types']['xml_value'] == 'xml'
    assert 'password' not in entry['values'] and 'readonly' not in entry['values'] and 'outside_form' not in entry['values']
    assert len(storage()['associations']) == len(keys)
    assert js("s.querySelectorAll('.value[data-value-kind=bool]').length===2 && !!s.querySelector('.value[data-value-kind=json] .token-key') && !!s.querySelector('.value[data-value-kind=xml] .token-tag')")
    # With no selected field, the palette explicitly captures visible fields across forms.
    js("document.body.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
    capture()
    assert js("!!captureRow('outside_form')")
    click('cancel')
    js("otherForm.remove();document.querySelector('#clear-form').click();document.querySelector('#quantity').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
    click('fillForm')
    wait(lambda: js("!!s.querySelector('[data-empty-only]')"))
    assert js("s.querySelectorAll('[data-field-key]').length===11 && s.querySelectorAll('[data-field-key][aria-label=plan]').length===1")
    assert js("!!s.querySelector('.preview-rows .token-boolean') && !!s.querySelector('.preview-rows .token-tag')")
    click('applyForm')
    assert js("document.querySelector('#subscribed').checked && !document.querySelector('#terms').checked && document.querySelector('#plan-basic').checked && !document.querySelector('#plan-pro').checked")
    assert js("document.querySelector('#country').value==='de' && document.querySelector('#city').value==='Berlin' && document.querySelector('#quantity').value==='12.5' && document.querySelector('#birthday').value==='2026-11-18' && document.querySelector('#appointment').value==='2026-11-18T14:30'")
    assert js("document.querySelector('#private-value').value==='not-for-capture' && document.querySelector('#readonly-value').value==='Read only'")
    click('undo')
    assert js("!document.querySelector('#subscribed').checked && !document.querySelector('#terms').checked && !document.querySelector('#plan-basic').checked && !document.querySelector('#plan-pro').checked && document.querySelector('#country').value==='' && document.querySelector('#quantity').value===''")
    # Empty-only protects a checked box; deliberate overwrite can restore stored false.
    js("document.querySelector('#terms').checked=true")
    click('fillForm')
    wait(lambda: js("!!s.querySelector('[data-empty-only]')"))
    assert js("s.querySelector('[data-field-key][aria-label=terms]').closest('.pair').classList.contains('will-skip')")
    js("s.querySelector('[data-empty-only]').click()")
    click('applyForm')
    assert js("!document.querySelector('#terms').checked")
    click('undo')
    assert js("document.querySelector('#terms').checked && !document.querySelector('#plan-basic').checked")
    # Reload persistence includes all seven types and the editor's matching controls.
    navigate('controls.html')
    click('edit')
    js("globalThis.typedRow=k=>Array.from(s.querySelectorAll('.values-table tbody tr')).find(row=>row.querySelector('td:first-child input').value===k)")
    assert set(js("Array.from(s.querySelectorAll('[data-value-type]'),select=>select.value)")) == {'string', 'bool', 'number', 'date', 'datetime', 'json', 'xml'}
    assert js("typedRow('terms').querySelector('[data-value-input]').value==='false' && !!typedRow('birthday').querySelector('.qf-date-trigger')")
    assert js("!!s.querySelector('[type=submit] .button-icon')")
    for name, invalid in [('json_value', '{"enabled":}'), ('xml_value', '<root><child></root>'), ('quantity', 'Infinity'), ('birthday', '2026-02-30'), ('appointment', '2026-11-18T25:00')]:
        original = js("typedRow(" + json.dumps(name) + ").querySelector('[data-value-input]').value")
        edit_value(name, invalid)
        js("s.querySelector('.entry-editor').requestSubmit()")
        assert js("typedRow(" + json.dumps(name) + ").querySelector('[data-value-input]').getAttribute('aria-invalid')==='true'")
        assert storage()['entries'][0]['values'][name] == entry['values'][name]
        edit_value(name, original)
    # Highlighting renders user-supplied JSON/XML as text, including markup-like strings.
    safe_json = '{"enabled":true,"count":7,"html":"<img src=x onerror=alert(1)>"}'
    safe_xml = '<profile active="true"><name>Alex</name><script>window.qfMarkupExecuted=true</script></profile>'
    edit_value('json_value', safe_json)
    edit_value('xml_value', safe_xml)
    assert js("!!typedRow('json_value').querySelector('.typed-preview .token-key') && !!typedRow('xml_value').querySelector('.typed-preview .token-tag') && !s.querySelector('img,script') && !window.qfMarkupExecuted")
    js("s.querySelector('[data-action=fullscreen]').click()")
    screenshot('typed-editor-fullscreen')
    key('Escape')
    js("s.querySelector('.entry-editor').requestSubmit()")
    wait(lambda: storage()['entries'][0]['values']['json_value'] == safe_json)
    wait(lambda: js("!s.querySelector('.entry-editor')"))
    assert storage()['entries'][0]['values']['xml_value'] == safe_xml
    assert js("s.querySelector('.value[data-value-kind=json]').textContent.includes('<img') && !s.querySelector('img,script')")
    send('palette')
    js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot;u.querySelector('.palette input').value='count';u.querySelector('.palette input').dispatchEvent(new Event('input'))")
    assert js("!!u.querySelector('[data-value-type=json] .token-key') && !!u.querySelector('[data-value-type=json] mark') && !u.querySelector('img,script')")
    key('Escape')
    screenshot('typed-registry')
    runpy.run_path(str(Path(__file__).with_name('widgets_browser.py')))['run_widget_regressions'](page, js, click, labels, key, screenshot)
    runpy.run_path(str(Path(__file__).with_name('capture_browser.py')))['run_capture_regressions'](state)
    runpy.run_path(str(Path(__file__).with_name('controls_browser.py')))['run_choice_regressions'](page)
    runpy.run_path(str(Path(__file__).with_name('preferences_browser.py')))['run_preferences_regressions'](state)
    assert not [event for event in page.events if event.get('method') == 'Runtime.exceptionThrown'], 'Uncaught browser errors'
    print('PASS: palette capture-all with form/page scope, checkbox/radio/combobox persistence and filling, all value types, typed validation/highlighting, safe markup rendering and undo')


if __name__ == '__main__':
    run_typed_regressions(runpy.run_path(str(Path(__file__).with_name('polish_browser.py'))))
