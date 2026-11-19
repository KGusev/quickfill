"""Persistent left/right sidebar position checks in a disposable Chrome profile.

Usage: python3 tests/sidebar_position_browser.py [--port 9223] [--extension-id ID] [--locale en|ru]
The local repository server must run on :8765. Without an extension ID, Chrome
needs --enable-unsafe-extension-debugging. This test replaces extension storage
and closes its own tabs; the caller owns the disposable browser process.
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
    tabs = []
    clients = []
    labels = {key: item['message'] for key, item in json.loads((root / 'extension' / '_locales' / locale / 'messages.json').read_text()).items()}

    def create_page(url='about:blank'):
        target_id = browser.call('Target.createTarget', url=url)['targetId']
        tabs.append(target_id)
        page = CDP(wait(lambda: next((item for item in targets() if item['id'] == target_id), None)), port)
        clients.append(page)
        page.call('Runtime.enable')
        page.call('Emulation.setDeviceMetricsOverride', width=1360, height=960, deviceScaleFactor=1, mobile=False)
        page.call('Emulation.setFocusEmulationEnabled', enabled=True)
        return page

    def bind(page):
        wait(lambda: page.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-action=sidebarSide]')"))
        page.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot")

    def geometry(page, side, width=380):
        wait(lambda: page.js("(()=>{const panel=s.querySelector('.panel'),r=panel.getBoundingClientRect(),viewport=document.documentElement.clientWidth;return panel.dataset.side === " + json.dumps(side) + f" && Math.abs(r.width-Math.min({width},viewport))<2 && Math.abs(r.top)<2 && Math.abs(r.height-innerHeight)<2 && Math.abs(" + ('r.left' if side == 'left' else 'r.right-viewport') + ")<2;})()"))

    def header_fits(page):
        result = page.js("(()=>{const panel=s.querySelector('.panel').getBoundingClientRect(),buttons=[...s.querySelectorAll('.header-controls button')].filter(button=>button.checkVisibility());return buttons.map(button=>{const r=button.getBoundingClientRect();return {label:button.getAttribute('aria-label'),left:r.left,right:r.right,top:r.top,bottom:r.bottom};}).filter(r=>r.left<panel.left-1||r.right>panel.right+1||r.top<panel.top-1||r.bottom>panel.bottom+1);})()")
        assert not result, result
        assert page.js("(()=>{const brand=s.querySelector('.brand').getBoundingClientRect(),controls=s.querySelector('.header-controls').getBoundingClientRect();return controls.top>=brand.bottom-1 || brand.right<=controls.left+1;})()"), 'Header controls overlap the brand'

    def screenshot(page, name):
        image = page.call('Page.captureScreenshot', format='png')['data']
        Path('/tmp/quickfill-sidebar-position-' + locale + '-' + name + '.png').write_bytes(base64.b64decode(image))

    page = create_page()
    worker = None
    try:
        page.call('ServiceWorker.enable')
        page.call('ServiceWorker.startWorker', scopeURL=f'chrome-extension://{extension_id}/')
        worker = CDP(wait(lambda: next((item for item in targets() if item['type'] == 'service_worker' and extension_id in item['url']), None)), port)
        wait(lambda: worker.js("typeof chrome !== 'undefined' && !!chrome.runtime?.id"))
        fixture = {'entries': [], 'associations': {}, 'preferences': {}, 'globalPreferences': {'suggestions': 'off'}, 'language': locale, 'onboardingDone': True}
        worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')

        def stored():
            return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

        def current_tab(client):
            client.call('Page.bringToFront')
            return worker.js("chrome.tabs.query({active:true,currentWindow:true}).then(t=>t[0].id)")

        def send(tab_id, kind='toggle'):
            worker.js(f"chrome.tabs.sendMessage({tab_id},{{type:{json.dumps(kind)}}},{{frameId:0}})")

        page.call('Page.navigate', url='http://localhost:8765/tests/controls.html?sidebar-position=primary')
        wait(lambda: page.js("!!document.querySelector('#display-name') && !!document.querySelector('quickfill-tools')"))
        page.js("document.querySelector('#display-name').value='Keep the page value';document.querySelector('#display-name').focus()")
        tab_id = current_tab(page)
        send(tab_id)
        bind(page)
        geometry(page, 'right')
        header_fits(page)
        assert page.js("s.querySelector('[data-action=sidebarSide]').getAttribute('aria-label')") == labels['moveSidebarLeft']
        initial_icon = page.js("s.querySelector('[data-action=sidebarSide] svg path').getAttribute('d')")

        # Moving the panel changes placement only, including when a draft is open.
        page.js("s.querySelector('.search-row button').click();globalThis.draftForm=s.querySelector('.entry-editor');draftForm.querySelector('input').value='Unsaved position draft';draftForm.querySelector('.values-table td:first-child input').value='email';draftForm.querySelector('[data-value-input]').value='draft@example.com';s.querySelector('[data-action=sidebarSide]').click()")
        wait(lambda: stored()['globalPreferences'].get('sidebarSide') == 'left')
        geometry(page, 'left')
        assert stored()['globalPreferences']['suggestions'] == 'off'
        assert page.js("s.querySelector('.entry-editor') === draftForm && draftForm.querySelector('input').value === 'Unsaved position draft' && draftForm.querySelector('[data-value-input]').value === 'draft@example.com'")
        assert page.js("document.querySelector('#display-name').value === 'Keep the page value'")
        assert page.js("s.querySelector('[data-action=sidebarSide]').title") == labels['moveSidebarRight']
        assert page.js("s.querySelector('[data-action=sidebarSide] svg path').getAttribute('d')") != initial_icon
        screenshot(page, 'left-draft')

        other = create_page('http://127.0.0.1:8765/tests/controls.html?sidebar-position=other')
        wait(lambda: other.js("!!document.querySelector('quickfill-tools')"))
        other_tab = current_tab(other)
        send(other_tab)
        bind(other)
        geometry(other, 'left')

        # Native button activation works with Enter and updates another open tab.
        page.call('Page.bringToFront')
        wait(lambda: page.js("!s.querySelector('[data-action=sidebarSide]').disabled"))
        page.js("s.querySelector('[data-action=sidebarSide]').focus()")
        assert page.js("s.activeElement === s.querySelector('[data-action=sidebarSide]')"), 'Position button could not receive focus'
        page.call('Input.dispatchKeyEvent', type='keyDown', key='Enter', code='Enter', text='\r', unmodifiedText='\r', windowsVirtualKeyCode=13)
        page.call('Input.dispatchKeyEvent', type='keyUp', key='Enter', code='Enter', windowsVirtualKeyCode=13)
        wait(lambda: stored()['globalPreferences'].get('sidebarSide') == 'right')
        wait(lambda: other.js("s.querySelector('.panel').dataset.side === 'right'"))
        geometry(page, 'right')
        geometry(other, 'right')
        assert page.js("s.activeElement === s.querySelector('[data-action=sidebarSide]')")
        assert page.js("s.querySelector('.entry-editor') === draftForm && draftForm.querySelector('[data-value-input]').value === 'draft@example.com'")
        page.js("s.querySelector('[data-action=sidebarSide]').click()")
        wait(lambda: stored()['globalPreferences'].get('sidebarSide') == 'left')

        # Fullscreen is independent of the chosen dock side and preserves the draft.
        page.js("s.querySelector('[data-action=fullscreen]').click()")
        assert page.js("s.querySelector('.panel').classList.contains('fullscreen') && !s.querySelector('[data-action=sidebarSide]').checkVisibility()")
        assert page.js("Math.abs(s.querySelector('.panel').getBoundingClientRect().width-document.documentElement.clientWidth)<2")
        page.js("s.querySelector('[data-action=fullscreen]').click()")
        geometry(page, 'left')
        assert page.js("s.querySelector('.entry-editor') === draftForm")
        send(tab_id)
        assert page.js("document.querySelector('quickfill-sidebar').style.display === 'none'")
        send(tab_id)
        geometry(page, 'left')
        page.call('Page.reload')
        wait(lambda: page.js("!!document.querySelector('quickfill-tools')"))
        send(tab_id)
        bind(page)
        geometry(page, 'left')

        # A 320px sidebar must fit its icon controls and keep its menu onscreen.
        worker.js("chrome.storage.local.get('registry').then(({registry})=>chrome.storage.local.set({registry:{...registry,preferences:{...registry.preferences,'http://localhost:8765':{width:320}}}}))")
        wait(lambda: page.js("Math.abs(s.querySelector('.panel').getBoundingClientRect().width-320)<2"))
        for viewport in [1360, 320]:
            page.call('Emulation.setDeviceMetricsOverride', width=viewport, height=850, deviceScaleFactor=1, mobile=False)
            for side in ['left', 'right']:
                if stored()['globalPreferences']['sidebarSide'] != side:
                    page.js("s.querySelector('[data-action=sidebarSide]').click()")
                    wait(lambda: stored()['globalPreferences']['sidebarSide'] == side)
                geometry(page, side, 320)
                header_fits(page)
                page.js("s.querySelector('.header-controls .menu-wrap>button').click()")
                assert page.js("(()=>{const r=s.querySelector('.header-controls .menu-list').getBoundingClientRect();return r.left>=-1 && r.right<=innerWidth+1;})()"), (viewport, side)
                page.js("s.querySelector('.header-controls .menu-wrap>button').click()")
            screenshot(page, str(viewport) + '-header')

        # The full-tab manager stays full width and offers no docking toggle.
        options = create_page(f'chrome-extension://{extension_id}/options.html')
        wait(lambda: options.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=settings]')"))
        options.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot")
        assert options.js("!s.querySelector('[data-action=sidebarSide]')")
        page.js("s.querySelector('[data-action=sidebarSide]').click()")
        wait(lambda: stored()['globalPreferences']['sidebarSide'] == 'left')
        assert options.js("(()=>{const r=s.querySelector('.panel').getBoundingClientRect();return Math.abs(r.left)<2 && Math.abs(r.width-innerWidth)<2;})()")
        assert stored()['globalPreferences']['suggestions'] == 'off'
        for client in clients:
            assert not [event for event in client.events if event.get('method') == 'Runtime.exceptionThrown'], 'Unexpected page exception'
        print('PASS: sidebar left/right geometry, keyboard toggle, saved position, cross-tab sync, draft preservation, fullscreen restoration, compact header/menu and independent options layout', flush=True)
    finally:
        for target_id in reversed(tabs):
            browser.call('Target.closeTarget', targetId=target_id)
        for client in clients + [worker, browser]:
            if client:
                client.ws.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9223)
    parser.add_argument('--extension-id')
    parser.add_argument('--locale', choices=['en', 'ru'], default='en')
    args = parser.parse_args()
    run(args.port, args.extension_id, args.locale)
