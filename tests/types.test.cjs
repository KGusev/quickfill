const {test} = require('node:test');
const assert = require('node:assert/strict');
const types = require('../extension/types.js');

test('bool and number types validate without changing the stored text', () => {
  for (const value of ['true','false']) assert.equal(types.validate(value,'bool'),null);
  for (const value of ['','TRUE','1','yes']) assert.equal(types.validate(value,'bool'),'typeInvalid_bool');
  for (const value of ['0','-23','+4.5','.25','1.','2e-3',' 12 ']) assert.equal(types.validate(value,'number'),null);
  for (const value of ['','NaN','Infinity','1e999','0x10','1,2','2px']) assert.equal(types.validate(value,'number'),'typeInvalid_number');
  assert.equal(types.validate('anything','string'),null);
  assert.equal(types.validate('1','constructor'),'invalidImport');
});

test('date and local datetime validation rejects nonexistent calendar dates and times', () => {
  for (const value of ['2024-02-29','2000-02-29','0001-01-01','2026-11-18']) assert.equal(types.validate(value,'date'),null);
  for (const value of ['2025-02-29','1900-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','0000-01-01','2026-1-1',' 2026-01-01 ']) assert.equal(types.validate(value,'date'),'typeInvalid_date');
  for (const value of ['2026-11-18T14:30','2024-02-29T23:59:59.123']) assert.equal(types.validate(value,'datetime'),null);
  for (const value of ['2026-11-18','2026-11-18 14:30','2026-11-18T24:00','2026-11-18T23:60','2026-11-18T23:59:60','2026-02-29T12:00','2026-11-18T12:00Z']) assert.equal(types.validate(value,'datetime'),'typeInvalid_datetime');
});

test('JSON parsing accepts all JSON values and rejects script or incomplete syntax', () => {
  for (const value of ['{"name":"Alex","active":true,"count":2}', '[1,null,false]', '"text"','false','42','null']) assert.equal(types.validate(value,'json'),null);
  for (const value of ['','{unquoted:1}','{"a":1,}','undefined','(()=>1)()','<script>alert(1)</script>']) assert.equal(types.validate(value,'json'),'typeInvalid_json');
});

test('XML validates structure, attributes, entities and namespaces without expanding declarations', () => {
  const valid = [
    '<root/>', '<root><child enabled="true">Text &amp; &#x1F600;</child></root>',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>',
    '<!--before--><root><![CDATA[<not markup>]]><?process data?></root><!--after-->',
    '<корень атрибут="значение">текст</корень>',
    '<root xmlns="urn:root" xmlns:p="urn:part"><p:item p:code="x" xml:lang="en"/></root>',
    '<root xmlns:a="urn:x"><a:item xmlns:a="urn:y"/></root>'
  ];
  for (const value of valid) assert.equal(types.validate(value,'xml'),null,value);
  const invalid = [
    '', '<root>', '<root></other>', '<root/><second/>', 'text<root/>', '<root/>text',
    '<root a="1" a="2"/>', '<root a=unquoted/>', '<root a="<"/>', '<root a="1"b="2"/>',
    '<root>&unknown;</root>', '<root>&amp</root>', '<root>&#0;</root>', '<root>&#x110000;</root>',
    '<root>]]></root>', '<!--bad--comment--><root/>', '<![CDATA[outside]]><root/>',
    '<!DOCTYPE root SYSTEM "https://example.com/external.dtd"><root/>',
    '<!DOCTYPE root [<!ENTITY x "expanded">]><root>&x;</root>',
    '<p:root/>', '<root p:attr="x"/>', '<root xmlns:p="urn:x"><p:1/></root>',
    '<root xmlns:a="urn:x" xmlns:b="urn:x" a:attr="1" b:attr="2"/>',
    '<root xmlns:xml="urn:wrong"/>', '<root xmlns:xmlns="urn:wrong"/>',
    '<root xmlns:p=""/>', ' <?xml version="1.0"?><root/>', '<?XML version="1.0"?><root/>',
    '<root>\u0000</root>', '<root>\ud800</root>'
  ];
  for (const value of invalid) assert.equal(types.validate(value,'xml'),'typeInvalid_xml',value);
});

test('known variables are validated after resolution; unknown expressions remain invalid', () => {
  assert.equal(types.validate('{{counter}}','number'),null);
  assert.equal(types.validate('{{date}}','date'),null);
  assert.equal(types.validate('{"id":"{{uuid}}"}','json'),null);
  assert.equal(types.validate('{{arbitrary.expression}}','number'),'unknownVariable');
  assert.equal(types.validate('prefix-{{counter}}','number',{allowVariables:false}),'typeInvalid_number');
  assert.equal(types.validate('prefix-1','number',{allowVariables:false}),'typeInvalid_number');
});

test('highlight tokens reconstruct exact source text and never contain rendered markup', () => {
  const cases = [
    ['{"name":"Alex","ok":true,"empty":null,"n":-2.5e3}', 'json'],
    ['<root n="2"><!--note-->Text &amp; <![CDATA[<unsafe>]]></root>', 'xml'],
    ['<img src=x onerror=alert(1)>', 'xml'],
    ['false','bool'], ['12.50','number'], ['2026-11-18','date'], ['2026-11-18T14:30','datetime'],
    ['Hello {{counter}}\n<img src=x>','string']
  ];
  for (const [value,type] of cases) {
    const tokens=types.tokenize(value,type);
    assert.equal(tokens.map(token=>token.text).join(''),value);
    assert.ok(tokens.every(token=>typeof token.kind==='string' && typeof token.text==='string'));
  }
  const json=types.tokenize('{"key":true,"count":2}','json');
  assert.ok(json.some(token=>token.kind==='key'));
  assert.ok(json.some(token=>token.kind==='boolean'));
  assert.ok(json.some(token=>token.kind==='number'));
  const xml=types.tokenize('<root name="value"/>','xml');
  assert.ok(xml.some(token=>token.kind==='tag'));
  assert.ok(xml.some(token=>token.kind==='attribute'));
});
