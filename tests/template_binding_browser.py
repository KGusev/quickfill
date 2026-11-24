"""Template binding regression. Uses a disposable Chrome on the supplied CDP port."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from sidebar_recovery_browser import CDP,wait
from urllib.request import urlopen
port=int(sys.argv[1]) if len(sys.argv)>1 else 9234
targets=lambda:json.load(urlopen(f'http://localhost:{port}/json'))
b=CDP(json.load(urlopen(f'http://localhost:{port}/json/version')),port)
ext=b.call('Extensions.loadUnpacked',path=str(Path(__file__).resolve().parent.parent/'extension'))['id']
tid=b.call('Target.createTarget',url=f'chrome-extension://{ext}/options.html')['targetId']
p=CDP(wait(lambda:next((t for t in targets() if t['id']==tid),None)),port)
wait(lambda:p.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot"))
assert p.js("[...document.querySelector('quickfill-sidebar').shadowRoot.querySelectorAll('.manager-nav button')].map(el=>el.dataset.view).join(',')")=='registry,templates,settings'
assert p.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('.manager-nav [aria-current=page]').dataset.view")=='registry'
p.js("chrome.storage.local.set({registry:{entries:[{id:'a',name:'Alice',color:'#315de4',values:{name:'Alice'}}],templates:[{id:'t',name:'Profile',fields:[{key:'name',type:'string'}]}],associations:{},language:'en',onboardingDone:true}})")
p.call('Page.reload')
wait(lambda:p.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=templates]')"))
p.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('button[data-view=templates]').click()")
wait(lambda:p.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('.template-settings')"))
p.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot;[...s.querySelectorAll('button')].find(b=>b.textContent==='Associate existing entries').click()")
def pointer_click(selector):
    point=p.js("(()=>{const el="+selector+";el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
    p.call('Input.dispatchMouseEvent',type='mousePressed',button='left',clickCount=1,**point)
    p.call('Input.dispatchMouseEvent',type='mouseReleased',button='left',clickCount=1,**point)
pointer_click("s.querySelector('.template-entry-choice span')")
assert p.js("s.querySelector('[type=checkbox]').checked && !s.querySelector('[data-action=associateEntries]').disabled")
p.js("s.querySelector('form').addEventListener('submit',event=>event.stopImmediatePropagation(),true)")
pointer_click("s.querySelector('[data-action=associateEntries]')")

wait(lambda:p.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries[0].templateId==='t')"))
wait(lambda:p.js("!!s.querySelector('.template-settings .chip')"))
# Add a typed field that rejects empty values, then bind through the entry editor.
p.js("chrome.storage.local.get('registry').then(({registry})=>{registry.templates.push({id:'typed',name:'Typed',fields:[{key:'active',type:'bool'}]});return chrome.storage.local.set({registry});})")
p.js("s.querySelector('.template-settings .chip').click()")
p.js("s.querySelector('[data-template]').value='typed';s.querySelector('[data-template]').dispatchEvent(new Event('change'))")
assert p.js("s.querySelectorAll('.value-row').length===2"), 'Missing template field is not shown'
p.js("s.querySelector('form').requestSubmit()")
wait(lambda:p.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries[0].templateId==='typed')"))
assert p.js("chrome.storage.local.get('registry').then(({registry})=>JSON.stringify(registry.entries[0].values))")=='{"name":"Alice"}'
wait(lambda:p.js("!!s.querySelector('[data-unfilled-key=active]')"))
pointer_click("s.querySelector('[data-unfilled-key=active]')")
assert p.js("!!s.querySelector('[data-template-placeholder=active]')")
p.js("const row=s.querySelector('[data-template-placeholder=active]');row.querySelector('[data-value-input]').value='true';s.querySelector('form').requestSubmit()")
wait(lambda:p.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries[0].values.active==='true')"))
assert p.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries[0].types.active==='bool')")
assert p.js("!s.querySelector('[data-unfilled-key=active]')")
p.call('Page.reload')
wait(lambda:p.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('[data-view=templates]')"))
p.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('button[data-view=templates]').click()")
wait(lambda:p.js("!!document.querySelector('quickfill-sidebar')?.shadowRoot.querySelector('.template-settings')"))
assert p.js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('.template-settings').textContent.includes('Alice')")
p.js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot;[...s.querySelectorAll('.template-settings article')].find(el=>el.querySelector('h3').textContent==='Typed').querySelector('.section-heading button').click()")
p.js("s.querySelector('.template-editor>button').click()")
p.js("s.querySelectorAll('.template-field input')[1].value='name';s.querySelectorAll('.field-grip')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))")
assert p.js("[...s.querySelectorAll('.template-field input')].map(el=>el.value).join(',')")=='name,active'
# Drag rows in both directions; the drop position must control saved order.
p.js("globalThis.dt=new DataTransfer();let rows=s.querySelectorAll('.template-field');rows[0].querySelector('.field-grip').dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));let r=rows[1].getBoundingClientRect();rows[1].dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,clientY:r.bottom-1,bubbles:true,cancelable:true}));rows[1].dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}))")
assert p.js("[...s.querySelectorAll('.template-field input')].map(el=>el.value).join(',')")=='active,name'
p.js("s.querySelectorAll('.field-grip')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))")
p.call('Emulation.setDeviceMetricsOverride',width=1440,height=900,deviceScaleFactor=1,mobile=False)
assert p.js("s.querySelector('main').getBoundingClientRect().width>1300"), 'Template editor is capped'
p.call('Emulation.setDeviceMetricsOverride',width=390,height=844,deviceScaleFactor=1,mobile=False)
assert p.js("s.querySelector('main').scrollWidth<=s.querySelector('main').clientWidth"), 'Template editor overflows'
p.call('Emulation.setDeviceMetricsOverride',width=1440,height=900,deviceScaleFactor=1,mobile=False)
pointer_click("s.querySelector('.template-field .danger')")
# Restore the removed field before saving, and order it first.
p.js("s.querySelector('.template-editor>button').click();s.querySelectorAll('.template-field input')[1].value='name';s.querySelectorAll('.field-grip')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))")
p.js("s.querySelector('.template-editor').requestSubmit()")
wait(lambda:p.js("chrome.storage.local.get('registry').then(({registry})=>registry.templates.find(t=>t.id==='typed').fields[0].key==='name')"))
wait(lambda:p.js("!!s.querySelector('.template-settings .chip')"))
p.js("s.querySelector('.template-settings .chip').click()")
assert p.js("[...s.querySelectorAll('.value-row>td:first-child input')].map(el=>el.value).join(',')")=='name,active'
p.call('Emulation.setDeviceMetricsOverride',width=390,height=844,deviceScaleFactor=1,mobile=False)
assert p.js("s.querySelector('main').scrollWidth<=s.querySelector('main').clientWidth"), 'Horizontal overflow'
b.call('Target.closeTarget',targetId=tid)
b.call('Extensions.uninstall',id=ext)
print('PASS: template tabs, responsive editor, drag and keyboard ordering, binding and persistence')
