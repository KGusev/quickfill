"""Sidebar recovery against a disposable Chrome profile and the local test server.

Usage: python3 tests/sidebar_recovery_browser.py [--port 9223]
Chrome needs --enable-unsafe-extension-debugging and localhost:8765 serves the repo.
This test reinstalls Quickfill in that profile and closes the browser on completion
unless --keep-open is supplied by the full-suite runner.
"""
import argparse
import json
import time
from pathlib import Path
from urllib.request import urlopen

import websocket


class CDP:
    def __init__(self, target, port):
        self.ws = websocket.create_connection(target['webSocketDebuggerUrl'], origin=f'http://localhost:{port}', timeout=15)
        self.seq = 0
        self.events = []

    def call(self, method, **params):
        self.seq += 1
        self.ws.send(json.dumps({'id': self.seq, 'method': method, 'params': params}))
        while True:
            result = json.loads(self.ws.recv())
            if 'method' in result:
                self.events.append(result)
            if result.get('id') == self.seq:
                assert 'error' not in result, result
                return result.get('result', {})

    def js(self, expression):
        result = self.call('Runtime.evaluate', expression=expression, awaitPromise=True, returnByValue=True)
        assert 'exceptionDetails' not in result, result
        return result.get('result', {}).get('value')


def wait(check, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = check()
        if result:
            return result
        time.sleep(.05)
    raise AssertionError('Timed out waiting for sidebar recovery')


def run(port, close_browser=True):
    root = Path(__file__).resolve().parent.parent
    origin = f'http://localhost:{port}'
    targets = lambda: json.load(urlopen(origin + '/json'))
    browser = CDP(json.load(urlopen(origin + '/json/version')), port)
    page = CDP(next(target for target in targets() if target['type'] == 'page'), port)
    page.call('Runtime.enable')
    page.call('ServiceWorker.enable')

    def worker(extension_id):
        page.call('ServiceWorker.startWorker', scopeURL=f'chrome-extension://{extension_id}/')
        target = wait(lambda: next((item for item in targets() if item['type'] == 'service_worker' and extension_id in item['url']), None))
        client = CDP(target, port)
        wait(lambda: client.js("typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof send === 'function'"))
        return client

    def action(extension_id):
        # triggerAction expects the parent tab target, not its page target.
        tabs = browser.call('Target.getTargets', filter=[{'type': 'tab', 'exclude': False}])['targetInfos']
        target = next(item for item in tabs if item['url'] == 'http://localhost:8765/tests/controls.html')
        browser.call('Extensions.triggerAction', id=extension_id, targetId=target['targetId'])

    active_sidebar = "document.querySelector('quickfill-sidebar:not([data-quickfill-retired])')"
    visible = f"!!{active_sidebar} && getComputedStyle({active_sidebar}).display !== 'none'"

    def preserved():
        assert page.js("window.sidebarDocumentMarker === 'same document' && document.querySelector('#display-name').value === 'Keep my unsaved text'")

    try:
        # Start with a page that predates the extension's content-script registration.
        for extension in browser.call('Extensions.getExtensions')['extensions']:
            if Path(extension['path']) == root / 'extension':
                browser.call('Extensions.uninstall', id=extension['id'])
        page.call('Page.navigate', url='http://localhost:8765/tests/controls.html')
        wait(lambda: page.js("document.readyState === 'complete' && !!document.querySelector('#display-name')"))
        page.call('Page.bringToFront')
        page.js("window.sidebarDocumentMarker = 'same document'; document.querySelector('#display-name').value = 'Keep my unsaved text'")
        extension_id = browser.call('Extensions.loadUnpacked', path=str(root / 'extension'))['id']
        background = worker(extension_id)
        background.js("chrome.storage.local.set({registry:{entries:[],associations:{},preferences:{},globalPreferences:{suggestions:'off'},onboardingDone:true}})")
        tab_id = background.js("chrome.tabs.query({active:true,currentWindow:true}).then(t=>t[0].id)")
        missing = background.js(f"chrome.tabs.sendMessage({tab_id},{{type:'toggle'}},{{frameId:0}}).then(()=>false).catch(e=>e.message)")
        assert 'Receiving end does not exist' in missing, missing
        action(extension_id)
        wait(lambda: page.js(visible))
        assert page.js(f"!!{active_sidebar}.shadowRoot.querySelector('main').textContent.trim()")
        preserved()
        assert background.js(f"chrome.action.getBadgeText({{tabId:{tab_id}}})") == ''
        print('PASS: real toolbar action recovers an existing tab with inline suggestions disabled', flush=True)

        # Duplicate injection must not add another message handler that toggles twice.
        background.js(f"chrome.scripting.executeScript({{target:{{tabId:{tab_id},frameIds:[0]}},world:'ISOLATED',files:chrome.runtime.getManifest().content_scripts[0].js}})")
        action(extension_id)
        wait(lambda: page.js(f"!({visible})"))
        action(extension_id)
        wait(lambda: page.js(visible))
        assert page.js("document.querySelectorAll('quickfill-sidebar:not([data-quickfill-retired])').length === 1 && document.querySelectorAll('quickfill-tools:not([data-quickfill-retired])').length === 1")
        assert page.js(f"{active_sidebar}.shadowRoot.activeElement === {active_sidebar}.shadowRoot.querySelector('.search')")
        page.call('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
        page.call('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
        wait(lambda: page.js(f"!({visible})"))
        action(extension_id)
        wait(lambda: page.js(visible))
        preserved()
        print('PASS: repeated injection retains one sidebar, one tools surface, and one toggle handler', flush=True)

        # A legacy observer keeps an orphaned host alive even after context invalidation.
        page.js(f"window.orphanedSidebar = {active_sidebar}; window.legacySidebarObserver = new MutationObserver(()=>{{if(!orphanedSidebar.isConnected)document.documentElement.append(orphanedSidebar);}}); legacySidebarObserver.observe(document,{{childList:true,subtree:true}})")
        background.js('chrome.runtime.reload(); true')
        wait(lambda: not any(item['type'] == 'service_worker' and extension_id in item['url'] for item in targets()))
        # CDP-installed extensions can become disabled on runtime.reload(). Reinstalling
        # re-enables it while retaining the page and the invalidated content-script DOM.
        browser.call('Extensions.uninstall', id=extension_id)
        extension_id = browser.call('Extensions.loadUnpacked', path=str(root / 'extension'))['id']
        background = worker(extension_id)
        action(extension_id)
        wait(lambda: page.js(f"({visible}) && {active_sidebar} !== orphanedSidebar"))
        assert page.js(f"{active_sidebar} !== orphanedSidebar && orphanedSidebar.hasAttribute('data-quickfill-retired') && getComputedStyle(orphanedSidebar).opacity === '0'")
        assert page.js("document.querySelectorAll('quickfill-sidebar:not([data-quickfill-retired])').length === 1 && document.querySelectorAll('quickfill-tools:not([data-quickfill-retired])').length === 1")
        preserved()
        page.js('legacySidebarObserver.disconnect()')
        locale = page.js(f"{active_sidebar}.shadowRoot.querySelector('.panel').lang")
        catalog = json.loads((root / 'extension' / '_locales' / locale / 'messages.json').read_text())
        settings_label = json.dumps(catalog['settings']['message'])
        page.js(f"Array.from({active_sidebar}.shadowRoot.querySelectorAll('button')).find(button=>button.getAttribute('aria-label') === {settings_label}).click()")
        assert page.js(f"!!{active_sidebar}.shadowRoot.querySelector('[data-global-suggestions]')")
        page.js(f"{active_sidebar}.shadowRoot.querySelector('.task-heading button').click(); {active_sidebar}.shadowRoot.querySelector('.search-row button').click()")
        assert page.js(f"!!{active_sidebar}.shadowRoot.querySelector('.entry-editor')")
        page.js(f"{active_sidebar}.shadowRoot.querySelector('.task-heading button').click()")
        assert page.js(f"!{active_sidebar}.shadowRoot.querySelector('.entry-editor')")
        print('PASS: extension reload recovery retires stale UI without reloading the page or losing form values', flush=True)

        # Hold bootstrap open while the real toolbar action attempts to contact it.
        background.js("globalThis.originalSidebarGet = chrome.storage.local.get.bind(chrome.storage.local); chrome.storage.local.get = (...args) => new Promise((resolve,reject) => setTimeout(()=>originalSidebarGet(...args).then(resolve,reject),700))")
        page.call('Page.reload')
        wait(lambda: page.js("document.readyState === 'complete' && !!document.querySelector('#display-name')"))
        page.js("window.sidebarDocumentMarker = 'same document'; document.querySelector('#display-name').value = 'Keep my unsaved text'")
        action(extension_id)
        wait(lambda: page.js(visible))
        background.js('chrome.storage.local.get = originalSidebarGet')
        preserved()
        assert page.js("document.querySelectorAll('quickfill-sidebar:not([data-quickfill-retired])').length === 1 && document.querySelectorAll('quickfill-tools:not([data-quickfill-retired])').length === 1")
        print('PASS: opening during delayed bootstrap waits for one initialized sidebar', flush=True)
        exceptions = [event['params']['exceptionDetails'] for event in page.events if event.get('method') == 'Runtime.exceptionThrown']
        assert not exceptions, exceptions
    finally:
        if close_browser:
            browser.call('Browser.close')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--keep-open', action='store_true')
    args = parser.parse_args()
    run(args.port, close_browser=not args.keep_open)
