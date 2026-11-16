"""Power-feature checks layered on the previous integration suites."""
import runpy,json,time
from pathlib import Path
state=runpy.run_path(str(Path(__file__).with_name('features_browser.py')))
page,worker,wait,send,labels,locale,js,click,storage,navigate,field,value=[state[k] for k in ['page','worker','wait','send','labels','locale','js','click','storage','navigate','field','value']]
entry={'id':'power','name':'Power profile','color':'#315de4','tags':['QA','Work'],'collection':'Project','values':{'email':'alex@example.com','phone':'+1 (555) 010-1234','first_name':'Alice','reference':'test-{{counter}}-{{uuid}}','created':'{{date}}'},'transforms':{'phone':{'type':'digits'}}}
second={'id':'personal','name':'Personal profile','color':'#ee8844','tags':['Personal'],'collection':'Personal','values':{'email':'home@example.com'}}
worker.js('chrome.storage.local.set({registry:'+json.dumps({'entries':[entry,second],'associations':{},'language':'auto','onboardingDone':True})+'})')
navigate('power.html');send('toggle');page.call('Page.bringToFront');page.call('Emulation.setFocusEmulationEnabled',enabled=True)
def preview_power():
    js("Array.from(s.querySelectorAll('article')).find(a=>a.querySelector('h2')?.textContent==='Power profile' && a.querySelector('.card-actions')).querySelector('.card-actions button').click()")
# Inline fill works with the sidebar closed, including a fixed transformation.
js("document.querySelector('#phone').focus();globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
wait(lambda:js("!!u.querySelector('.launcher')"));js("u.querySelector('.launcher').click()")
assert js("u.querySelector('.inline').textContent.includes('15550101234')")
js("u.querySelector('.inline .value').click()")
assert value('#phone')=='15550101234'
assert js("document.querySelector('quickfill-sidebar').style.display")=='none'
# Inline Escape and a cancelled input have specific feedback.
js("document.querySelector('#email').focus();document.querySelector('#cancel-input').click();u.querySelector('.launcher').click();u.querySelector('.inline .value').click()")
assert value('#email')==''
assert labels['inputCancelled'] in js("u.querySelector('[role=status]').textContent")
js("u.querySelector('.launcher').click();u.querySelector('.inline').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,composed:true}))")
assert js("!u.querySelector('.inline')")
# A preference change from another tab hides an already visible inline launcher.
js("document.querySelector('#phone').focus()")
wait(lambda:js("!!u.querySelector('.launcher')"))
signature=json.dumps(['http://localhost:8765','/tests/power.html','power','phone','text'],separators=(',',':'))
worker.js("chrome.storage.local.get('registry').then(({registry:r})=>{r.preferences={'http://localhost:8765':{width:380,suggestions:'button',preferredEntry:'',excluded:["+json.dumps(signature)+"]}};return chrome.storage.local.set({registry:r})})")
wait(lambda:js("!u.querySelector('.launcher')"))
worker.js("chrome.storage.local.get('registry').then(({registry:r})=>{r.preferences={};return chrome.storage.local.set({registry:r})})")
# Command palette resolves actions and supports focus trapping.
send('palette');assert js("!!u.querySelector('[role=dialog]')")
js("u.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,composed:true,cancelable:true}))")
assert js("u.activeElement===u.querySelector('.palette').lastElementChild")
js("u.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,composed:true,cancelable:true}))")
assert js("u.activeElement===u.querySelector('.palette input')")
js("u.querySelector('.palette input').value="+json.dumps(labels['fillWith'].replace('$A$', 'Power profile'))+";u.querySelector('.palette input').dispatchEvent(new Event('input'))")
js("u.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,composed:true}))")
assert js("u.activeElement===u.querySelector('.palette input') && !!u.querySelector('[aria-selected=true]')")
js("u.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true}))")
wait(lambda:js("!!s.querySelector('[data-empty-only]')"))
assert js("s.querySelector('[data-empty-only]').checked")
# Explicit mapping resolves an opaque field; transformations and generated values are previewed.
js("globalThis.refSelect=s.querySelector('[data-field-key][aria-label=\"opaque-reference\"]');refSelect.value=Array.from(refSelect.options).find(o=>o.textContent==='reference').value;refSelect.dispatchEvent(new Event('change'))")
preview=js("refSelect.closest('.pair').querySelector('.resolved').textContent")
assert preview.startswith('test-1-')
click('saveMapping');wait(lambda:bool(storage().get('mappings')))
click('applyForm');assert value('#opaque-reference')==preview
assert value('#first')=='Existing' # empty-only protects nonempty fields by default
assert value('#email')=='alex@example.com'
click('undo');assert value('#opaque-reference')==''
# Saved mappings survive navigation and detect a missing field.
navigate('power.html');field('#email');send('fill');preview_power();wait(lambda:js("!!s.querySelector('[data-empty-only]')"))
assert labels['savedMapping'] in js("s.querySelector('main').textContent")
next_preview=js("s.querySelector('[data-field-key][aria-label=\"opaque-reference\"]').closest('.pair').querySelector('.resolved').textContent")
assert next_preview.startswith('test-2-')
click('cancel');js("document.querySelector('#remove-reference').click()")
preview_power();wait(lambda:js("!!s.querySelector('[data-empty-only]')"))
assert labels['brokenMappings'].split('$A$')[0] in js("s.querySelector('main').textContent")
click('cancel')
# Generated single-value fill requires a preview and uses precisely that value.
field('#email')
js("s.querySelector('.search').value='reference';s.querySelector('.search').dispatchEvent(new Event('input'));s.querySelector('.value').click()")
wait(lambda:js("s.querySelector('main h2')?.textContent")==labels['reviewGenerated'])
# This generated reference is incompatible with email, with a useful error.
click('applyValue');assert labels['incompatibleValue'] in js("s.querySelector('.status').textContent")
click('cancel')
# Tags and collections filter together; duplication creates a separate editable copy.
click('filters')
js("s.querySelector('.search').value='';s.querySelector('.search').dispatchEvent(new Event('input'));s.querySelector('[data-collection-filter]').value='Project';s.querySelector('[data-collection-filter]').dispatchEvent(new Event('change'));s.querySelector('[data-tag-filter]').value='QA';s.querySelector('[data-tag-filter]').dispatchEvent(new Event('change'))")
assert js("s.querySelectorAll('article').length")==1
click('duplicate');js("s.querySelector('form input').value='Power copy';s.querySelector('form').requestSubmit()")
wait(lambda:len(storage()['entries'])==3)
copy=next(e for e in storage()['entries'] if e['name']=='Power copy')
assert copy['id']!='power';assert copy['tags']==['QA','Work'];assert copy['transforms']['phone']['type']=='digits'
# Template creates the intended key map without editing existing profiles.
click('newEntryButton');js("s.querySelector('[data-template]').value='address';s.querySelector('[data-template]').dispatchEvent(new Event('change'))")
assert js("Array.from(s.querySelectorAll('.pair input:not([data-format])')).map(e=>e.value).includes('postal_code')")
js("s.querySelector('form').requestSubmit()")
wait(lambda:len(storage()['entries'])==4)
# Website preferences change width, inline behavior, preferred ordering, and exclusions.
click('settings')
js("globalThis.f=s.querySelector('main form');f.querySelector('select').value='personal';f.querySelector('input[type=number]').value='500';f.querySelectorAll('select')[1].value='off';Array.from(f.querySelectorAll('details label')).find(l=>l.textContent==='Email').querySelector('input').click();f.requestSubmit()")
wait(lambda:storage().get('preferences',{}).get('http://localhost:8765',{}).get('width')==500)
assert '500px' in js("s.querySelector('.panel').style.width")
click('back');field('#email');send('fill')
# Clicking a saved value cannot bypass excluded fields.
js("s.querySelector('.search').value='alex@example.com';s.querySelector('.search').dispatchEvent(new Event('input'));s.querySelector('.value').click()")
assert labels['fieldExcluded'] in js("s.querySelector('.status').textContent")
navigate('power.html');assert '500px' in js("s.querySelector('.panel').style.width")
assert js("s.querySelector('article h2').textContent")=='Personal profile'
send('toggle');js("document.querySelector('#phone').focus();globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
assert js("!u.querySelector('.launcher')")
# Walkthrough creates an example, fills its sample, and remembers completion.
send('toggle');click('settings');click('walkthrough');click('createExample')
wait(lambda:js("!!s.querySelector('[data-practice]')"));click('fillSample');assert js("s.querySelector('[data-practice]').value")=='alex@example.com'
click('finishWalkthrough');wait(lambda:storage().get('onboardingDone'))
assert worker.js("chrome.commands.getAll().then(c=>c.some(x=>x.name==='command-palette' && x.shortcut))")
# Screenshot of the final interface for visual review.
import base64
Path('/tmp/quickfill-power.png').write_bytes(base64.b64decode(page.call('Page.captureScreenshot')['data']))
print('PASS: inline fill, detailed errors, palette, empty-only, saved/broken mappings, stable generation, templates, duplicate, tags/collections, website preferences/exclusions, onboarding')
