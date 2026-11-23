import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 各表用于跨目录合并去重的键。notices 与 rosters 允许同一主体多行，使用复合键。
const TABLE_KEYS = {
  rosters: ['id', 'from_period'],
  assessments: ['event'],
  'form-links': ['link'],
  courses: ['slot'],
  notices: ['person', 'period', 'slot'],
  staff: ['coach'],
  'age-rules': ['level'],
  'bridge-sessions': ['session'],
  'lesson-changes': ['change'],
};

export function parseTable(content, fields, table) {
  const lines = content.trimEnd().split(/\r?\n/);
  const header = lines.shift().split(',');
  if (header.length !== fields.length || header.some((field, index) => field !== fields[index])) {
    throw new Error(`${table} 的表头与格式约定不一致`);
  }
  return lines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== fields.length || line.includes('"')) {
      throw new Error(`${table} 第 ${index + 2} 行不是约定的字段格式`);
    }
    return Object.fromEntries(fields.map((field, position) => [field, cells[position]]));
  });
}

export function checkLinks(tables, links) {
  for (const [table, field, target, key] of links) {
    const keys = new Set(tables[target].map(row => row[key]));
    for (const row of tables[table]) {
      const value = row[field];
      if (value !== '' && value !== '-' && !keys.has(value)) {
        throw new Error(`${table}.${field} 的 ${value} 在 ${target}.${key} 中无对应记录`);
      }
    }
  }
}

function rowKey(table, row) {
  const spec = TABLE_KEYS[table];
  if (!spec) return null;
  return spec.map(field => row[field]).join('|');
}

// 读取一个或多个交接目录（各中心可分别逐月维护），按表合并并检查引用。
// 后面的目录只追加新记录；同一键重复出现视为资料冲突，直接报错。
export async function loadTables(sources) {
  const dirs = (Array.isArray(sources) ? sources : [sources]);
  let format = null;
  const tables = {};
  const seen = {};
  for (const dir of dirs) {
    const source = typeof dir === 'string' ? pathToFileURL(resolve(dir) + '/') : dir;
    const current = JSON.parse(await readFile(new URL('format.json', source), 'utf8'));
    if (format && JSON.stringify(Object.keys(current.tables)) !== JSON.stringify(Object.keys(format.tables))) {
      throw new Error(`${source} 的表清单与先读目录不一致`);
    }
    format ??= current;
    for (const [name, fields] of Object.entries(format.tables)) {
      const content = await readFile(new URL(`${name}.csv`, source), 'utf8');
      const rows = parseTable(content, fields, name);
      tables[name] ??= [];
      seen[name] ??= new Map();
      for (const row of rows) {
        const key = rowKey(name, row);
        if (key !== null) {
          if (seen[name].has(key)) {
            throw new Error(`${name} 的记录 ${key} 在 ${source} 与 ${seen[name].get(key)} 重复`);
          }
          seen[name].set(key, String(source));
        }
        tables[name].push(row);
      }
    }
  }
  for (const [name, rows] of Object.entries(tables)) {
    if (rows.length === 0) {
      throw new Error(`${name} 没有交接记录`);
    }
  }
  checkLinks(tables, format.links);
  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
  return { tables, format, counts };
}
