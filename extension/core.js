/* Shared pure matching logic, also exercised by Node tests. */
(function (root) {
  const normalize = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const groups = [
    ['email', 'e mail', 'email address'], ['tel', 'phone', 'telephone', 'phone number'],
    ['given name', 'first name', 'firstname'], ['family name', 'last name', 'surname'],
    ['name', 'full name', 'fullname'], ['organization', 'company', 'company name'],
    ['postal code', 'zip', 'zip code'], ['street address', 'address'], ['url', 'website']
  ];
  const canonical = value => { const n = normalize(value); return groups.find(g => g.includes(n))?.[0] || n; };
  function compatible(field, value) {
    if (field.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (field.type === 'number') return value.trim() !== '' && Number.isFinite(Number(value));
    if (field.type === 'url') { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
    if (field.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value);
    return true;
  }
  function suggestions(entries, field) {
    const hints = field.hints.map(canonical).filter(Boolean);
    return entries.flatMap(entry => Object.entries(entry.values).filter(([key, value]) =>
      compatible(field, value) && (key === field.associatedKey || hints.includes(canonical(key)))
    ).map(([key, value]) => ({entry, key, value}))).sort((a,b) => Number(b.key === field.associatedKey) - Number(a.key === field.associatedKey));
  }
  const api = {normalize, canonical, compatible, suggestions};
  root.QuickfillCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
