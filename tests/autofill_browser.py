"""Verify coexistence behavior; native Chrome popup visuals still need a headed manual check."""
import runpy,json
from pathlib import Path
state=runpy.run_path(str(Path(__file__).with_name('power_browser.py')))
page,worker,wait,send,js,navigate,value=[state[k] for k in ['page','worker','wait','send','js','navigate','value']]
fixture={'entries':[{'id':'autofill','name':'Profile','color':'#315de4','values':{'email':'alex@example.com','phone':'5550100'}}],'associations':{},'language':'auto','onboardingDone':True,'preferences':{'http://localhost:8765':{'suggestions':'auto'}}}
worker.js('chrome.storage.local.set({registry:'+json.dumps(fixture)+'})')
navigate('power.html');send('toggle')
js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot;document.querySelector('#email').setAttribute('autocomplete','email');document.querySelector('#email').focus()")
wait(lambda:js("!!u.querySelector('.launcher')"))
assert js("!u.querySelector('.inline')") # Legacy auto must not compete with Chrome on focus.
assert js("document.activeElement.id")=='email'
assert js("document.querySelector('#email').getAttribute('autocomplete')")=='email'
assert js("(()=>{const r=document.querySelector('#email').getBoundingClientRect(),b=u.querySelector('.launcher').getBoundingClientRect();return b.left>=r.right || b.right<=r.left || b.bottom<=r.top})()")
# Page arrows/Enter remain untouched when Quickfill has not been explicitly opened.
assert js("['ArrowDown','ArrowUp','Enter'].every(key=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});document.querySelector('#email').dispatchEvent(event);return !event.defaultPrevented})")
js("u.querySelector('.launcher').click()")
assert js("document.activeElement.localName")=='quickfill-tools'
assert js("u.activeElement.classList.contains('value')")
# Switching fields removes old matches. Selecting the new field's value cannot use stale email results.
js("document.querySelector('#phone').focus()")
assert js("!u.querySelector('.inline')")
js("u.querySelector('.launcher').click()")
assert js("u.querySelector('.inline .value').textContent.includes('5550100')")
assert js("!u.querySelector('.inline').textContent.includes('alex@example.com')")
js("globalThis.phoneFocusEvents=0;document.querySelector('#phone').addEventListener('focus',()=>phoneFocusEvents++);u.querySelector('.inline .value').click()")
assert js('phoneFocusEvents')==0
assert value('#phone')=='5550100'
assert value('#email')==''
assert js("!u.querySelector('.inline')")
assert js("document.activeElement.localName")=='quickfill-tools'
assert js("u.activeElement===u.querySelector('.launcher')")
# Returning to the same field through the mouse/keyboard also dismisses Quickfill.
js("u.querySelector('.launcher').click();document.querySelector('#phone').focus()")
assert js("!u.querySelector('.inline')")
# Sidebar filling likewise keeps focus on the chosen Quickfill value.
send('toggle')
js("document.querySelector('#email').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));globalThis.emailFocusEvents=0;document.querySelector('#email').addEventListener('focus',()=>emailFocusEvents++)")
send('fill')
js("globalThis.s=document.querySelector('quickfill-sidebar').shadowRoot;s.querySelector('.value').focus();s.querySelector('.value').click()")
assert value('#email')=='alex@example.com'
assert js('emailFocusEvents')==0
assert js("document.activeElement.localName")=='quickfill-sidebar'
assert js("s.activeElement.classList.contains('value')")
print('PASS: native-autofill coexistence (explicit activation, focus ownership, unchanged autocomplete, launcher geometry, no stolen page keys, stale-popup cleanup)')
