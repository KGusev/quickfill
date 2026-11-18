"""Global inline preferences, website overrides, and data-tool icon regressions."""
import json
from urllib.request import urlopen


def run_preferences_regressions(state):
    page, worker, wait, send, js, navigate, labels, click, screenshot = [
        state[name] for name in ['page', 'worker', 'wait', 'send', 'js', 'navigate',
                                 'labels', 'click', 'screenshot']]
    fixture = {'entries': [{'id': 'inline-default', 'name': 'Inline preferences',
                            'color': '#315de4', 'values': {'email': 'prefs@example.com'}}],
               'associations': {}, 'preferences': {}, 'globalPreferences': {'suggestions': 'button'},
               'language': 'auto', 'onboardingDone': True}
    worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')
    navigate('power.html')
    page.call('Page.bringToFront')
    page.call('Emulation.setFocusEmulationEnabled', enabled=True)

    def storage():
        return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

    def set_global(value):
        js("s.querySelector('[data-global-suggestions]').value=" + json.dumps(value) +
           ";s.querySelector('[data-global-suggestions]').dispatchEvent(new Event('change',{bubbles:true}))")
        wait(lambda: storage()['globalPreferences']['suggestions'] == value)
        wait(lambda: js("!s.querySelector('[data-global-suggestions]').disabled"))

    def set_site(value):
        js("globalThis.siteSelect=s.querySelector('[data-site-suggestions]');siteSelect.value=" + json.dumps(value) +
           ";siteSelect.dispatchEvent(new Event('change',{bubbles:true}));siteSelect.closest('form').requestSubmit()")
        wait(lambda: storage()['preferences'].get('http://localhost:8765', {}).get('suggestions') == value)

    other_url = 'http://127.0.0.1:8765/tests/power.html'
    other_tab = worker.js('chrome.tabs.create({url:' + json.dumps(other_url) + ',active:false}).then(tab=>tab.id)')
    other = None
    try:
        def other_target():
            return next((target for target in json.load(urlopen('http://localhost:9223/json'))
                         if target.get('type') == 'page' and target.get('url') == other_url), None)

        other = type(page)(wait(other_target))
        other.call('Runtime.enable')
        other.call('Emulation.setFocusEmulationEnabled', enabled=True)
        wait(lambda: other.js("!!document.querySelector('#email') && !!document.querySelector('quickfill-tools')"))
        other.js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot;document.querySelector('#email').focus()")
        wait(lambda: other.js("!!u.querySelector('.launcher')"))
        other.js("u.querySelector('.launcher').click()")
        assert other.js("!!u.querySelector('.inline .value')")

        click('settings')
        assert js("s.querySelector('[data-global-suggestions]').value==='button' && s.querySelector('[data-site-suggestions]').value==='inherit'")
        # Compact data tools remain named for tooltips and assistive technology.
        for action in ['importData', 'exportData']:
            assert js("(()=>{const b=s.querySelector('.data-tools [data-action=" + action +
                      "]');return !!b?.querySelector('svg') && b.textContent.trim()==='' && b.title===" +
                      json.dumps(labels[action]) + " && b.getAttribute('aria-label')===" + json.dumps(labels[action]) + ';})()')
        screenshot('settings-global-inline')
        js("s.querySelector('.data-tools [data-action=exportData]').click()")
        assert js("s.querySelector('.status').textContent.includes(" + json.dumps(labels['exported']) + ")")
        js("s.querySelector('.data-tools [data-action=importData]').click()")
        assert js("s.querySelector('main h2').textContent===" + json.dumps(labels['importData']))
        click('back')
        click('settings')

        # Changing the global preference closes a popup in an already-open tab on another origin.
        set_global('off')
        wait(lambda: other.js("!u.querySelector('.launcher') && !u.querySelector('.inline')"))
        other.js("document.querySelector('#email').focus()")
        assert other.js("!u.querySelector('.launcher')")

        # An explicit website choice wins over global changes without affecting another origin.
        set_site('button')
        send('toggle')
        js("document.querySelector('#email').focus();globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
        wait(lambda: js("!!u.querySelector('.launcher')"))
        worker.js("chrome.storage.local.get('registry').then(({registry})=>{registry.globalPreferences={suggestions:'button'};return chrome.storage.local.set({registry});})")
        wait(lambda: other.js("!!u.querySelector('.launcher')"))
        worker.js("chrome.storage.local.get('registry').then(({registry})=>{registry.globalPreferences={suggestions:'off'};return chrome.storage.local.set({registry});})")
        wait(lambda: other.js("!u.querySelector('.launcher')"))
        assert js("!!u.querySelector('.launcher')")
        other.js("document.querySelector('#email').focus()")

        send('toggle')
        click('settings')
        set_site('inherit')
        set_global('button')
        # Re-enabling works for an eligible field that was focused while suggestions were off.
        wait(lambda: other.js("!!u.querySelector('.launcher')"))
        send('toggle')
        js("document.querySelector('#email').focus()")
        wait(lambda: js("!!u.querySelector('.launcher')"))

        # A settings update from another tab must preserve a live editor and its draft.
        send('toggle')
        click('newEntryButton')
        js("globalThis.preferencesDraft=s.querySelector('.entry-editor');preferencesDraft.querySelector('input').value='Do not replace this draft'")
        worker.js("chrome.storage.local.get('registry').then(({registry})=>{registry.globalPreferences={suggestions:'off'};return chrome.storage.local.set({registry});})")
        wait(lambda: other.js("!u.querySelector('.launcher')"))
        assert js("s.querySelector('.entry-editor')===preferencesDraft && preferencesDraft.querySelector('input').value==='Do not replace this draft'")
        worker.js("chrome.storage.local.get('registry').then(({registry})=>{registry.globalPreferences={suggestions:'button'};return chrome.storage.local.set({registry});})")
        assert js("s.querySelector('.entry-editor')===preferencesDraft")
        click('cancel')

        # Both the global choice and website inheritance survive a fresh content script.
        navigate('power.html')
        click('settings')
        assert js("s.querySelector('[data-global-suggestions]').value==='button' && s.querySelector('[data-site-suggestions]').value==='inherit'")
        set_site('off')
        send('toggle')
        js("document.querySelector('#email').focus();globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
        assert js("!u.querySelector('.launcher')")
        other.js("document.querySelector('#email').blur();document.querySelector('#email').focus()")
        wait(lambda: other.js("!!u.querySelector('.launcher')"))
        assert not [event for event in other.events if event.get('method') == 'Runtime.exceptionThrown'], 'Other-origin browser errors'
    finally:
        worker.js('chrome.tabs.remove(' + str(other_tab) + ')')
        if other:
            other.ws.close()
    print('PASS: global inline preferences across open origins, website overrides/inheritance, re-enable on focused fields, draft preservation, persistence and accessible import/export icons')
