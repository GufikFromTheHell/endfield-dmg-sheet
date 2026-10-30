// Parse tools/sheet.csv (reference Google Sheet export) into a 2D grid.
// Usage:
//   node tools/parseSheet.mjs cols [startCol] [endCol] [row]  -- print one row slice with column indices
//   node tools/parseSheet.mjs rows <rowStart> <rowEnd> [colStart] [colEnd]
//   node tools/parseSheet.mjs find <text>                     -- locate all cells containing text
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../tools/sheet.csv', import.meta.url), 'utf8');
const rows = [];
let field = '', cur = [], inQ = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (inQ) {
    if (c === '"') {
      if (raw[i + 1] === '"') { field += '"'; i++; }
      else inQ = false;
    } else field += c;
  } else if (c === '"') inQ = true;
  else if (c === ',') { cur.push(field); field = ''; }
  else if (c === '\n') { cur.push(field); rows.push(cur); field = ''; cur = []; }
  else if (c === '\r') { /* skip */ }
  else field += c;
}
if (cur.length || field) { cur.push(field); rows.push(cur); }
const ncols = Math.max(...rows.map(r => r.length));
console.log(`grid: ${rows.length} rows x ${ncols} cols`);

const [cmd, a, b, c, d] = process.argv.slice(2);
if (cmd === 'cols') {
  const r = rows[parseInt(a, 10)];
  const s = parseInt(b, 10) || 0, e = Math.min(ncols, (parseInt(c, 10) || ncols));
  for (let j = s; j < e; j++) {
    const v = (r[j] ?? '').trim();
    if (v) console.log(j, ':', v.length > 40 ? v.slice(0, 40) + '…' : v);
  }
} else if (cmd === 'rows') {
  const rs = parseInt(a, 10), re = parseInt(b, 10);
  const cs = parseInt(c, 10) || 0, ce = Math.min(ncols, parseInt(d, 10) || ncols);
  for (let i = rs; i <= re && i < rows.length; i++) {
    const parts = [];
    for (let j = cs; j < ce; j++) {
      const v = (rows[i][j] ?? '').trim();
      if (v) parts.push(`${j}=${v.length > 24 ? v.slice(0, 24) + '…' : v}`);
    }
    console.log(`R${i + 1} [1-based]: ${parts.join(' | ')}`);
  }
} else if (cmd === 'find') {
  const t = a.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if ((rows[i][j] ?? '').toLowerCase().includes(t)) console.log(`r${i + 1} c${j}: ${rows[i][j]}`);
    }
  }
}