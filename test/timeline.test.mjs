import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveVersion, knownEvents, lostToFollowUp, personHistory, resolveCorrections, stageAt } from '../src/timeline.mjs';
import { fixtureModel } from './helpers.mjs';

const model = await fixtureModel();

test('知识截止按凭据到达月过滤，不按测试月', () => {
  const at2 = knownEvents(model, 2).map(event => event.event);
  assert.ok(at2.includes('T4'));
  assert.ok(!at2.includes('T10'), 'T10 第 3 期才收到，截止第 2 期不可见');
  const at3 = knownEvents(model, 3).map(event => event.event);
  assert.ok(at3.includes('T10'));
});

test('评分纠正链：纠正到达后取代原成绩，到达前原成绩有效', () => {
  assert.equal(effectiveVersion(model, 'T4', 2).score, 12);
  assert.equal(effectiveVersion(model, 'T4', 3).score, 7);
  assert.equal(effectiveVersion(model, 'T4', 3).event, 'T10');
  const { effective, replacedBy } = resolveCorrections(knownEvents(model, 3));
  assert.equal(replacedBy.get('T4'), 'T10');
  assert.ok(!effective.some(event => event.event === 'T4'));
});

test('阶段归属：升班后的成绩只属于升班后的阶段，不回填', () => {
  assert.equal(stageAt(model, 'A2', 1).level, 'beginner');
  assert.equal(stageAt(model, 'A2', 2).level, 'intermediate');
  const history = personHistory(model, 'A2', 4);
  const period2 = history.periods.find(item => item.period === 2);
  assert.ok(period2.events.every(event => event.stage.level === 'intermediate'));
  const period1 = history.periods.find(item => item.period === 1);
  assert.ok(period1.events.every(event => event.stage.level === 'beginner'));
});

test('空成绩保留为空，不记为零分', () => {
  const history = personHistory(model, 'A11', 4);
  const period2 = history.periods.find(item => item.period === 2);
  assert.ok(period2.events.every(event => event.score === null && event.conditions === 'injury'));
});

test('失访判断：在册期内最后一条有效成绩之后再无有效成绩', () => {
  const a2 = lostToFollowUp(model, 'A2', 4);
  assert.equal(a2.lost, true);
  assert.equal(a2.lastValidPeriod, 2);
  assert.equal(a2.rosterEnd, 3);
  const a9 = lostToFollowUp(model, 'A9', 4);
  assert.equal(a9.lost, false);
});
