"""Integration test against an isolated Chrome with the unpacked extension loaded.
Requires websocket-client; Chrome CDP on localhost:9223 and repo served on :8765.
Only use a disposable profile: this test clears Quickfill storage in that profile.
"""
import json
import time
import sys
import urllib.request
import websocket
from pathlib import Path

class CDP:
    def __init__(self, target):
        self.ws = websocket.create_connection(target['webSocketDebuggerUrl'], origin='http://localhost:9223', timeout=10)
        self.seq = 0
        self.events = []
    def call(self, method, **params):
        self.seq += 1
        self.ws.send(json.dumps(dict(id=self.seq, method=method, params=params)))
        while True:
            message = json.loads(self.ws.recv())
            if 'method' in message:self.events.append(message)
            if message.get('id') == self.seq:
                assert 'error' not in message, message
                return message.get('result', {})
    def js(self, expression):
        result = self.call('Runtime.evaluate', expression=expression, awaitPromise=True, returnByValue=True)
        assert 'exceptionDetails' not in result, result
        return result.get('result', {}).get('value')

def targets():
    return json.load(urllib.request.urlopen('http://localhost:9223/json'))

def wait(fn):
    for _ in range(80):
        result = fn()
        if result:
            return result
        time.sleep(.1)
    print([event for event in page.events if event.get('method') == 'Runtime.exceptionThrown'][-5:])
    raise AssertionError('Timed out')

page = CDP(next(t for t in targets() if t['type'] == 'page'))
if len(sys.argv) > 1:
    page.call('ServiceWorker.enable')
    page.call('ServiceWorker.startWorker', scopeURL=f'chrome-extension://{sys.argv[1]}/')
worker_target = wait(lambda: next((t for t in targets() if t['url'].endswith('/background.js') and (len(sys.argv) < 2 or sys.argv[1] in t['url'])), None))
worker = CDP(worker_target)
page.call('Runtime.enable')
locale = sys.argv[2] if len(sys.argv) > 2 else 'en'
messages = json.loads((Path(__file__).parent / f'../extension/_locales/{locale}/messages.json').read_text())
labels = {key: item['message'] for key, item in messages.items()}
assert worker.js('chrome.runtime.getManifest().name') == labels['extensionName']
for key in ['menuFill', 'menuSave', 'toggleSidebar', 'toggleCommand']:
    assert worker.js(f'chrome.i18n.getMessage({json.dumps(key)})') == labels[key]
assert worker.js("chrome.i18n.getMessage('confirmDelete', 'Тест $1 <b>')") == labels['confirmDelete'].replace('$NAME$', 'Тест $1 <b>')
worker.js('chrome.storage.local.clear()')
page.call('Emulation.setDeviceMetricsOverride', width=1360, height=960, deviceScaleFactor=1, mobile=False)
page.call('Page.navigate', url='http://localhost:8765/tests/test.html')
wait(lambda: page.js("document.querySelector('#email') !== null"))
time.sleep(.5)
worker.js("chrome.tabs.query({active:true,currentWindow:true}).then(t=>globalThis.testTab=t[0].id)")
def send(kind):
    worker.js(f"chrome.tabs.sendMessage(testTab, {{type:{json.dumps(kind)}}}, {{frameId:0}})")

send('toggle')
wait(lambda: page.js("!!document.querySelector('quickfill-sidebar')"))
page.js(f'globalThis.labels={json.dumps(labels)}')
page.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot; globalThis.btn=t=>Array.from(s.querySelectorAll('button')).find(b=>b.textContent===t); btn(labels.newEntryButton).click()")
page.js("var f=s.querySelector('form'); f.querySelector('input').value='Work'; f.querySelector('input[type=color]').value='#ee8844'; f.querySelector('.pair input').value='email'; f.querySelector('.pair textarea').value='alex@example.com'; f.requestSubmit()")
wait(lambda: page.js("!!s.querySelector('.value')"))
assert worker.js("chrome.storage.local.get('registry').then(r=>r.registry.entries[0].color)") == '#ee8844'
page.js("document.querySelector('#email').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
send('fill')
assert page.js("s.querySelector('main').textContent.includes(labels.suggestedValues)")
page.js("s.querySelector('.value').click()")
assert page.js("document.querySelector('#email').value") == 'alex@example.com'
assert page.js("document.querySelector('#events').textContent.includes('change  email')")
# Use the extension's actual dragstart and drop handlers.
page.js("let d=new DataTransfer(); s.querySelector('.value').dispatchEvent(new DragEvent('dragstart',{dataTransfer:d,bubbles:true})); document.querySelector('#full-name').dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}))")
assert page.js("document.querySelector('#full-name').value") == 'alex@example.com'
page.js("document.querySelector('#custom').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
send('save')
page.js("var f=s.querySelector('form'); f.querySelector('input[required]').value='customer code'; f.requestSubmit()")
wait(lambda: worker.js("chrome.storage.local.get('registry').then(r=>r.registry.entries[0].values['customer code']==='ACME-42')"))
page.js("document.querySelector('#custom').value=''")
send('fill')
assert page.js("s.querySelector('.value span').textContent") == 'ACME-42'
page.js("s.querySelector('.value').click()")
assert page.js("document.querySelector('#custom').value") == 'ACME-42'
# Storage remains after navigation, and changes are available to the fresh content script.
page.call('Page.reload')
wait(lambda: page.js("document.readyState === 'complete'"))
time.sleep(.5)
send('toggle')
wait(lambda: page.js("!!document.querySelector('quickfill-sidebar')"))
assert page.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('main').textContent.includes('ACME-42')")
# A frame receives its own right-click action and fills its own input.
page.js("document.querySelector('iframe').contentDocument.querySelector('input').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
worker.js("chrome.tabs.sendMessage(testTab,{type:'fill'})")
assert page.js("!!document.querySelector('iframe').contentDocument.querySelector('quickfill-sidebar')")
page.js("document.querySelector('iframe').contentDocument.querySelector('quickfill-sidebar').shadowRoot.querySelector('.value').click()")
assert page.js("document.querySelector('iframe').contentDocument.querySelector('input').value") == 'alex@example.com'
print(f'Locale: {locale}')
print('PASS: real extension storage, entry creation/color, matching, fill events, drag/drop, save association, reload persistence, frame filling')
# Closing an editor resets the sidebar to its localized entry list.
page.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot")
page.js(f'globalThis.labels={json.dumps(labels)}')
assert page.js("s.querySelector('h1').textContent") == 'Quickfill'
page.js("Array.from(s.querySelectorAll('button')).find(b=>b.textContent===labels.edit).click()")
assert page.js("s.querySelector('main h2').textContent") == labels['editEntry']
send('toggle')
send('toggle')
assert page.js("s.querySelector('form') === null && !!s.querySelector('article')")
assert page.js("s.querySelector('.count').textContent") == labels['entryCount'].replace('$COUNT$', '1')
assert worker.js("chrome.commands.getAll().then(c=>c.find(x=>x.name==='toggle-sidebar').shortcut)") == 'Ctrl+B'
print('PASS: Ctrl+B command is registered (native shortcut activation requires a headed manual check)')
assert page.js("getComputedStyle(document.querySelector('quickfill-sidebar').shadowRoot.querySelector('.panel')).fontFamily.includes('system-ui')")
page.js('window.scrollTo(0,0)')
import base64
Path('/tmp/quickfill-test.png').write_bytes(base64.b64decode(page.call('Page.captureScreenshot')['data']))
