// Reads the Notion database and writes data.json (run nightly by GitHub Actions).
import fs from 'node:fs';

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_DATABASE_ID;
if (!TOKEN || !DB) throw new Error('NOTION_TOKEN and NOTION_DATABASE_ID must be set.');

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

async function queryAll() {
  const out = [];
  let cursor;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!r.ok) throw new Error(`Notion error ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const text = a => clean((a || []).map(x => x.plain_text).join(''));
function get(props, name) {
  const p = props[name];
  if (!p) return '';
  switch (p.type) {
    case 'title': case 'rich_text': return text(p[p.type]);
    case 'url': return p.url || '';
    case 'date': return p.date?.start ? p.date.start.slice(0, 10) : '';
    case 'select': return p.select?.name || '';
    case 'multi_select': return p.multi_select.map(x => x.name).join('|');
    case 'files': return p.files[0]?.external?.url || p.files[0]?.file?.url || '';
    default: return '';
  }
}
const list = s => (s ? s.split('|').map(clean).filter(Boolean) : []);
const gid = u => (/drive\.google/.test(u) && (u.match(/\/d\/([\w-]+)/) || u.match(/[?&]id=([\w-]+)/)) || [])[1] || '';
const cut = (s, n = 420) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');

const fallback = fs.existsSync('translations-fallback.json') ? JSON.parse(fs.readFileSync('translations-fallback.json', 'utf8')) : {};
const key = t => clean(t).toLowerCase();

const pages = await queryAll();
const first = pages[0]?.properties || {};
for (const n of ['Titel', 'Publicatie Datum', 'Download']) {
  if (!first[n]) throw new Error(`Column "${n}" not found. Columns in Notion: ${Object.keys(first).join(', ')}`);
}

const items = pages.map(pg => {
  const p = pg.properties, t = get(p, 'Titel');
  const fb = fallback[key(t)] || {};
  const u = get(p, 'Download');
  return {
    t, te: get(p, 'Titel EN') || fb.te || '',
    st: get(p, 'Subtitel'), se: get(p, 'Subtitel EN') || fb.se || '',
    a: get(p, 'Auteur(s)'),
    d: get(p, 'Publicatie Datum'),
    ty: list(get(p, 'Type')), tg: list(get(p, 'Tags')), p: list(get(p, 'Uitgever(s)')),
    u, g: gid(u),
    s: cut(get(p, 'Samenvatting')), ee: cut(get(p, 'Samenvatting EN') || fb.ee || ''),
  };
}).filter(x => x.t && x.d).sort((a, b) => b.d.localeCompare(a.d));

fs.writeFileSync('data.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), items }));
console.log(`Wrote ${items.length} studies to data.json`);
