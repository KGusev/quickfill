/* Typed values remain strings in storage. Parsing and highlighting never execute markup. */
(function(root) {
  const names = ['string','bool','number','date','datetime','json','xml'];
  const variables = new Set(['date','uuid','timestamp','counter']);
  const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  function dateParts(raw) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;
    const [year,month,day] = match.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month-1] ? {year,month,day} : null;
  }
  function datetimeValid(raw) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(raw);
    return !!match && !!dateParts(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4] || 0) < 60;
  }
  const xmlChar = cp => cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
  const predefined = {amp:'&',lt:'<',gt:'>',apos:"'",quot:'"'};
  function entityValue(entity) {
    if (Object.hasOwn(predefined,entity)) return predefined[entity];
    if (!/^#(?:\d+|x[\da-fA-F]+)$/.test(entity)) return null;
    const point = entity[1] === 'x' ? Number.parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return xmlChar(point) ? String.fromCodePoint(point) : null;
  }
  function decodeEntities(raw) {
    let result = '', start = 0, at;
    while ((at = raw.indexOf('&',start)) !== -1) {
      const end = raw.indexOf(';',at+1);
      if (end === -1) return null;
      const value = entityValue(raw.slice(at+1,end));
      if (value === null) return null;
      result += raw.slice(start,at) + value; start = end+1;
    }
    return result + raw.slice(start);
  }
  // XML 1.0 names, including Unicode names. Namespace checks are performed separately.
  const nameStart = ':A-Z_a-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u02ff\\u0370-\\u037d\\u037f-\\u1fff\\u200c-\\u200d\\u2070-\\u218f\\u2c00-\\u2fef\\u3001-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\ufffd\\u{10000}-\\u{effff}';
  const xmlName = new RegExp('^[' + nameStart + '][' + nameStart + '\\-.0-9\\u00b7\\u0300-\\u036f\\u203f-\\u2040]*','u');
  const qualified = name => {const parts=name.split(':');return parts.length <= 2 && parts.every(part=>part && xmlName.exec(part)?.[0] === part) ? parts : null;};
  const xmlNamespace = 'http://www.w3.org/XML/1998/namespace', xmlnsNamespace = 'http://www.w3.org/2000/xmlns/';
  function xmlValid(input) {
    // A small non-expanding parser supports documents, namespaces, comments, CDATA,
    // and processing instructions. DTDs and custom entity declarations are unsupported.
    const source = input.replace(/^\ufeff/,'');
    for (const ch of source) if (!xmlChar(ch.codePointAt(0))) return false;
    const stack = []; let at = 0, hasRoot = false;
    const skipSpace = () => {while (/[\t\n\r ]/.test(source[at] || '') && at < source.length) at++;};
    const readName = () => {const match=xmlName.exec(source.slice(at));if(!match)return null;at+=match[0].length;return match[0];};
    while (at < source.length) {
      if (source[at] !== '<') {
        let end=source.indexOf('<',at);if(end === -1)end=source.length;
        const text=source.slice(at,end);if(text.includes(']]>') || decodeEntities(text) === null || (!stack.length && /[^\t\n\r ]/.test(text)))return false;
        at=end;continue;
      }
      if (source.startsWith('<!--',at)) {
        const end=source.indexOf('-->',at+4);if(end === -1)return false;
        const body=source.slice(at+4,end);if(body.includes('--') || body.endsWith('-'))return false;
        at=end+3;continue;
      }
      if (source.startsWith('<![CDATA[',at)) {
        const end=source.indexOf(']]>',at+9);if(!stack.length || end === -1)return false;
        at=end+3;continue;
      }
      if (source.startsWith('<?',at)) {
        const start=at;at+=2;const target=readName();if(!target)return false;
        const end=source.indexOf('?>',at);if(end === -1)return false;
        const body=source.slice(at,end);if(body && !/^[\t\n\r ]/.test(body))return false;
        if (target.toLowerCase() === 'xml') {
          if(start !== 0 || target !== 'xml' || !/^[\t\n\r ]+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*$/.test(body))return false;
        }
        at=end+2;continue;
      }
      if (source.startsWith('</',at)) {
        at+=2;const name=readName();skipSpace();if(source[at++] !== '>' || !stack.length || stack.pop().name !== name)return false;
        continue;
      }
      if (source.startsWith('<!',at)) return false;
      at++;const name=readName(),parts=name && qualified(name);if(!parts || parts[0] === 'xmlns' && parts.length === 2)return false;
      const attributes=new Map();let closed=false;
      while (at < source.length) {
        const before=at;skipSpace();
        if(source.startsWith('/>',at)){closed=true;at+=2;break;}
        if(source[at] === '>'){at++;break;}
        if(at === before)return false;
        const attr=readName();if(!attr || !qualified(attr) || attributes.has(attr))return false;
        skipSpace();if(source[at++] !== '=')return false;skipSpace();const quote=source[at++];if(quote !== '"' && quote !== "'")return false;
        const end=source.indexOf(quote,at);if(end === -1)return false;
        const raw=source.slice(at,end),value=decodeEntities(raw);if(raw.includes('<') || value === null)return false;
        attributes.set(attr,value);at=end+1;
      }
      if(source[at-1] !== '>')return false;
      const namespaces=new Map(stack.at(-1)?.namespaces || [['xml',xmlNamespace]]);
      for(const [attr,value] of attributes) {
        if(attr !== 'xmlns' && !attr.startsWith('xmlns:'))continue;
        const prefix=attr === 'xmlns' ? '' : attr.slice(6);
        if(prefix === 'xmlns' || (prefix && !value) || value === xmlnsNamespace || (prefix === 'xml' ? value !== xmlNamespace : value === xmlNamespace))return false;
        namespaces.set(prefix,value);
      }
      if(parts.length === 2 && !namespaces.has(parts[0]))return false;
      const expanded=new Set();
      for(const attr of attributes.keys()) {
        if(attr === 'xmlns' || attr.startsWith('xmlns:'))continue;
        const parts=qualified(attr);if(parts.length === 2 && !namespaces.has(parts[0]))return false;
        const key=JSON.stringify([parts.length === 2 ? namespaces.get(parts[0]) : '',parts.at(-1)]);if(expanded.has(key))return false;expanded.add(key);
      }
      if(!stack.length){if(hasRoot)return false;hasRoot=true;}
      if(!closed)stack.push({name,namespaces});
    }
    return hasRoot && !stack.length;
  }
  function validate(raw, type = 'string', {allowVariables = true} = {}) {
    if (!names.includes(type) || typeof raw !== 'string') return 'invalidImport';
    if (type === 'string') return null;
    if (allowVariables) {
      const found=[...raw.matchAll(/\{\{([^{}]+)\}\}/g)];
      if(found.some(match=>!variables.has(match[1])))return 'unknownVariable';
      if(found.length)return null;
    }
    const text=raw.trim();let valid=false;
    if(type === 'bool')valid=text === 'true' || text === 'false';
    else if(type === 'number')valid=numberPattern.test(text) && Number.isFinite(Number(text));
    else if(type === 'date')valid=!!dateParts(raw);
    else if(type === 'datetime')valid=datetimeValid(raw);
    else if(type === 'json'){try{JSON.parse(raw);valid=true;}catch{}}
    else if(type === 'xml')valid=xmlValid(raw);
    return valid ? null : 'typeInvalid_' + type;
  }
  function tokenize(raw, type = 'string') {
    const tokens=[];
    const push=(kind,text)=>{if(!text)return;const last=tokens.at(-1);if(last?.kind === kind)last.text+=text;else tokens.push({kind,text});};
    const scan=(source,pattern,classify)=>{let start=0;for(const match of source.matchAll(pattern)){push('text',source.slice(start,match.index));push(classify(match,source),match[0]);start=match.index+match[0].length;}push('text',source.slice(start));};
    if(type === 'json')scan(raw,/"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g,(match,source)=>match[0][0] === '"' ? (/^\s*:/.test(source.slice(match.index+match[0].length)) ? 'key' : 'string') : /^(true|false)$/.test(match[0]) ? 'boolean' : match[0] === 'null' ? 'null' : /^-?\d/.test(match[0]) ? 'number' : 'punctuation');
    else if(type === 'xml') {
      let start=0;
      for(const match of raw.matchAll(/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*(?:>|$)/g)) {
        scan(raw.slice(start,match.index),/&[^;\s]+;/g,()=> 'entity');
        if(match[0].startsWith('<!--') || match[0].startsWith('<![CDATA['))push('comment',match[0]);
        else {
          let name=true;
          scan(match[0],/"[^"]*"|'[^']*'|[\p{L}_:][\p{L}\p{N}_.:\-]*|[<>/=?]/gu,part=>part[0][0] === '"' || part[0][0] === "'" ? 'string' : /^[<>/=?]$/.test(part[0]) ? 'punctuation' : name ? (name=false,'tag') : 'attribute');
        }
        start=match.index+match[0].length;
      }
      scan(raw.slice(start),/&[^;\s]+;/g,()=> 'entity');
    } else if(type === 'bool')push('boolean',raw);
    else if(type === 'number')push('number',raw);
    else if(type === 'date' || type === 'datetime')push('date',raw);
    else scan(raw,/\{\{[^{}]+\}\}/g,()=> 'variable');
    return tokens;
  }
  const api={names,validate,tokenize,dateParts};root.QuickfillTypes=api;
  if(typeof module !== 'undefined')module.exports=api;
})(globalThis);
