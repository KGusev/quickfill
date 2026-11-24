const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../extension');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const en = JSON.parse(read('_locales/en/messages.json'));
const ru = JSON.parse(read('_locales/ru/messages.json'));

test('both catalogs cover every runtime and manifest message', () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  const references = ['content.js', 'background.js', 'surface.js', 'controls.js'].flatMap(file =>
    [...read(file).matchAll(/\bt\('([^']+)'\s*[,)]/g)].map(match => match[1]));
  references.push(...['string','bool','number','date','datetime','json','xml'].map(x=>'type_'+x),...['bool','number','date','datetime','json','xml'].map(x=>'typeInvalid_'+x));
  references.push(...['none','trim','upper','lower','digits','format'].map(x=>'transform_'+x),...['person','company','address','testAccount'].map(x=>'template_'+x),...['off','button','auto'].map(x=>'suggestions_'+x));
  references.push(...[...read('manifest.json').matchAll(/__MSG_(\w+)__/g)].map(match => match[1]));
  for (const messages of [en, ru]) {
    for (const key of references) assert.ok(messages[key]?.message.trim(), `Missing translation: ${key}`);
    for (const [key, entry] of Object.entries(messages)) {
      for (const [, placeholder] of entry.message.matchAll(/\$(\w+)\$/g)) {
        assert.ok(entry.placeholders?.[placeholder.toLowerCase()], `Missing placeholder in ${key}`);
      }
    }
  }
  assert.equal(JSON.parse(read('manifest.json')).default_locale, 'en');
});

test('translated substitutions preserve the same arguments', () => {
  for (const key of Object.keys(en)) {
    assert.deepEqual(ru[key].placeholders, en[key].placeholders, key);
  }
});

test('template labels display the actual name in both languages', () => {
  const {formatMessage} = require('../extension/core.js');
  assert.equal(formatMessage(en, 'templateLabel', 'Work profile'), 'Template: Work profile');
  assert.equal(formatMessage(ru, 'templateLabel', 'Рабочий профиль'), 'Шаблон: Рабочий профиль');
});
