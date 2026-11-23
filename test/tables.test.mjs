import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadTables } from '../src/tables.mjs';
import { buildModel } from '../src/model.mjs';
import { FIXTURES } from './helpers.mjs';

// 各中心逐月录入：后一个目录只放增量行，合并后等同一起维护。
async function makeIncrementalDir(extraRows) {
  const dir = await mkdtemp(join(tmpdir(), 'review-merge-'));
  const format = JSON.parse(await readFile(new URL('format.json', FIXTURES), 'utf8'));
  await writeFile(join(dir, 'format.json'), JSON.stringify(format));
  for (const [name, fields] of Object.entries(format.tables)) {
    const rows = extraRows[name] ?? [];
    await writeFile(join(dir, `${name}.csv`), [fields.join(','), ...rows].join('\n') + '\n');
  }
  return dir;
}

test('多目录合并：中心各自录入的增量记录合并为一份资料', async () => {
  const extra = await makeIncrementalDir({
    assessments: ['T99,A9,4,4,motion,net,13,dry,-'],
    notices: ['A9,4,S2,notified'],
  });
  try {
    const { tables, counts } = await loadTables([FIXTURES, extra]);
    assert.equal(counts.assessments, 222);
    assert.equal(counts.notices, 6);
    const model = buildModel(tables);
    assert.ok(model.eventsById.has('T99'));
    assert.equal(model.eventsById.get('T99').score, 13);
  } finally {
    await rm(extra, { recursive: true, force: true });
  }
});

test('同一记录在两个目录重复出现时报告资料冲突', async () => {
  const dup = await makeIncrementalDir({ assessments: ['T1,A1,1,1,wall,net,8,dry,-'] });
  try {
    await assert.rejects(() => loadTables([FIXTURES, dup]), /重复/);
  } finally {
    await rm(dup, { recursive: true, force: true });
  }
});

test('数值字段非法时指出表与字段', async () => {
  const bad = await makeIncrementalDir({ assessments: ['T98,A9,四,4,motion,net,9,dry,-'] });
  try {
    const { tables } = await loadTables([FIXTURES, bad]);
    assert.throws(() => buildModel(tables), /assessments\.period/);
  } finally {
    await rm(bad, { recursive: true, force: true });
  }
});
