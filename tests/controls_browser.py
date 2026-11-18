"""Native checkbox, radio, select and editable-combobox regression checks."""
from pathlib import Path


def run_choice_regressions(page):
    extension = Path(__file__).resolve().parent.parent / 'extension'
    page.js((extension / 'core.js').read_text())
    page.js((extension / 'fields.js').read_text())
    results = page.js(r'''(() => {
      const fields=QuickfillFields, done=[], fixture=document.createElement('div');
      fixture.innerHTML=`<form id="qf-choice-test-a">
        <label><input id="qf-test-check" type="checkbox" name="subscribed">Subscribe</label>
        <label><input type="radio" name="plan" value="basic" checked>Basic</label>
        <label><input type="radio" name="plan" value="pro">Professional</label>
        <label><input type="radio" name="plan" value="disabled" disabled>Unavailable</label>
        <select name="country"><option value="us">United States</option><option value="de">Germany</option><optgroup disabled><option value="x">Unavailable</option></optgroup></select>
        <input name="city" list="qf-test-cities"><datalist id="qf-test-cities"><option value="Berlin"><option value="Tokyo"></datalist>
        <input type="radio" value="standalone-one"><input type="radio" value="standalone-two">
      </form><form id="qf-choice-test-b"><input type="radio" name="plan" value="other" checked><input type="radio" name="plan" value="another"></form>`;
      document.body.append(fixture);
      const form=fixture.querySelector('form'),check=form.querySelector('[type=checkbox]'),basic=form.querySelector('[value=basic]'),pro=form.querySelector('[value=pro]'),select=form.querySelector('select'),city=form.querySelector('[list]');
      const assert=(ok,message)=>{if(!ok)throw Error(message);};
      function test(name,fn){fn();done.push(name);}
      function fillSnapshot(el,text){const state=fields.snapshot(el);assert(fields.write(el,text),'fill setup '+text);state.after=fields.snapshot(el);return state;}
      try{
        test('checkbox canonical value, events and undo',()=>{
          let inputs=0,changes=0;const input=()=>inputs++,change=()=>changes++;
          check.addEventListener('input',input);check.addEventListener('change',change);
          assert(fields.value(check)==='false'&&fields.empty(check),'unchecked checkbox');
          const state=fillSnapshot(check,'true');assert(check.checked&&fields.value(check)==='true'&&!fields.empty(check),'checked checkbox');
          assert(inputs===1&&changes===1,'one input/change');assert(fields.restore(state)&&!check.checked,'checkbox undo');assert(inputs===2&&changes===2,'undo events');
          check.removeEventListener('input',input);check.removeEventListener('change',change);
          assert(fields.writeResult(check,'on').code==='incompatibleValue','reject implicit truthiness');assert(fields.write(check,' true ')&&check.checked,'trimmed true');assert(fields.write(check,' false ')&&!check.checked,'trimmed false');
        });
        test('same-name checkboxes keep independent associations',()=>{
          const a=document.createElement('input'),b=document.createElement('input');a.type=b.type='checkbox';a.name=b.name='interests';a.value='music';b.value='sport';form.append(a,b);
          const first=fields.describe(a).signature,second=fields.describe(b).signature;assert(first!==second,'different option signatures');const associations={[first]:'likes_music',[second]:'likes_sport'};assert(fields.describe(a,associations).associatedKey==='likes_music'&&fields.describe(b,associations).associatedKey==='likes_sport','independent associations');b.value='music';assert(fields.describe(a).signature!==fields.describe(b).signature,'duplicate values without IDs remain distinct');a.remove();b.remove();
        });
        test('checkbox false, indeterminate snapshot and changed-state protection',()=>{
          check.checked=true;check.indeterminate=true;const state=fillSnapshot(check,'false');
          assert(!check.checked&&!check.indeterminate,'explicit false clears mixed state');assert(fields.restore(state)&&check.checked&&check.indeterminate,'restore mixed state');
          const next=fillSnapshot(check,'false');check.indeterminate=true;assert(!fields.restore(next),'skip changed mixed state');check.indeterminate=false;
        });
        test('checkbox cancellation, read-only change and page override',()=>{
          check.checked=false;check.addEventListener('beforeinput',e=>e.preventDefault(),{once:true});assert(fields.writeResult(check,'true').code==='inputCancelled'&&!check.checked,'cancelled');
          check.addEventListener('beforeinput',()=>{check.disabled=true;},{once:true});assert(fields.writeResult(check,'true').code==='fieldReadOnly'&&!check.checked,'disabled during beforeinput');check.disabled=false;
          check.addEventListener('input',()=>{check.checked=false;},{once:true});assert(fields.writeResult(check,'true').code==='fieldOverridden','overridden checkbox');
        });
        test('radio group values, selected-option events and undo',()=>{
          let inputs=0,changes=0;const input=()=>inputs++,change=()=>changes++;
          pro.addEventListener('input',input);pro.addEventListener('change',change);
          const state=fillSnapshot(basic,'pro');assert(!basic.checked&&pro.checked&&fields.value(basic)==='pro'&&fields.value(pro)==='pro','selected group value');
          assert(inputs===1&&changes===1,'events on selected radio');assert(fields.restore(state)&&basic.checked&&!pro.checked,'radio undo original');
          pro.removeEventListener('input',input);pro.removeEventListener('change',change);
          assert(fields.write(basic,'Professional')&&pro.checked,'radio label fill');assert(fields.writeResult(basic,'disabled').code==='incompatibleValue','disabled radio option');
          assert(fixture.querySelector('#qf-choice-test-b [value=other]').checked,'other form unchanged');
        });
        test('radio no-selection fill/undo and group conflicts',()=>{
          basic.checked=false;pro.checked=false;assert(fields.value(basic)===''&&fields.empty(basic),'unselected group');
          let state=fillSnapshot(basic,'pro');assert(fields.restore(state)&&!basic.checked&&!pro.checked,'undo to empty group');
          basic.checked=true;state=fillSnapshot(basic,'');assert(!basic.checked&&!pro.checked,'clear group');assert(fields.restore(state)&&basic.checked,'undo clear group');
          state=fillSnapshot(basic,'pro');basic.checked=true;assert(!fields.restore(state),'skip user selection');
          const before=fields.snapshot(basic);pro.checked=true;assert(!fields.matchesSnapshot(basic,before),'preview checks entire group');
          basic.checked=true;state=fillSnapshot(basic,'pro');const extra=document.createElement('input');extra.type='radio';extra.name='plan';extra.value='new';form.append(extra);assert(!fields.restore(state),'skip changed radio membership');extra.remove();
        });
        test('radio cancellation and override',()=>{
          basic.checked=true;pro.addEventListener('beforeinput',e=>e.preventDefault(),{once:true});assert(fields.writeResult(basic,'pro').code==='inputCancelled'&&basic.checked,'radio cancel');
          pro.addEventListener('input',()=>{basic.checked=true;},{once:true});assert(fields.writeResult(basic,'pro').code==='fieldOverridden'&&basic.checked,'radio override');
        });
        test('radio group collection, unnamed and shadow-root scopes',()=>{
          basic.checked=true;const collected=fields.collect(fixture);assert(collected.filter(el=>el.name==='plan').length===2,'one per form group');assert(collected.includes(basic)&&!collected.includes(pro),'stable group representative');pro.checked=true;assert(fields.collect(fixture).includes(basic)&&!fields.collect(fixture).includes(pro),'selection does not change saved mapping locator');basic.checked=true;
          const standalone=Array.from(form.querySelectorAll('input[type=radio]:not([name])'));assert(collected.includes(standalone[0])&&collected.includes(standalone[1]),'unnamed radios separate');
          const host=document.createElement('div');fixture.append(host);host.attachShadow({mode:'open'}).innerHTML='<input type="radio" name="plan" value="shadow-a" checked><input type="radio" name="plan" value="shadow-b">';
          const shadow=host.shadowRoot.querySelector('input');assert(fields.write(shadow,'shadow-b')&&basic.checked,'shadow root independent');assert(fields.collect(fixture).filter(el=>el.type==='radio'&&el.name==='plan').length===3,'collect shadow group once');host.remove();
        });
        test('radio removed during beforeinput',()=>{
          const group=document.createElement('form');group.innerHTML='<input type="radio" name="gone" value="a" checked><input type="radio" name="gone" value="b">';fixture.append(group);
          const [a,b]=group.querySelectorAll('input');b.addEventListener('beforeinput',()=>b.remove(),{once:true});assert(fields.writeResult(a,'b').code==='fieldRemoved'&&a.checked,'removed selected target');group.remove();
        });
        test('native combobox value/label fill, events, disabled options and undo',()=>{
          let changes=0;const listener=()=>changes++;select.addEventListener('change',listener);
          const state=fillSnapshot(select,'Germany');assert(select.value==='de'&&changes===1,'select label fill');assert(fields.restore(state)&&select.value==='us'&&changes===2,'select undo');select.removeEventListener('change',listener);
          assert(fields.writeResult(select,'x').code==='incompatibleValue','disabled optgroup rejected');assert(fields.write(select,'de'),'select value fill');
        });
        test('native numbers normalize whitespace and plus without reserializing',()=>{
          const number=document.createElement('input');number.type='number';number.value='8.25';form.append(number);
          for(const [raw,expected] of [['+1','1'],[' 1.50 ','1.50'],['-0','-0'],['9007199254740993','9007199254740993']]){const state=fillSnapshot(number,raw);assert(number.value===expected,'preserve numeric text '+raw);assert(fields.restore(state)&&number.value==='8.25','numeric undo '+raw);}
          number.remove();
        });
        test('editable combobox accepts listed and free-text values',()=>{
          const state=fillSnapshot(city,'Tokyo');assert(city.value==='Tokyo','datalist value');assert(fields.restore(state)&&city.value==='','datalist undo');assert(fields.write(city,'Custom city')&&city.value==='Custom city','datalist permits free text');
          const custom=document.createElement('div');custom.setAttribute('role','combobox');fixture.append(custom);assert(!fields.supported(custom),'custom ARIA widget not silently filled');
        });
      }finally{fixture.remove();}
      return done;
    })()''')
    assert len(results) == 12, results
    print('PASS: checkbox/radio/select/combobox fill, capture values, group collection, input/change events, conflict checks and undo')
