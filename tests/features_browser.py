"""Run browser.py first, then exercise all advanced features in the same disposable profile."""
import runpy
import json
import time
from pathlib import Path
state=runpy.run_path(str(Path(__file__).with_name('browser.py')))
page,worker,wait,send,labels,locale=[state[k] for k in ['page','worker','wait','send','labels','locale']]
def js(code): return page.js(code)
def click(key):
    js("""(()=>{const key="""+json.dumps(key)+""", label="""+json.dumps(labels[key])+""";
      const b=Array.from(s.querySelectorAll('button')).find(b=>b.dataset.action===key||b.textContent===label||b.getAttribute('aria-label')===label);
      if(!b)throw Error('Missing action '+key);
      if(b.closest('.menu-list')?.hidden)b.closest('.menu-list').previousSibling.click();
      for(let parent=b.parentElement;parent;parent=parent.parentElement)if(parent.localName==='details')parent.open=true;
      b.click();})()""")
def storage(): return worker.js("chrome.storage.local.get('registry').then(r=>r.registry)")
def navigate(path):
    page.call('Page.navigate',url='http://localhost:8765/tests/'+path)
    wait(lambda:js("document.readyState==='complete'"));time.sleep(.3)
    send('toggle');wait(lambda:js("!!document.querySelector('quickfill-sidebar')"));js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot")
def field(selector): js(f"document.querySelector({json.dumps(selector)}).dispatchEvent(new MouseEvent('contextmenu',{{bubbles:true}}))")
def value(selector):return js(f"document.querySelector({json.dumps(selector)}).value")
entry={'id':'profile','name':'Profile','color':'#315de4','pinned':True,'values':{'email':'one@example.com','email_address':'two@example.com','first_name':'Alex','country':'Russia','notes':'New plain text'}}
other={'id':'other','name':'Other site','color':'#ee8844','sites':['https://other.example'],'values':{'email':'other@example.com'}}
worker.js('chrome.storage.local.set({registry:'+json.dumps({'entries':[entry,other],'associations':{},'language':'auto'})+'})')
navigate('advanced.html')
assert js("s.querySelectorAll('article').length") == 1
# Scope override shows the otherwise hidden entry.
js("s.querySelector('.registry-toolbar select').value=s.querySelector('.registry-toolbar select').value==='site'?'all':'site';s.querySelector('.registry-toolbar select').dispatchEvent(new Event('change'))")
assert js("s.querySelectorAll('article').length") == 2
js("s.querySelector('.registry-toolbar select').value=s.querySelector('.registry-toolbar select').value==='site'?'all':'site';s.querySelector('.registry-toolbar select').dispatchEvent(new Event('change'))")
# Select matching by display label, native events and undo.
field('#country');send('fill');assert labels['matchedHint'].split('$A$')[0] in js("s.querySelector('main').textContent")
js("s.querySelector('.value').click()")
assert value('#country')=='RU';click('undo');assert value('#country')=='US'
# Rich text stores plain values and restores original markup.
field('#rich');send('fill');js("s.querySelector('.value').click()")
assert js("document.querySelector('#rich').textContent")=='New plain text'
click('undo');assert js("document.querySelector('#rich').innerHTML")=='<strong>Original</strong> notes'
# Form preview requires resolution of ambiguous email and skips edits since preview.
field('#mail');send('fill');click('fillForm')
wait(lambda:js("!!s.querySelector('[data-empty-only]')"))
js("s.querySelector('[data-empty-only]').click()")
assert js("s.querySelector('.ambiguous select').value")==''
assert value('#mail')=='before@example.com'
js("s.querySelector('.ambiguous select').value='1';s.querySelector('.ambiguous select').dispatchEvent(new Event('change'));document.querySelector('#first').value='User changed'")
click('applyForm')
assert value('#mail')=='two@example.com';assert value('#country')=='RU'
assert value('#first')=='User changed';assert value('#other-email')=='other@example.com'
assert value('#locked')=='locked@example.com';assert value('#disabled-parent')=='disabled@example.com'
assert js('submissions')==0
click('undo');assert value('#mail')=='before@example.com';assert value('#country')=='US';assert value('#first')=='User changed'
# New edits after fill are never overwritten by undo.
field('#country');send('fill');js("s.querySelector('.value').click();document.querySelector('#country').value='US'");click('undo');assert value('#country')=='US'
# Correct and forget a field association independently of saved values.
field('#mail');send('fill');click('editAssociation')
js("s.querySelector('form input').value='email_address';s.querySelector('form').requestSubmit()")
wait(lambda:bool(storage()['associations']))
assert labels['savedAssociation'] in js("s.querySelector('main').textContent")
click('editAssociation');js("s.querySelector('form input').value='';s.querySelector('form').requestSubmit()")
wait(lambda:not storage()['associations'])
# Pin and collapse persist; expand restores values.
send('toggle');send('toggle');click('collapse')
wait(lambda:storage()['entries'][0].get('collapsed'))
assert js("s.querySelectorAll('.value').length")==0
click('expand');wait(lambda:js("s.querySelectorAll('.value').length")>0)
js("s.querySelector('article button[aria-pressed]').click()")
wait(lambda:not storage()['entries'][0]['pinned'])
# Keyboard search picks results, and Enter activates a native focused button.
field('#mail');js("s.querySelector('.search').value='one@example.com';s.querySelector('.search').dispatchEvent(new Event('input'));s.querySelector('.search').focus();s.querySelector('.search').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,composed:true}))")
assert js("s.activeElement.classList.contains('value')")
page.call('Input.dispatchKeyEvent',type='keyDown',key='Enter',code='Enter',windowsVirtualKeyCode=13)
page.call('Input.dispatchKeyEvent',type='keyUp',key='Enter',code='Enter',windowsVirtualKeyCode=13)
assert value('#mail')=='one@example.com'
# Escape while focus is on the page closes and resets.
js("document.querySelector('#mail').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
assert js("document.querySelector('quickfill-sidebar').style.display")=='none'
send('toggle');assert js("s.querySelector('.search').value")==''
# Invalid import does not modify storage. Valid data requires a separate apply.
click('importData');before=storage();js("s.querySelector('textarea').value='{}'");click('previewImport');assert storage()==before
incoming={'version':1,'entries':[dict(entry,values={'email':'imported@example.com'})],'associations':{}}
js('s.querySelector("textarea").value='+json.dumps(json.dumps(incoming)))
click('previewImport');assert storage()==before
click('applyImport');wait(lambda:storage()['entries'][0]['values']['email']=='imported@example.com')
assert storage()['entries'][0]['values']['notes']=='New plain text'
# Entry editor keeps flags/values when adding a site restriction.
click('edit');click('currentSite');js("s.querySelector('form').requestSubmit()")
wait(lambda:storage()['entries'][0].get('sites')==['http://localhost:8765'])
assert storage()['entries'][0]['values']['notes']=='New plain text'
# Export download contains a round-trippable backup.
folder=Path('/tmp/quickfill-exports');folder.mkdir(exist_ok=True)
for old in folder.glob('quickfill-backup*.json'):old.unlink()
page.call('Browser.setDownloadBehavior',behavior='allow',downloadPath=str(folder))
click('exportData');export=wait(lambda:next(folder.glob('quickfill-backup*.json'),None))
backup=json.loads(export.read_text());assert backup['version']==1;assert len(backup['entries'])==2
# Language changes immediately and survives a page reload.
next_locale='ru' if locale=='en' else 'en'
next_labels={k:v['message'] for k,v in json.loads((Path(__file__).parent/f'../extension/_locales/{next_locale}/messages.json').read_text()).items()}
click('settings');js(f"s.querySelector('main select').value='{next_locale}';s.querySelector('main select').dispatchEvent(new Event('change'))")
wait(lambda:js("document.querySelector('quickfill-sidebar').shadowRoot.querySelector('.panel').lang")==next_locale)
assert worker.js('chrome.action.getTitle({})')==next_labels['toggleSidebar']
navigate('advanced.html');assert js("s.querySelector('h1').textContent")=='Quickfill'
labels=next_labels
click('settings');js("s.querySelector('main select').value='auto';s.querySelector('main select').dispatchEvent(new Event('change'))")
wait(lambda:storage()['language']=='auto')
labels=state['labels']
# React and Vue controlled text/select/contenteditable models update on fill and undo.
navigate('frameworks.html');wait(lambda:js("!!document.querySelector('#vue-state') && !!document.querySelector('#react-state')"))
for framework in ['react','vue']:
    for suffix,key,expected in [('email','text','imported@example.com'),('country','country','RU'),('rich','rich','New plain text')]:
        selector=f'#{framework}-{suffix}'
        field(selector);send('fill');js("s.querySelector('.value').click()")
        wait(lambda:json.loads(js(f"document.querySelector('#{framework}-state').textContent"))[key]==expected)
        click('undo')
        original='US' if key=='country' else 'before'
        wait(lambda:json.loads(js(f"document.querySelector('#{framework}-state').textContent"))[key]==original)
print('PASS: scoped entries, select/rich undo, form preview/ambiguity/conflicts, association correction, pins/collapse, keyboard, Esc, import/export, language persistence, React and Vue fill/undo')
