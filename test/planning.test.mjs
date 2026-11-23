import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePlans, defaultPlans, evaluatePlan, slotConflicts, staffIssues, timeOverlap } from '../src/planning.mjs';
import { fixtureEvidence, fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const evidence = fixtureEvidence(model);
const course = id => model.coursesBySlot.get(id);

test('60 分钟课时内教练或球场被占只支持一个班', () => {
  assert.equal(timeOverlap(course('S1'), course('S5')), true, '18:00 与 18:30 的 60 分钟课重叠');
  const conflicts = slotConflicts(model.courses);
  const pair = (a, b) => conflicts.some(item => item.slots.includes(a) && item.slots.includes(b));
  assert.ok(pair('S1', 'S2'), '同一教练同时段');
  assert.ok(pair('S3', 'S4'), '同一教练同一球场同时段');
  assert.ok(pair('S1', 'S5'), '同一球场时段重叠');
  assert.ok(!pair('S2', 'S5'));
});

test('教练权限：未获准中心与高等级权限', () => {
  const s1 = { ...course('S1'), slot: 'X1', centre: 'S' };
  const issues = staffIssues(model, [s1]);
  assert.ok(issues.some(text => text.includes('未获准')));
});

test('默认候选为极大可行开班组合', () => {
  const plans = defaultPlans(model).map(plan => plan.slots.join('+')).sort();
  assert.deepEqual(plans, ['S1+S3', 'S1+S4', 'S2+S3', 'S2+S4', 'S2+S5']);
});

test('方案评估：承诺承接、待转移与入门机会损失', () => {
  const keep = evaluatePlan(model, { name: 'keep', slots: ['S1', 'S3'] }, 3, 4, evidence);
  assert.equal(keep.feasible, true);
  assert.equal(keep.entryLoss.filter(loss => loss.isEntry).length, 0, '双中心入门都保留');
  assert.ok(keep.entryLoss.some(loss => loss.level === 'intermediate'));
  const drop = evaluatePlan(model, { name: 'drop', slots: ['S2', 'S5'] }, 3, 4, evidence);
  assert.ok(drop.entryLoss.some(loss => loss.isEntry && loss.centre === 'S'), 'S 中心失去入门机会');
  const loss = drop.entryLoss.find(item => item.isEntry);
  assert.ok(loss.enrolled > 0);
  assert.ok(loss.enrolledAges.length > 0);
});

test('已确认转班进入承诺基数：S5 方案承接 A1，不开 S5 则列为待转移', () => {
  const withS5 = evaluatePlan(model, { name: 'with', slots: ['S2', 'S5'] }, 3, 4, evidence);
  assert.ok(withS5.commitments.honored.some(item => item.person === 'A1' && item.slot === 'S5'));
  const without = evaluatePlan(model, { name: 'without', slots: ['S1', 'S3'] }, 3, 4, evidence);
  assert.ok(without.commitments.displaced.some(item => item.person === 'A1' && item.slot === 'S5'));
});

test('方案比较：平均进步相近但入门机会损失不同的组合被标出', () => {
  const plans = defaultPlans(model);
  const evaluations = plans.map(plan => evaluatePlan(model, plan, 3, 4, evidence));
  const { flags } = comparePlans(evaluations);
  assert.ok(flags.length > 0);
  assert.ok(flags.some(flag => flag.includes('失去现有入门机会')));
  assert.ok(flags.some(flag => flag.includes('平均进步相近')));
});

test('不可行方案列出冲突原因', () => {
  const bad = evaluatePlan(model, { name: 'bad', slots: ['S1', 'S2'] }, 3, 4, evidence);
  assert.equal(bad.feasible, false);
  assert.ok(bad.conflicts.length > 0);
});
