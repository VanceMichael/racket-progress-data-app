import assert from 'node:assert/strict';
import test from 'node:test';
import { occupancy } from '../src/occupancy.mjs';
import { fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const slot = (result, id) => result.slots.find(item => item.slot === id);

test('连续课程占用：notified/confirmed 占名额，proposed 不占', () => {
  const result = occupancy(model, 3, 4);
  assert.deepEqual(slot(result, 'S1').holders.map(h => h.person).sort(), ['A1', 'A3']);
  assert.deepEqual(slot(result, 'S2').holders.map(h => h.person), ['A2']);
  assert.deepEqual(slot(result, 'S4').holders.map(h => h.person), ['A6'], 'A6 经确认转班 M3 占用，proposed 通知本身不占');
  assert.equal(slot(result, 'S4').used, 1);
  assert.equal(slot(result, 'S4').free, 0);
});

test('proposed/declined 转班不改变占用，只列为待确认', () => {
  const result = occupancy(model, 3, 4);
  assert.ok(slot(result, 'S1').pending.some(p => p.change === 'M1'));
  assert.ok(slot(result, 'S2').pending.some(p => p.change === 'M1'));
  assert.deepEqual(slot(result, 'S3').holders.map(h => h.person), ['A4'], 'M2 declined，A4 仍占 S3');
});

test('confirmed 转班在确认期改变实际占用', () => {
  const before = occupancy(model, 3, 4);
  assert.ok(slot(before, 'S1').holders.some(h => h.person === 'A1'));
  const after = occupancy(model, 4, 4);
  assert.deepEqual(slot(after, 'S1').holders.map(h => h.person), ['A3'], 'M4 确认后 A1 离开 S1');
  assert.deepEqual(slot(after, 'S5').holders.map(h => h.person), ['A1']);
});

test('知识截止之前的确认不影响当时占用', () => {
  const result = occupancy(model, 4, 3);
  assert.ok(slot(result, 'S1').holders.some(h => h.person === 'A1'), 'M4 第 4 期才知悉，截止第 3 期时 A1 仍占 S1');
  assert.equal(slot(result, 'S5').holders.length, 0);
});

test('伤停学员的名额仍被占用并明确标出', () => {
  const result = occupancy(model, 3, 4);
  const a3 = slot(result, 'S1').holders.find(h => h.person === 'A3');
  assert.ok(a3.flags.some(flag => flag.includes('因伤停训')));
});
