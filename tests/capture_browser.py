"""Focused capture scope and pending-save regressions against the real extension."""
import json


def run_capture_regressions(state):
    page, worker, wait, send, js, navigate, labels = [
        state[name] for name in ['page', 'worker', 'wait', 'send', 'js', 'navigate', 'labels']]
    worker.js('chrome.storage.local.set({registry:' + json.dumps({
        'entries': [], 'associations': {}, 'language': 'auto', 'onboardingDone': True}) + '})')
    navigate('controls.html')
    js("""globalThis.captureRich=document.createElement('div');captureRich.id='rich-notes';
        captureRich.contentEditable='true';captureRich.setAttribute('aria-label','Rich notes');
        captureRich.textContent='Rich value';document.querySelector('#control-form').append(captureRich);
        globalThis.captureOther=document.createElement('form');captureOther.id='capture-other';
        captureOther.innerHTML='<input name=outside_capture value=outside>';document.body.append(captureOther);
        captureRich.focus();captureRich.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));""")
    send('palette')
    js("globalThis.u=document.querySelector('quickfill-tools').shadowRoot;u.querySelector('.palette input').value=" + json.dumps(labels['saveAllFields']) + ";u.querySelector('.palette input').dispatchEvent(new Event('input'));u.querySelector('[role=option]').click()")
    wait(lambda: js("!!s.querySelector('.capture-form')"))
    captured_keys = js("Array.from(s.querySelectorAll('[data-capture-key]'),input=>input.value)")
    assert 'rich-notes' in captured_keys and 'quantity' in captured_keys, captured_keys
    assert 'outside_capture' not in captured_keys, captured_keys
    assert js("s.querySelector('main').textContent.includes(" + json.dumps(labels['captureFormHint']) + ")")

    context_id = None
    for event in reversed(page.events):
        if event.get('method') != 'Runtime.executionContextCreated':
            continue
        context = event['params']['context']
        if context.get('auxData', {}).get('isDefault'):
            continue
        try:
            result = page.call('Runtime.evaluate', contextId=context['id'], returnByValue=True,
                               expression="document.URL.endsWith('/tests/controls.html') && typeof QuickfillCore!=='undefined' && !!chrome.runtime.id")
            if result.get('result', {}).get('value'):
                context_id = context['id']
                break
        except AssertionError:
            continue
    assert context_id is not None, 'Could not find the content-script context for capture'

    def isolated(expression):
        result = page.call('Runtime.evaluate', contextId=context_id, returnByValue=True,
                          awaitPromise=True, expression=expression)
        assert 'exceptionDetails' not in result, result
        return result.get('result', {}).get('value')

    isolated("""globalThis.qfCaptureOriginalSend=chrome.runtime.sendMessage.bind(chrome.runtime);
        globalThis.qfCapturePending=[];globalThis.qfCaptureCalls=0;
        chrome.runtime.sendMessage=(message,...args)=>{
          const capture=message.type==='mutate'&&message.action==='save-fields';if(capture)qfCaptureCalls++;
          const result=qfCaptureOriginalSend(message,...args);
          return capture?result.then(response=>new Promise(resolve=>qfCapturePending.push(()=>resolve(response)))):result;
        };""")
    try:
        js("globalThis.pendingCaptureForm=s.querySelector('.capture-form');pendingCaptureForm.querySelector(':scope>input').value='Captured exactly once';pendingCaptureForm.querySelector(':scope>input').dispatchEvent(new Event('input',{bubbles:true}));pendingCaptureForm.requestSubmit()")
        wait(lambda: isolated('qfCapturePending.length===1'))
        assert js("pendingCaptureForm.querySelector('[type=submit]').disabled")
        # Both input and change used to run review(), re-enable Save, and allow a second UUID.
        js("""pendingCaptureForm.querySelector(':scope>input').value='Edited while saving';
            pendingCaptureForm.querySelector(':scope>input').dispatchEvent(new Event('input',{bubbles:true}));
            globalThis.captureValue=pendingCaptureForm.querySelector('[data-value-input]');
            captureValue.dispatchEvent(new Event('change',{bubbles:true}));""")
        assert js("pendingCaptureForm.querySelector('[type=submit]').disabled")
        js("pendingCaptureForm.requestSubmit();pendingCaptureForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        assert isolated('qfCaptureCalls') == 1
        assert worker.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries.length)") == 1
        isolated('qfCapturePending[0]()')
        wait(lambda: js("!s.querySelector('.capture-form')"))
        saved = worker.js("chrome.storage.local.get('registry').then(({registry})=>registry.entries)")
        assert len(saved) == 1 and saved[0]['name'] == 'Captured exactly once', saved
        assert saved[0]['values']['rich-notes'] == 'Rich value'
        assert 'outside_capture' not in saved[0]['values']
    finally:
        isolated('chrome.runtime.sendMessage=qfCaptureOriginalSend;qfCapturePending.forEach(release=>release())')
    print('PASS: rich-editor capture stays within its form and edits during a pending capture cannot re-enable Save or create duplicates')
