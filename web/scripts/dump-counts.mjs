// Counts the rows per table in a Supabase CLI data dump (data.sql).
// Prints "schema.table count" lines only, never any values.
//
//   node scripts/dump-counts.mjs <data.sql>
//
// The dump writes INSERT INTO "schema"."table" (...) VALUES followed by one or
// more "(...)" rows. Text values may contain newlines, brackets and quotes
// (doubled, as standard_conforming_strings is on), so rows are counted by
// scanning characters with the quoting tracked, not by counting lines.
import { readFileSync } from 'node:fs';

const sql = readFileSync(process.argv[2], 'utf8');
const counts = new Map();
// Identity columns add OVERRIDING SYSTEM VALUE before VALUES.
const header = /INSERT INTO "([^"]+)"\."([^"]+)" \([^)]*\)(?: OVERRIDING (?:SYSTEM|USER) VALUE)? VALUES/y;

let i = 0;
let lineStart = true;
while (i < sql.length) {
  if (lineStart && sql.startsWith('--', i)) {
    // A whole-line comment outside any statement.
    const end = sql.indexOf('\n', i);
    i = end < 0 ? sql.length : end + 1;
    continue;
  }
  header.lastIndex = i;
  const match = lineStart ? header.exec(sql) : null;
  if (!match && lineStart && sql.startsWith('INSERT', i)) {
    // Never skip rows silently: an unrecognised INSERT fails the count.
    console.error('The dump contains an INSERT statement in an unexpected form; rows cannot be counted.');
    process.exit(1);
  }
  if (!match) {
    lineStart = sql[i] === '\n';
    i += 1;
    continue;
  }
  const table = `${match[1]}.${match[2]}`;
  i = header.lastIndex;
  let depth = 0;
  let quoted = false;
  let rows = 0;
  for (; i < sql.length; i += 1) {
    const c = sql[i];
    if (quoted) {
      if (c === "'") {
        if (sql[i + 1] === "'") i += 1;
        else quoted = false;
      }
    } else if (c === "'") {
      quoted = true;
    } else if (c === '(') {
      if (depth === 0) rows += 1;
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
    } else if (c === ';' && depth === 0) {
      break;
    }
  }
  if (quoted || depth !== 0 || i >= sql.length) {
    console.error(`Could not parse the rows of ${table}; the dump may be damaged.`);
    process.exit(1);
  }
  counts.set(table, (counts.get(table) ?? 0) + rows);
  i += 1;
  lineStart = false;
}

for (const [table, count] of [...counts].sort()) {
  console.log(`${table} ${count}`);
}
