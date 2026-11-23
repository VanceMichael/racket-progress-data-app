import assert from 'node:assert/strict';
import test from 'node:test';
import { compareGroups, groupDecomposition, personChange } from '../src/progress.mjs';
import { fixtureEvidence, fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const evidence = fixtureEvidence(model);

test('同一孩子的进步：跨形式经联测对齐到共同尺度', () => {
  const change = personChange(model, 'A9', 'net', 1, 3, 4, evidence);
  assert.equal(change.ok, true);
  assert.equal(change.kind, 'linked');
  assert.equal(change.from.common, 7.75);
  assert.equal(change.to.common, 11);
  assert.equal(change.change, 3.25);
});

test('联测不足的动作跨形式不合并，同形式仍可直接比较', () => {
  const cross = personChange(model, 'A9', 'drive', 1, 3, 4, evidence);
  assert.equal(cross.ok, false);
  assert.match(cross.reason, /最低 3 人/);
  const direct = personChange(model, 'A7', 'drive', 2, 3, 4, evidence);
  assert.equal(direct.ok, true);
  assert.equal(direct.kind, 'direct');
  assert.equal(direct.change, 3);
});

test('升班后的成绩不回填：A2 在原班窗口只有升班前的一次成绩', () => {
  const g1 = groupDecomposition(model, 'G1', 1, 3, 4, evidence);
  const a2 = g1.members.find(member => member.person === 'A2');
  assert.deepEqual(a2.window, [1, 1]);
  assert.ok(a2.composition.some(text => text.includes('升班')));
  assert.equal(a2.changes.net.ok, false, '窗口内只有升班前一次成绩，升班后的成绩不参与');
});

test('班级分解区分进步、组成变化、伤停与缺考', () => {
  const g1 = groupDecomposition(model, 'G1', 1, 3, 4, evidence);
  assert.equal(g1.counts.roster, 21);
  assert.equal(g1.counts.composition, 5);
  assert.equal(g1.counts.injury, 3);
  assert.equal(g1.counts.absent, 1);
  const a3 = g1.members.find(member => member.person === 'A3');
  assert.equal(a3.leftRoster, '因伤停训');
  const a11 = g1.members.find(member => member.person === 'A11');
  assert.deepEqual(a11.injuryPeriods, [2]);
  const a1 = g1.members.find(member => member.person === 'A1');
  assert.deepEqual(a1.absentPeriods, [3]);
});

test('班级汇总保留观察范围与不确定性', () => {
  const g1 = groupDecomposition(model, 'G1', 1, 3, 4, evidence);
  assert.equal(g1.summary.net.pairs, 19);
  assert.equal(g1.summary.net.stats.n, 19);
  assert.ok(g1.summary.net.stats.sd > 0);
  assert.deepEqual(g1.summary.net.window, [1, 3]);
  assert.equal(g1.summary.drive.pairs, 3, 'drive 只有同期同形式的成绩对可比');
  assert.match(g1.summary.drive.note, /各自呈现/);
});

test('班级比较：证据不足的动作给出警示，小班不被误判', () => {
  const net = compareGroups(model, 'G1', 'G3', 'net', 1, 3, 4, evidence);
  assert.equal(typeof net.difference, 'number');
  assert.equal(net.warnings.length, 0);
  const drive = compareGroups(model, 'G1', 'G3', 'drive', 1, 3, 4, evidence);
  assert.ok(drive.warnings.some(text => text.includes('不合并')));
  const tiny = compareGroups(model, 'G2', 'G4', 'net', 1, 3, 4, evidence);
  assert.ok(tiny.warnings.some(text => text.includes('证据单薄')), '中级小班可比成绩太少时必须提示');
});
