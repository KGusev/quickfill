"""Load the local extension and run all browser checks in an already-started disposable Chrome.
Usage: python3 tests/run-browser.py [en|ru]
Requires localhost:9223 CDP, localhost:8765 repo server, and tests/vendor fixtures.
The test profile's extension data is cleared, then the extension is reinstalled for
sidebar recovery checks. The test browser is closed on completion.
"""
import json
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen
import websocket
root=Path(__file__).resolve().parent.parent
locale=sys.argv[1] if len(sys.argv)>1 else 'en'
if locale not in ['en','ru']:
    raise SystemExit('Expected en or ru')
info=json.load(urlopen('http://localhost:9223/json/version'))
ws=websocket.create_connection(info['webSocketDebuggerUrl'],origin='http://localhost:9223')
try:
    ws.send(json.dumps({'id':1,'method':'Extensions.loadUnpacked','params':{'path':str(root/'extension')}}))
    result=json.loads(ws.recv())
    if 'error' in result:raise RuntimeError(result['error'])
    subprocess.run([sys.executable,str(root/'tests/typed_browser.py'),result['result']['id'],locale],check=True,cwd=root)
    subprocess.run([sys.executable,str(root/'tests/sidebar_position_browser.py'),'--extension-id',result['result']['id'],'--locale',locale],check=True,cwd=root)
    subprocess.run([sys.executable,str(root/'tests/sidebar_resize_browser.py'),'--extension-id',result['result']['id'],'--locale',locale],check=True,cwd=root)
    subprocess.run([sys.executable,str(root/'tests/options_browser.py'),'--extension-id',result['result']['id'],'--locale',locale],check=True,cwd=root)
    subprocess.run([sys.executable,str(root/'tests/sidebar_recovery_browser.py'),'--keep-open'],check=True,cwd=root)
finally:
    ws.send(json.dumps({'id':2,'method':'Browser.close'}))
    ws.close()
