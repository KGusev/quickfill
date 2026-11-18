"""Standalone options tab checks in a disposable Chrome profile.

Usage: python3 tests/options_browser.py [--port 9223] [--extension-id ID] [--locale en|ru]
The local repository server must run on :8765. Without an extension ID, Chrome
needs --enable-unsafe-extension-debugging so the test can load the extension.
This test replaces Quickfill storage, creates its own tabs, and closes those tabs.
The parent runner owns the browser process.
"""
import argparse
import base64
import json
from pathlib import Path
from urllib.request import urlopen

from sidebar_recovery_browser import CDP, wait


def run(port=9223, extension_id=None, locale='en'):
    root = Path(__file__).resolve().parent.parent
    origin = f'http://localhost:{port}'
    targets = lambda: json.load(urlopen(origin + '/json'))
    browser = CDP(json.load(urlopen(origin + '/json/version')), port)
    if not extension_id:
        extension_id = browser.call('Extensions.loadUnpacked', path=str(root / 'extension'))['id']
    options_url = f'chrome-extension://{extension_id}/options.html'
    source_id = browser.call('Target.createTarget', url='about:blank')['targetId']
    source = CDP(wait(lambda: next((item for item in targets() if item['id'] == source_id), None)), port)
    source.call('Runtime.enable')
    source.call('ServiceWorker.enable')
    source.call('ServiceWorker.startWorker', scopeURL=f'chrome-extension://{extension_id}/')
    worker_target = wait(lambda: next((item for item in targets() if item['type'] == 'service_worker' and extension_id in item['url']), None))
    worker = CDP(worker_target, port)
    wait(lambda: worker.js("typeof chrome !== 'undefined' && !!chrome.runtime?.id"))
    catalog = lambda language: json.loads((root / 'extension' / '_locales' / language / 'messages.json').read_text())
    labels = {key: value['message'] for key, value in catalog(locale).items()}
    options = None
    options_id = None
    secondary_options = None
    secondary_options_id = None

    def storage():
        return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

    def bind_options():
        wait(lambda: options.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=settings]')"))
        options.js("globalThis.s = document.querySelector('quickfill-sidebar').shadowRoot")

    def view(name):
        options.js("s.querySelector('[data-view=" + name + "]').click()")

    def click(label):
        expression = "Array.from(s.querySelectorAll('button')).find(button=>button.textContent === " + json.dumps(labels[label]) + " || button.getAttribute('aria-label') === " + json.dumps(labels[label]) + ')'
        assert options.js('!!(' + expression + ')'), label
        options.js(expression + '.click()')

    def screenshot(name):
        image = options.call('Page.captureScreenshot', format='png')['data']
        Path('/tmp/quickfill-options-' + name + '.png').write_bytes(base64.b64decode(image))

    def source_unchanged():
        assert source.js("window.optionsSourceMarker === 'source document' && document.querySelector('#display-name').value === 'Keep this source value'")

    try:
        assert worker.js("chrome.runtime.getManifest().options_ui.open_in_tab") is True
        fixture = {
            'entries': [{'id': 'other-site', 'name': 'Another website', 'color': '#315de4',
                         'values': {'email': 'other@example.com'}, 'sites': ['https://elsewhere.example']}],
            'associations': {}, 'preferences': {'https://elsewhere.example': {'suggestions': 'off'}},
            'globalPreferences': {'suggestions': 'button'}, 'language': locale, 'onboardingDone': True,
        }
        worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')
        source.call('Page.navigate', url='http://localhost:8765/tests/controls.html?quickfill-options-test=1')
        source.call('Page.bringToFront')
        source.call('Emulation.setFocusEmulationEnabled', enabled=True)
        wait(lambda: source.js("!!document.querySelector('#display-name') && !!document.querySelector('quickfill-tools')"))
        source.js("window.optionsSourceMarker='source document';document.querySelector('#display-name').value='Keep this source value'")
        source_tab = worker.js("chrome.tabs.query({active:true,currentWindow:true}).then(t=>t[0].id)")
        worker.js(f"chrome.tabs.sendMessage({source_tab},{{type:'toggle'}},{{frameId:0}})")
        wait(lambda: source.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-action=openInTab]')"))
        source.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('[data-action=openInTab]').click()")
        options_target = wait(lambda: next((item for item in targets() if item['type'] == 'page' and item['url'].split('#')[0] == options_url), None))
        options_id = options_target['id']
        options = CDP(options_target, port)
        options.call('Runtime.enable')
        options.call('Emulation.setDeviceMetricsOverride', width=1360, height=960, deviceScaleFactor=1, mobile=False)
        options.call('Emulation.setFocusEmulationEnabled', enabled=True)
        bind_options()
        assert options.js("!!s.querySelector('[data-global-suggestions]')")
        assert options.js("!document.querySelector('iframe,#display-name') && typeof window.optionsSourceMarker === 'undefined'")
        assert options.js("!s.querySelector('[data-action=fullscreen]') && !s.querySelector('[data-action=openInTab]')")
        assert options.js("(()=>{const rect=s.querySelector('.panel').getBoundingClientRect();return Math.abs(rect.width-innerWidth)<2 && Math.abs(rect.height-innerHeight)<2;})()")
        source_unchanged()
        screenshot('settings')
        assert options.js("s.querySelector('[data-saved-website]').value === 'https://elsewhere.example'")
        options.js("s.querySelector('.saved-websites input[type=number]').value='420';s.querySelector('.saved-websites form').requestSubmit()")
        wait(lambda: storage()['preferences']['https://elsewhere.example'].get('width') == 420)
        assert set(storage()['preferences']) == {'https://elsewhere.example'}

        # Browser commands target one manager tab, even with another manager open.
        options_tab = options.js('chrome.tabs.getCurrent().then(tab=>tab.id)')
        secondary_options_id = browser.call('Target.createTarget', url=options_url + '#routing-other')['targetId']
        secondary_options = CDP(wait(lambda: next((item for item in targets() if item['id'] == secondary_options_id), None)), port)
        wait(lambda: secondary_options.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=settings]')"))
        assert worker.js('dispatch(' + json.dumps({'id': options_tab, 'url': options_url}) + ",{type:'palette'})") is True
        wait(lambda: options.js("!!document.querySelector('quickfill-tools').shadowRoot.querySelector('.palette')"))
        assert secondary_options.js("!document.querySelector('quickfill-tools').shadowRoot.querySelector('.palette')")
        assert source.js("!document.querySelector('quickfill-tools').shadowRoot.querySelector('.palette')")
        assert worker.js('dispatch(' + json.dumps({'id': options_tab, 'url': options_url}) + ",{type:'palette'})") is True
        wait(lambda: options.js("!document.querySelector('quickfill-tools').shadowRoot.querySelector('.palette')"))
        browser.call('Target.closeTarget', targetId=secondary_options_id)
        secondary_options_id = None
        options.call('Page.bringToFront')
        tabs = browser.call('Target.getTargets', filter=[{'type': 'tab', 'exclude': False}])['targetInfos']
        options_target = next(item for item in tabs if item['url'] == options_url)
        options.js(f"globalThis.optionsToolbarCount=0;chrome.runtime.onMessage.addListener(message=>{{if(message.type==='manager-command' && message.command==='toggle' && message.tabId==={options_tab})optionsToolbarCount++;}})")
        browser.call('Extensions.triggerAction', id=extension_id, targetId=options_target['targetId'])
        wait(lambda: options.js("optionsToolbarCount === 1 && document.querySelector('quickfill-sidebar').checkVisibility() && !!s.querySelector('[data-global-suggestions]')"))
        assert worker.js(f"chrome.action.getBadgeText({{tabId:{options_tab}}})") == ''

        # Changing a global setting affects a page already open in another tab.
        worker.js(f"chrome.tabs.sendMessage({source_tab},{{type:'toggle'}},{{frameId:0}})")
        source.js("document.querySelector('#display-name').focus()")
        wait(lambda: source.js("!!document.querySelector('quickfill-tools').shadowRoot.querySelector('.launcher')"))
        for value in ['off', 'button']:
            options.js("s.querySelector('[data-global-suggestions]').value=" + json.dumps(value) + ";s.querySelector('[data-global-suggestions]').dispatchEvent(new Event('change',{bubbles:true}))")
            wait(lambda: storage()['globalPreferences']['suggestions'] == value)
            wait(lambda: options.js("!s.querySelector('[data-global-suggestions]').disabled"))
            wait(lambda: source.js("!!document.querySelector('quickfill-tools').shadowRoot.querySelector('.launcher')") == (value == 'button'))

        # The manager lists entries from every website and edits their typed values.
        view('registry')
        assert options.js("s.querySelector('main').textContent.includes('Another website')")
        for label in ['fillForm', 'saveAllFields', 'keepField']:
            assert options.js("!Array.from(s.querySelectorAll('button')).some(button=>button.checkVisibility() && button.textContent === " + json.dumps(labels[label]) + ')')
        options.js("s.querySelector('.search-row button').click();s.querySelector('.entry-editor>input').value='Options profile';s.querySelector('.values-table td:first-child input').value='config';s.querySelector('[data-value-type]').value='json';s.querySelector('[data-value-type]').dispatchEvent(new Event('change',{bubbles:true}));s.querySelector('[data-value-input]').value='{\"enabled\":true}';s.querySelector('[data-value-input]').dispatchEvent(new Event('input',{bubbles:true}))")
        assert options.js("!!s.querySelector('.typed-preview .token-key')")
        assert options.js("!Array.from(s.querySelectorAll('button')).some(button=>button.textContent === " + json.dumps(labels['currentSite']) + ')')
        assert options.js("!document.querySelector('quickfill-tools')?.shadowRoot.querySelector('.launcher')")
        screenshot('editor')
        options.js("s.querySelector('.entry-editor').requestSubmit()")
        wait(lambda: any(entry['name'] == 'Options profile' for entry in storage()['entries']))
        wait(lambda: options.js("!s.querySelector('.entry-editor')"))
        entry = next(entry for entry in storage()['entries'] if entry['name'] == 'Options profile')
        assert entry['types']['config'] == 'json' and entry['values']['config'] == '{"enabled":true}'
        options.js("globalThis.profile=Array.from(s.querySelectorAll('article')).find(article=>article.querySelector('h2').textContent==='Options profile')")
        options.js("Array.from(profile.querySelectorAll('button')).find(button=>button.textContent === " + json.dumps(labels['edit']) + ').click()')
        options.js("s.querySelector('[data-value-input]').value='{\"enabled\":false}';s.querySelector('[data-value-input]').dispatchEvent(new Event('input',{bubbles:true}));s.querySelector('.entry-editor').requestSubmit()")
        wait(lambda: next(entry for entry in storage()['entries'] if entry['name'] == 'Options profile')['values']['config'] == '{"enabled":false}')
        source_unchanged()

        # Escape keeps the standalone page visible, unlike closing a page sidebar.
        options.call('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
        options.call('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
        assert options.js("document.querySelector('quickfill-sidebar').checkVisibility() && !!s.querySelector('main').textContent.trim()")
        view('settings')
        for action in ['importData', 'exportData']:
            assert options.js("!!s.querySelector('[data-action=" + action + "] svg')")
        browser.call('Browser.setDownloadBehavior', behavior='allow', downloadPath='/tmp/quickfill-exports')
        options.js("s.querySelector('[data-action=exportData]').click()")
        assert options.js("s.querySelector('.status').textContent.includes(" + json.dumps(labels['exported']) + ')')
        options.js("s.querySelector('[data-action=importData]').click()")
        assert options.js("!!s.querySelector('input[type=file]')")
        click('back')
        view('settings')

        # Settings survive localization and a fresh page instance.
        next_locale = 'ru' if locale == 'en' else 'en'
        options.js("s.querySelector('.settings-section select').value=" + json.dumps(next_locale) + ";s.querySelector('.settings-section select').dispatchEvent(new Event('change',{bubbles:true}))")
        wait(lambda: storage()['language'] == next_locale)
        wait(lambda: options.js("document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('.panel')?.lang === " + json.dumps(next_locale)))
        bind_options()
        options.call('Page.reload')
        bind_options()
        assert options.js("s.querySelector('.panel').lang === " + json.dumps(next_locale))
        assert options.js("s.querySelector('[data-global-suggestions]').value === 'button'")
        view('registry')
        assert options.js("s.querySelector('main').textContent.includes('Options profile')")
        options.call('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=1, mobile=False)
        assert options.js("document.documentElement.scrollWidth <= innerWidth && s.querySelector('.panel').getBoundingClientRect().right <= innerWidth+1")
        options.js("s.querySelector('.search-row button').click()")
        assert options.js("document.documentElement.scrollWidth <= innerWidth")
        screenshot('narrow-editor')

        # Closing the source tab does not affect the settings page or its forms.
        browser.call('Target.closeTarget', targetId=source_id)
        source_id = None
        options.js("s.querySelector('.entry-editor>input').value='Independent tab';s.querySelector('.values-table td:first-child input').value='name';s.querySelector('[data-value-input]').value='Independent';s.querySelector('.entry-editor').requestSubmit()")
        wait(lambda: any(entry['name'] == 'Independent tab' for entry in storage()['entries']))
        wait(lambda: options.js("!s.querySelector('.entry-editor')"))
        options.js("Array.from(s.querySelectorAll('article')).find(article=>article.querySelector('h2').textContent==='Independent tab').querySelector('.menu-list .danger').click()")
        options.js("s.querySelector('main .actions .danger').click()")
        wait(lambda: not any(entry['name'] == 'Independent tab' for entry in storage()['entries']))
        assert not [event for event in options.events if event.get('method') == 'Runtime.exceptionThrown'], 'Options page errors'
        print('PASS: dedicated options tab, targeted commands, typed entry CRUD, live global settings, import UI, language/reload, Escape, narrow layout and source-tab independence', flush=True)
    finally:
        for target_id in [secondary_options_id, options_id, source_id]:
            if target_id:
                browser.call('Target.closeTarget', targetId=target_id)
        for client in [secondary_options, options, source, worker, browser]:
            if client:
                client.ws.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--extension-id')
    parser.add_argument('--locale', choices=['en', 'ru'], default='en')
    args = parser.parse_args()
    run(args.port, args.extension_id, args.locale)
