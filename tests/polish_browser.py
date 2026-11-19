"""Launcher, table editor, fullscreen and sidebar lifecycle regression checks."""
import json
import runpy
from pathlib import Path

def run_pending_save_regression(js, isolated, wait, click):
    """Complete an older save after the user starts editing a different entry."""
    isolated("globalThis.qfOriginalSaveSend=chrome.runtime.sendMessage.bind(chrome.runtime);globalThis.qfPendingSave=[];chrome.runtime.sendMessage=(message,...rest)=>{const pending=qfOriginalSaveSend(message,...rest);return message.type==='mutate'&&message.action==='upsert'?pending.then(response=>new Promise(resolve=>qfPendingSave.push(()=>resolve(response)))):pending;}")
    try:
        click('newEntryButton')
        js("globalThis.savingForm=s.querySelector('form');savingForm.querySelector('input').value='Save in flight';savingForm.querySelector('.pair input').value='email';savingForm.querySelector('.pair textarea').value='saved@example.com';savingForm.requestSubmit()")
        wait(lambda: isolated('qfPendingSave.length===1'))
        assert js("savingForm.querySelector('[type=submit]').disabled")
        click('back')
        click('newEntryButton')
        js("globalThis.newerForm=s.querySelector('form');newerForm.querySelector('input').value='Newer unsaved draft';newerForm.querySelector('.pair input').value='notes';newerForm.querySelector('.pair textarea').value='Keep this text'")
        isolated('qfPendingSave[0]()')
        wait(lambda: js("!savingForm.querySelector('[type=submit]').disabled"))
        assert js("s.querySelector('form')===newerForm && newerForm.querySelector('input').value==='Newer unsaved draft' && newerForm.querySelector('.pair textarea').value==='Keep this text' && !newerForm.querySelector('[type=submit]').disabled")
        click('back')
        click('resumeDraft')
        assert js("s.querySelector('form')===newerForm && newerForm.querySelector('input').value==='Newer unsaved draft'")
        click('cancel')
    finally:
        isolated('chrome.runtime.sendMessage=qfOriginalSaveSend;qfPendingSave.forEach(release=>release())')
    print('PASS: completing an older save preserves a newer editable and resumable draft')

state = runpy.run_path(str(Path(__file__).with_name('ui_browser.py')))
page, worker, wait, send, js, navigate, value, labels, click, key, enter, screenshot = [
    state[name] for name in ['page', 'worker', 'wait', 'send', 'js', 'navigate', 'value',
                             'labels', 'click', 'key', 'enter', 'screenshot']]

def storage():
    return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

fixture = {'entries': [{'id': 'profile', 'name': 'Table profile', 'color': '#315de4',
                       'values': {'email': 'table@example.com', 'notes': 'First line\nSecond line'}}],
           'associations': {}, 'language': 'auto', 'onboardingDone': True}
worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')
navigate('power.html')

# Key/value rows are a real table, with multiline values preserved across saves.
click('edit')
assert js("s.querySelectorAll('.values-table thead th').length>=2")
assert js("s.querySelectorAll('.values-table tbody tr.pair').length===2")
enter('.values-table tbody tr:nth-child(2) textarea', 'Edited first line\nEdited second line')
click('addValue')
js("globalThis.row=s.querySelector('.values-table tbody tr:last-child');row.querySelector('input').value='email';row.querySelector('textarea').value='duplicate@example.com';s.querySelector('form').requestSubmit()")
assert js("!!row.querySelector('[aria-invalid=true]') && !!row.querySelector('.field-error')")
enter('.values-table tbody tr:first-child input', 'alternate_email')
assert js("!row.querySelector('[aria-invalid=true]') && row.querySelector('input').validity.valid")
enter('.values-table tbody tr:first-child input', 'email')
js("s.querySelector('form').requestSubmit();row.querySelector('.value-row-actions button').click()")
assert js("!s.querySelector('[aria-invalid=true]') && s.querySelectorAll('.values-table tbody tr').length===2")
click('addValue')
js("globalThis.row=s.querySelector('.values-table tbody tr:last-child');row.querySelector('input').value='reference';row.querySelector('textarea').value='REF-42'")
click('addValue')
js("globalThis.removedRow=s.querySelector('.values-table tbody tr:last-child');Array.from(removedRow.querySelectorAll('button')).find(b=>b.textContent===" + json.dumps(labels['removeValue']) + "||b.getAttribute('aria-label')===" + json.dumps(labels['removeValue']) + ").click()")
assert js("s.querySelectorAll('.values-table tbody tr.pair').length===3 && !removedRow.isConnected")

# Fullscreen is reversible without replacing controls or losing the editor draft.
js("s.querySelector('[data-action=fullscreen]').click()")
assert js("s.querySelector('.panel').classList.contains('fullscreen')")
assert js("Math.abs(s.querySelector('.panel').getBoundingClientRect().width-document.documentElement.clientWidth)<=1")
js("globalThis.focusable=Array.from(s.querySelectorAll('button,input,textarea,select,summary,[tabindex=\"0\"]')).filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility());focusable[0].focus();focusable[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,composed:true,cancelable:true}))")
assert js("s.activeElement===focusable.at(-1)")
js("s.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,composed:true,cancelable:true}))")
assert js("s.activeElement===focusable[0]")
screenshot('fullscreen-table')
key('Escape')
assert js("!s.querySelector('.panel').classList.contains('fullscreen') && document.querySelector('quickfill-sidebar').style.display!=='none'")
assert js("s.querySelector('.values-table tbody tr:last-child textarea').value==='REF-42'")
js("s.querySelector('form').requestSubmit()")
wait(lambda: storage()['entries'][0]['values'].get('reference') == 'REF-42')
assert storage()['entries'][0]['values']['notes'] == 'Edited first line\nEdited second line'
navigate('power.html')
click('edit')
assert js("s.querySelector('.values-table tbody tr:nth-child(2) textarea').value==='Edited first line\\nEdited second line'")

# SPA DOM cleanup must not permanently detach the sidebar or discard its controls.
enter('form input', 'Recoverable draft')
js("globalThis.savedSidebar=document.querySelector('quickfill-sidebar');globalThis.savedForm=s.querySelector('form');savedSidebar.remove()")
wait(lambda: js("savedSidebar.isConnected"))
assert js("document.querySelector('quickfill-sidebar')===savedSidebar && s.querySelector('form')===savedForm && savedForm.querySelector('input').value==='Recoverable draft'")
send('toggle')
js('savedSidebar.remove()')
send('toggle')
wait(lambda: js('savedSidebar.isConnected'))
click('resumeDraft')
assert js("s.querySelector('form input').value==='Recoverable draft'")

# Context-menu suggestions are another navigation path away from a draft.
js("document.querySelector('#email').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
send('fill')
click('resumeDraft')
assert js("s.querySelector('form input').value==='Recoverable draft'")
click('cancel')

# Right-click and keyboard context menus retain the selected field and dismiss predictably.
send('toggle')
js("document.querySelector('#email').value='save-from-menu@example.com';document.querySelector('#email').focus();globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
wait(lambda: js("!!u.querySelector('.launcher')"))
js("u.querySelector('.launcher').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))")
assert js("u.querySelector('.launcher-menu').getAttribute('role')==='menu' && u.activeElement===u.querySelector('.launcher-menu [role=menuitem]')")
screenshot('launcher-menu')
key('ArrowDown')
assert js("u.activeElement===u.querySelectorAll('.launcher-menu [role=menuitem]')[1]")
key('Escape')
assert js("!u.querySelector('.launcher-menu') && u.activeElement===u.querySelector('.launcher')")
js("u.querySelector('.launcher').dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,composed:true,cancelable:true}))")
assert js("!!u.querySelector('.launcher-menu')")
js("Array.from(u.querySelectorAll('.launcher-menu button')).find(b=>b.textContent===" + json.dumps(labels['keepField']) + ").click()")
assert js("s.querySelector('main h2').textContent===" + json.dumps(labels['keepField']))
assert js("s.querySelector('form textarea').value==='save-from-menu@example.com'")
click('cancel')
send('toggle')
js("document.querySelector('#email').focus();u.querySelector('.launcher').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));Array.from(u.querySelectorAll('.launcher-menu button')).find(b=>b.textContent===" + json.dumps(labels['settings']) + ").click()")
assert js("s.querySelector('main h2').textContent===" + json.dumps(labels['settings']))
click('back')
send('toggle')
js("globalThis.savedTools=document.querySelector('quickfill-tools');savedTools.remove();document.querySelector('#phone').focus()")
wait(lambda: js("savedTools.isConnected && !!u.querySelector('.launcher')"))
js("u.querySelector('.launcher').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));document.querySelector('#phone').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))")
assert js("!u.querySelector('.launcher-menu')")

# Hold two counter reservations in the actual content-script world to force stale completion.
contexts = [event['params']['context']['id'] for event in page.events
            if event.get('method') == 'Runtime.executionContextCreated'
            and not event['params']['context'].get('auxData', {}).get('isDefault')]
context_id = None
for candidate in reversed(contexts):
    try:
        result = page.call('Runtime.evaluate', contextId=candidate, returnByValue=True,
                           expression="document.URL.endsWith('/tests/power.html') && typeof QuickfillCore!=='undefined' && !!chrome.runtime.id")
        if result.get('result', {}).get('value'):
            context_id = candidate
            break
    except AssertionError:
        continue
assert context_id is not None, 'Could not find the extension content-script execution context'

def isolated(expression):
    result = page.call('Runtime.evaluate', contextId=context_id, returnByValue=True,
                      awaitPromise=True, expression=expression)
    assert 'exceptionDetails' not in result, result
    return result.get('result', {}).get('value')

fixture['entries'] = [{'id': ident, 'name': name, 'color': '#315de4',
                       'values': {'email': ident + '+{{counter}}@example.com'}}
                      for ident, name in [('older', 'Older preview'), ('newer', 'Newer preview')]]
worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')
send('toggle')
isolated("globalThis.qfOriginalSend=chrome.runtime.sendMessage.bind(chrome.runtime);globalThis.qfDeferred=[];chrome.runtime.sendMessage=(message,...rest)=>{const pending=qfOriginalSend(message,...rest);return message.type==='mutate'&&message.action==='reserve'?pending.then(response=>new Promise(resolve=>qfDeferred.push({id:message.id,release:()=>resolve(response)}))):pending;}")
try:
    js("Array.from(s.querySelectorAll('article')).find(a=>a.querySelector('h2').textContent==='Older preview').querySelector('.card-actions button').click()")
    wait(lambda: isolated('qfDeferred.length===1'))
    click('back')
    js("Array.from(s.querySelectorAll('article')).find(a=>a.querySelector('h2').textContent==='Newer preview').querySelector('.card-actions button').click()")
    wait(lambda: isolated('qfDeferred.length===2'))
    isolated('qfDeferred[0].release()')
    assert js("!s.querySelector('[data-empty-only]') && s.querySelector('main h2').textContent===" + json.dumps(labels['resolving']))
    isolated('qfDeferred[1].release()')
    wait(lambda: js("!!s.querySelector('[data-empty-only]')"))
    assert js("s.querySelector('main').textContent.includes('Newer preview') && !s.querySelector('main').textContent.includes('Older preview')")
finally:
    isolated('chrome.runtime.sendMessage=qfOriginalSend;qfDeferred.forEach(item=>item.release())')

click('cancel')
run_pending_save_regression(js, isolated, wait, click)
runpy.run_path(str(Path(__file__).with_name('fields_browser.py')))['run_undo_regressions'](page)
assert not [event for event in page.events if event.get('method') == 'Runtime.exceptionThrown'], 'Uncaught browser errors'
print('PASS: table editing/persistence/validation, fullscreen draft retention, detached sidebar recovery, fill-navigation drafts, launcher menus and stale asynchronous previews')
