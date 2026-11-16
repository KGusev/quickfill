"""UI redesign regression checks, layered over real extension integration tests."""
import runpy,json,base64,time
from pathlib import Path
state=runpy.run_path(str(Path(__file__).with_name('autofill_browser.py')))
page,worker,wait,send,js,navigate,value=[state[k] for k in ['page','worker','wait','send','js','navigate','value']]
# The underlying power suite exports its locale-aware helpers.
locale=state['state']['locale'];labels=state['state']['labels'];click=state['state']['click']
fixture={'entries':[{'id':'work','name':'Work profile','color':'#315de4','pinned':True,'tags':['QA'],'collection':'Project','values':{'email':'qa@example.com','email_address':'alternate@example.com','notes':'A long saved value. '*30}}, {'id':'home','name':'Personal','color':'#ce4774','values':{'email':'home@example.com'}}], 'associations':{},'language':'auto','onboardingDone':True}
worker.js('chrome.storage.local.set({registry:'+json.dumps(fixture)+'})')
navigate('power.html');page.call('Page.bringToFront');page.call('Emulation.setFocusEmulationEnabled',enabled=True)
folder=Path('/tmp/quickfill-polish-'+locale+'-screens');folder.mkdir(exist_ok=True)
def screenshot(name):
    (folder/(name+'.png')).write_bytes(base64.b64decode(page.call('Page.captureScreenshot')['data']))
def key(name):
    page.call('Input.dispatchKeyEvent',type='keyDown',key=name,code=name,windowsVirtualKeyCode={'Escape':27,'Enter':13,'ArrowDown':40,'ArrowUp':38}.get(name,0))
    page.call('Input.dispatchKeyEvent',type='keyUp',key=name,code=name)
def enter(selector,text):
    js('(()=>{const el=s.querySelector('+json.dumps(selector)+');el.value='+json.dumps(text)+';el.dispatchEvent(new Event("input",{bubbles:true}));})()')
# Accessible disclosure menus: keyboard travel and Escape close the menu first.
js("s.querySelector('article .menu-wrap button').click()")
assert js("s.activeElement===s.querySelector('article .menu-list button')")
key('ArrowDown');assert js("s.activeElement===s.querySelector('article .menu-list button:nth-child(2)')")
key('Escape');assert js("s.querySelector('article .menu-list').hidden && document.querySelector('quickfill-sidebar').style.display!=='none'")
# Filters have a disclosure, removable chips, and a useful no-results recovery.
click('filters');js("s.querySelector('[data-tag-filter]').value='QA';s.querySelector('[data-tag-filter]').dispatchEvent(new Event('change'))")
assert js("s.querySelectorAll('article').length===1 && !!s.querySelector('.chip')")
enter('.search','qa@example.com');assert js("s.querySelector('.value mark').textContent==='qa@example.com'")
enter('.search','no such value');click('clearFilters');assert js("s.querySelectorAll('article').length===2")
screenshot('registry')
# Draft survives Back, Settings, hide/reopen and retains unsaved fields and options.
click('newEntryButton');enter('form input','Draft profile');enter('.pair input','test_key');enter('.pair textarea','unsaved value')
assert js("!s.querySelector('.search').checkVisibility()")
click('back');click('settings');click('back');send('toggle');send('toggle');click('resumeDraft')
assert js("s.querySelector('form input').value==='Draft profile' && s.querySelector('.pair textarea').value==='unsaved value'")
# Duplicate-key validation is associated with the actual input and clears on correction.
click('addValue')
js("globalThis.pairs=s.querySelectorAll('form .pair');pairs[1].querySelector('input').value='test_key';s.querySelector('form').requestSubmit()")
assert js("!!s.querySelector('[aria-invalid=true]') && !!s.querySelector('.field-error')")
js("pairs[1].querySelector('input').value='another_key';pairs[1].querySelector('input').dispatchEvent(new Event('input'))")
assert js("!s.querySelector('[aria-invalid=true]')")
screenshot('editor');click('cancel');assert js("!s.querySelector('.resume')")
# Save a new profile directly from a field; existing-key replacement displays both values.
js("document.querySelector('#email').value='new@example.com';document.querySelector('#email').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))")
send('save');js("s.querySelector('main select').value='__new';s.querySelector('main select').dispatchEvent(new Event('change'))")
enter('form input','New from field');js("s.querySelector('form').requestSubmit()")
wait(lambda:worker.js("chrome.storage.local.get('registry').then(({registry:r})=>r.entries.some(e=>e.name==='New from field'&&e.values.email==='new@example.com'))"))
send('save');assert js("s.querySelector('.replacement').textContent.includes('qa@example.com') && s.querySelector('.replacement').textContent.includes('new@example.com')")
screenshot('replacement');click('cancel')
# Form review groups ambiguous matches, hides settled rows on request, and counts actionable fills.
js("document.querySelector('#email').value='';Array.from(s.querySelectorAll('article')).find(a=>a.querySelector('h2').textContent==='Work profile').querySelector('.card-actions button').click()")
wait(lambda:js("!!s.querySelector('.preview-summary')"))
assert js("!!s.querySelector('.ambiguous') && s.querySelector('[data-action=applyForm]').disabled")
js("s.querySelectorAll('main .check input')[1].click()")
assert js("Array.from(s.querySelectorAll('.preview-rows>.pair')).filter(e=>!e.hidden).every(e=>e.classList.contains('ambiguous'))")
js("s.querySelector('.ambiguous select').value='0';s.querySelector('.ambiguous select').dispatchEvent(new Event('change'))")
assert js("!s.querySelector('[data-action=applyForm]').disabled && s.querySelector('[data-action=applyForm]').textContent.includes('1')")
js("s.querySelectorAll('main .check input')[1].click()")
screenshot('preview');click('cancel')
# Import details are expandable; selected duplicate handling updates the summary before mutation.
click('importData');incoming={'version':1,'entries':[fixture['entries'][0]],'associations':{}}
enter('main textarea',json.dumps(incoming));click('previewImport')
assert js("!!s.querySelector('article details:not([open])')")
js("s.querySelector('main select').value='skip';s.querySelector('main select').dispatchEvent(new Event('change'))")
expected=labels['importChanges'].replace('$A$','0').replace('$B$','0').replace('$C$','1')
assert js("s.querySelector('.preview-summary').textContent")==expected
screenshot('import');click('cancel')
# Palette keeps search focused during arrow navigation and filling never refocuses the website field.
send('toggle');js("document.querySelector('#email').focus();globalThis.focusEvents=0;document.querySelector('#email').addEventListener('focus',()=>focusEvents++);globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
send('palette');js("u.querySelector('.palette input').value='qa@example.com';u.querySelector('.palette input').dispatchEvent(new Event('input'))")
key('ArrowUp');assert js("u.activeElement===u.querySelector('.palette input') && u.querySelector('[aria-selected=true]')===Array.from(u.querySelectorAll('[role=option]')).at(-1)")
screenshot('palette');key('Enter');assert value('#email')=='qa@example.com';assert js('focusEvents')==0
# Inline popup flips above a field near the viewport bottom; entry-colored finite animation and reduced motion.
js("document.querySelector('#email').style.cssText='position:fixed;bottom:20px;left:20px;width:280px';document.querySelector('#email').focus();u.querySelector('.launcher').click()")
assert js("u.querySelector('.inline').getBoundingClientRect().bottom<=document.querySelector('#email').getBoundingClientRect().top")
assert js("u.querySelector('.inline .value>span').textContent==='qa@example.com'")
assert js("getComputedStyle(u.querySelector('.inline .value')).borderLeftColor==='rgb(49, 93, 228)'")
assert js("getComputedStyle(u.querySelector('.inline .value .magic-particles i')).animationIterationCount==='1'")
screenshot('inline')
page.call('Emulation.setEmulatedMedia',features=[{'name':'prefers-reduced-motion','value':'reduce'}])
assert js("getComputedStyle(u.querySelector('.inline .value .magic-particles')).display==='none'")
page.call('Emulation.setEmulatedMedia',features=[])
# Narrow sidebar and actual browser zoom: screen controls stay within the viewport.
js("u.querySelector('.surface-feedback button').click()")
assert js("u.querySelector('.surface-feedback').querySelectorAll('button').length===1") # Undo is gone after consuming the batch.
send('toggle');assert js("!u.querySelector('.surface-feedback')");click('settings');screenshot('settings')
js("s.querySelector('input[type=number]').value='320';s.querySelector('main form').requestSubmit()")
wait(lambda:js("s.querySelector('.panel').style.width.includes('320px')"))
click('back');click('newEntryButton')
worker.js('chrome.tabs.setZoom(testTab,2)');time.sleep(.3)
assert js("(()=>{const p=s.querySelector('.panel');return p.getBoundingClientRect().right<=innerWidth+1 && p.scrollWidth<=p.clientWidth+1 && s.querySelector('main').scrollWidth<=s.querySelector('main').clientWidth+1;})()")
assert js("getComputedStyle(s.querySelector('.primary')).color==='rgb(255, 255, 255)'")
screenshot('zoom-200-editor');worker.js('chrome.tabs.setZoom(testTab,1)');click('cancel')
# Second polish pass: palette layers, independent scrolling, long previews and focus restoration.
large={'entries':[{'id':'many','name':'Many values','color':'#16866b','values':{'email':'many@example.com','notes':'Long preview text. '*100,**{'code'+str(i):'Value '+str(i) for i in range(42)}}},{'id':'other','name':'Other','color':'#ce4774','values':{'email':'other@example.com'}}], 'associations':{},'language':'auto','onboardingDone':True}
worker.js('chrome.storage.local.set({registry:'+json.dumps(large)+'})')
navigate('power.html');page.call('Emulation.setDeviceMetricsOverride',width=900,height=700,deviceScaleFactor=1,mobile=False)
enter('.search','many@example.com')
assert js("s.querySelector('.count').textContent")==labels['matchingEntries'].replace('$A$','1').replace('$B$','2')
# Dismissing feedback leaves no empty span or unused dismiss button.
js("s.querySelector('footer .icon-button').click()")
assert js("s.querySelector('.status').children.length===0 && !s.querySelector('footer .icon-button').checkVisibility()")
js("s.querySelector('.search').focus()")
send('palette');js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot")
assert js("document.querySelector('quickfill-sidebar').inert")
assert js("(()=>{const p=u.querySelector('.palette').getBoundingClientRect(),side=s.querySelector('.panel').getBoundingClientRect();return document.elementFromPoint(Math.max(p.left,side.left)+12,p.top+45).localName==='quickfill-tools'})()")
assert js("u.querySelector('.palette-count').textContent.includes('52')") # 45 values + 7 actions.
js("globalThis.searchY=u.querySelector('.palette input').getBoundingClientRect().top;u.querySelector('.palette-results').scrollTop=1000")
assert js("u.querySelector('.palette input').getBoundingClientRect().top===searchY && u.querySelector('.palette-results').scrollTop>0")
js("u.querySelector('.palette input').value='Long preview text';u.querySelector('.palette input').dispatchEvent(new Event('input'));u.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))")
assert js("!u.querySelector('.palette-preview').hidden")
js("u.querySelector('.palette-preview summary').click()")
assert js("u.querySelector('.palette-preview p').textContent.length>1000")
assert js("u.querySelector('.palette').getBoundingClientRect().bottom<=innerHeight")
screenshot('palette-layering-and-preview')
key('Escape');assert js("!document.querySelector('quickfill-sidebar').inert && s.activeElement===s.querySelector('.search')")
send('palette');js("u.querySelector('.palette input').value='many@example.com';u.querySelector('.palette input').dispatchEvent(new Event('input'));u.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',bubbles:true}))")
assert js("!!u.querySelector('[aria-selected=true]') && u.querySelector('.palette mark').textContent==='many@example.com'")
assert js("getComputedStyle(u.querySelector('.value')).backgroundColor.endsWith(' / 0.05)')")
key('Escape')
page.call('Emulation.setDeviceMetricsOverride',width=1360,height=960,deviceScaleFactor=1,mobile=False)
print('PASS: palette layering/inert sidebar, focus restoration, fixed search, long-value inspection, accurate counts, matching highlights, PageUp and empty feedback')
assert not [event for event in page.events if event.get('method')=='Runtime.exceptionThrown'], 'Uncaught browser errors'
print('PASS: redesigned menus, filter recovery, highlights, resumable drafts, inline validation, save/new and replacement review, preview counts, import summary, palette focus, popup geometry, finite magic, reduced motion, 320px sidebar and 200% zoom')
print('Screenshots:',folder)
