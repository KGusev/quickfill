"""Drag and keyboard sidebar-resize checks in a disposable Chrome profile.

Usage: python3 tests/sidebar_resize_browser.py [--port 9223] [--extension-id ID] [--locale en|ru]
Requires the local repository server on :8765. This test replaces extension
storage and closes its own tabs; the caller owns the disposable browser.
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
    clients, tab_targets = [], []
    labels = {key: item['message'] for key, item in json.loads((root / 'extension' / '_locales' / locale / 'messages.json').read_text()).items()}

    def create_page(url='about:blank'):
        target_id = browser.call('Target.createTarget', url=url)['targetId']
        tab_targets.append(target_id)
        client = CDP(wait(lambda: next((item for item in targets() if item['id'] == target_id), None)), port)
        clients.append(client)
        client.call('Runtime.enable')
        client.call('Emulation.setDeviceMetricsOverride', width=1360, height=960, deviceScaleFactor=1, mobile=False)
        client.call('Emulation.setFocusEmulationEnabled', enabled=True)
        return client

    page, worker = create_page(), None
    try:
        page.call('ServiceWorker.enable')
        page.call('ServiceWorker.startWorker', scopeURL=f'chrome-extension://{extension_id}/')
        worker = CDP(wait(lambda: next((item for item in targets() if item['type'] == 'service_worker' and extension_id in item['url']), None)), port)
        wait(lambda: worker.js("typeof chrome !== 'undefined' && !!chrome.runtime?.id"))
        site = 'http://localhost:8765'
        fixture = {'entries': [], 'associations': {}, 'preferences': {site: {'width': 380, 'suggestions': 'inherit', 'preferredEntry': 'retained', 'excluded': ['retained-field']}},
                   'globalPreferences': {'suggestions': 'off', 'sidebarSide': 'right'}, 'language': locale, 'onboardingDone': True}
        worker.js('chrome.storage.local.set({registry:' + json.dumps(fixture) + '})')

        def stored():
            return worker.js("chrome.storage.local.get('registry').then(({registry})=>registry)")

        def width(client, value):
            try:
                wait(lambda: client.js(f"Math.abs(s.querySelector('.panel').getBoundingClientRect().width-Math.min({value},document.documentElement.clientWidth))<2"))
            except AssertionError:
                print('Resize diagnostic:', value, client.js("({actual:s.querySelector('.panel').getBoundingClientRect().width,handle:s.querySelector('[data-action=resizeSidebar]')?.outerHTML})"), flush=True)
                print('Page exceptions:', [event['params'] for event in client.events if event.get('method') == 'Runtime.exceptionThrown'], flush=True)
                raise

        def saved(value):
            wait(lambda: stored()['preferences'][site]['width'] == value)
            width(page, value)

        def toggle(tab_id):
            worker.js(f"chrome.tabs.sendMessage({tab_id},{{type:'toggle'}},{{frameId:0}})")

        def bind(client):
            wait(lambda: client.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-action=resizeSidebar]')"))
            client.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot")

        def open_sidebar(client):
            wait(lambda: client.js("!!document.querySelector('quickfill-tools')"))
            client.call('Page.bringToFront')
            tab_id = worker.js("chrome.tabs.query({active:true,currentWindow:true}).then(t=>t[0].id)")
            toggle(tab_id)
            bind(client)
            return tab_id

        def press(client):
            client.call('Page.bringToFront')
            point = client.js("(()=>{const r=s.querySelector('[data-action=resizeSidebar]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()")
            client.call('Input.dispatchMouseEvent', type='mouseMoved', **point)
            client.call('Input.dispatchMouseEvent', type='mousePressed', button='left', buttons=1, clickCount=1, **point)
            return point

        def move(client, point):
            client.call('Input.dispatchMouseEvent', type='mouseMoved', button='left', buttons=1, **point)

        def release(client, point):
            client.call('Input.dispatchMouseEvent', type='mouseReleased', button='left', buttons=0, clickCount=1, **point)

        def drag(client, delta):
            point = press(client)
            point['x'] += delta
            move(client, point)
            release(client, point)

        def key(client, name, modifiers=0):
            client.call('Input.dispatchKeyEvent', type='keyDown', key=name, code=name, modifiers=modifiers)
            client.call('Input.dispatchKeyEvent', type='keyUp', key=name, code=name, modifiers=modifiers)

        page.call('Page.navigate', url=site + '/tests/controls.html?sidebar-resize=primary')
        tab_id = open_sidebar(page)
        width(page, 380)
        assert page.js("(()=>{const h=s.querySelector('[data-action=resizeSidebar]');return h.getAttribute('role')==='separator' && h.getAttribute('aria-orientation')==='vertical' && h.tabIndex===0;})()")
        page.js("document.querySelector('#display-name').value='Keep the source value';s.querySelector('.search-row button').click();globalThis.resizeDraft=s.querySelector('.entry-editor');resizeDraft.querySelector('input').value='Keep this draft';resizeDraft.querySelector('.values-table td:first-child input').value='email';resizeDraft.querySelector('[data-value-input]').value='draft@example.com'")
        point = press(page)
        point['x'] -= 120
        move(page, point)
        width(page, 500)
        assert stored()['preferences'][site]['width'] == 380, 'Pointer moves must not persist intermediate widths'
        release(page, point)
        saved(500)
        assert page.js("s.querySelector('.entry-editor')===resizeDraft && resizeDraft.querySelector('input').value==='Keep this draft' && resizeDraft.querySelector('[data-value-input]').value==='draft@example.com' && document.querySelector('#display-name').value==='Keep the source value'")
        assert stored()['preferences'][site] == {**fixture['preferences'][site], 'width': 500}
        assert stored()['globalPreferences'] == fixture['globalPreferences']

        same = create_page(site + '/tests/controls.html?sidebar-resize=same-origin')
        open_sidebar(same)
        width(same, 500)
        other = create_page('http://127.0.0.1:8765/tests/controls.html?sidebar-resize=other-origin')
        open_sidebar(other)
        width(other, 380)
        # Move beyond the panel after reaching its maximum: pointer capture must
        # still deliver release, including when it happens over the website.
        point = press(page)
        point['x'] = 10
        move(page, point)
        width(page, 640)
        release(page, point)
        saved(640)
        width(same, 640)
        width(other, 380)
        point = press(page)
        point['x'] = page.js('document.documentElement.clientWidth-1')
        move(page, point)
        width(page, 320)
        release(page, point)
        saved(320)

        # The grip follows the inner edge, reversing the physical drag direction.
        page.js("s.querySelector('[data-action=sidebarSide]').click()")
        wait(lambda: page.js("s.querySelector('.panel').dataset.side==='left'"))
        assert page.js("(()=>{const h=s.querySelector('[data-action=resizeSidebar]').getBoundingClientRect(),p=s.querySelector('.panel').getBoundingClientRect();return Math.abs(h.right-p.right)<2;})()")
        drag(page, 130)
        saved(450)
        width(same, 450)
        page.js("s.querySelector('[data-action=resizeSidebar]').focus()")
        key(page, 'ArrowRight')
        saved(460)
        key(page, 'ArrowRight', modifiers=8)
        saved(510)
        key(page, 'Home')
        saved(320)
        key(page, 'End')
        saved(640)

        point = press(page)
        point['x'] -= 140
        move(page, point)
        width(page, 500)
        key(page, 'Escape')
        release(page, point)
        width(page, 640)
        assert stored()['preferences'][site]['width'] == 640
        assert page.js("document.querySelector('quickfill-sidebar').style.display !== 'none' && s.querySelector('.entry-editor')===resizeDraft")
        point = press(page)
        point['x'] -= 100
        move(page, point)
        width(page, 540)
        page.js("s.querySelector('[data-action=resizeSidebar]').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))")
        release(page, point)
        width(page, 640)
        assert stored()['preferences'][site]['width'] == 640
        screenshot = page.call('Page.captureScreenshot', format='png')['data']
        Path('/tmp/quickfill-sidebar-resize-' + locale + '.png').write_bytes(base64.b64decode(screenshot))
        point = press(page)
        release(page, point)
        page.call('Input.dispatchMouseEvent', type='mousePressed', button='left', buttons=1, clickCount=2, **point)
        page.call('Input.dispatchMouseEvent', type='mouseReleased', button='left', buttons=0, clickCount=2, **point)
        saved(380)
        page.js("s.querySelector('[data-action=resizeSidebar]').focus()")
        key(page, 'End')
        saved(640)

        # The numeric setting reflects the saved width without discarding other
        # drafts. A locally edited number survives a resize from another tab.
        page.js("Array.from(s.querySelectorAll('.header-controls button')).find(b=>b.getAttribute('aria-label')===" + json.dumps(labels['settings']) + ').click()')
        assert page.js("s.querySelector('input[type=number]').value==='640'")
        page.js("s.querySelector('[data-site-suggestions]').value='button';s.querySelector('[data-site-suggestions]').dispatchEvent(new Event('change',{bubbles:true}));s.querySelector('form input[type=checkbox]').click()")
        drag(page, -100)
        saved(540)
        assert page.js("s.querySelector('input[type=number]').value==='540'")
        assert page.js("s.querySelector('[data-site-suggestions]').value==='button' && !s.querySelector('form input[type=checkbox]').checked")
        assert stored()['preferences'][site] == {**fixture['preferences'][site], 'width': 540}
        page.js("s.querySelector('input[type=number]').value='560';s.querySelector('input[type=number]').dispatchEvent(new Event('input',{bubbles:true}))")
        width(same, 540)
        drag(same, -40)
        saved(500)
        assert page.js("s.querySelector('input[type=number]').value==='560'")

        page.js("s.querySelector('[data-action=fullscreen]').click()")
        assert page.js("!s.querySelector('[data-action=resizeSidebar]').checkVisibility()")
        page.js("s.querySelector('[data-action=fullscreen]').click()")
        width(page, 500)
        toggle(tab_id)
        toggle(tab_id)
        width(page, 500)
        page.call('Page.reload')
        wait(lambda: page.js("!!document.querySelector('quickfill-tools')"))
        toggle(tab_id)
        bind(page)
        width(page, 500)
        page.call('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=1, mobile=False)
        width(page, 500)
        page.js("s.querySelector('[data-action=resizeSidebar]').focus()")
        key(page, 'Home')
        saved(320)
        key(page, 'End')
        capped = page.js('document.documentElement.clientWidth')
        saved(capped)
        page.call('Emulation.setDeviceMetricsOverride', width=320, height=844, deviceScaleFactor=1, mobile=False)
        wait(lambda: page.js("!s.querySelector('[data-action=resizeSidebar]').checkVisibility() || s.querySelector('[data-action=resizeSidebar]').getAttribute('aria-disabled')==='true'"))
        assert page.js("s.querySelector('.panel').getBoundingClientRect().right<=document.documentElement.clientWidth+1")
        options = create_page(f'chrome-extension://{extension_id}/options.html')
        wait(lambda: options.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=settings]')"))
        assert options.js("!document.querySelector('quickfill-sidebar').shadowRoot.querySelector('[data-action=resizeSidebar]')")
        for client in clients:
            assert not [event for event in client.events if event.get('method') == 'Runtime.exceptionThrown'], 'Unexpected page exception'
        print('PASS: live grip resizing on both sides, pointer capture/cancel, keyboard limits, website-scoped persistence, draft retention, settings sync and fullscreen/viewport bounds', flush=True)
    finally:
        for target_id in reversed(tab_targets):
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
