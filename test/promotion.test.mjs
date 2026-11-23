import assert from 'node:assert/strict';
import test from 'node:test';
import { promotionReview, summarizeReview } from '../src/promotion.mjs';
import { fixtureEvidence, fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const evidence = fixtureEvidence(model);
const review = promotionReview(model, 3, 4, evidence);
const row = id => review.rows.find(item => item.person === id);

test('潜在升级：年龄合格且各动作共同尺度均达门槛', () => {
  const a9 = row('A9');
  assert.equal(a9.status, 'potential');
  assert.equal(a9.confirmation.state, 'none');
  const net = a9.evidence.find(item => item.action === 'net');
  assert.equal(net.common, 11);
});

test('动作之间证据不一致时列入补测，不任选一条', () => {
  assert.equal(row('A13').status, 'retest');
  assert.match(row('A13').note, /不一致/);
  assert.equal(row('A31').status, 'retest');
});

test('最近一期缺考或伤休进入补测，未知成绩不能绕过安全限制', () => {
  assert.equal(row('A1').status, 'retest');
  assert.match(row('A1').note, /没有测评记录/);
  assert.equal(row('A4').status, 'retest');
  assert.equal(row('A5').status, 'retest');
});

test('年龄未达与共同尺度未达门槛分开呈现', () => {
  assert.equal(row('A8').status, 'ineligible-age');
  assert.equal(row('A18').status, 'below-threshold');
});

test('已在最高等级不再评审升级', () => {
  assert.equal(row('A2').status, 'already-top');
  assert.equal(row('A6').status, 'already-top');
});

test('确认状态区分已确认、待确认、已拒绝与未排课', () => {
  assert.equal(row('A4').confirmation.state, 'declined', 'M2 已被家长拒绝');
  const summary = summarizeReview(review);
  assert.ok(summary.potential.every(item => item.status === 'potential'));
  assert.equal(summary.confirmedAmongPotential.length, 0, '当前没有潜在升级已被家长确认');
});

test('知识截止影响评审：纠正未到时按当时版本判断', () => {
  const early = promotionReview(model, 2, 2, fixtureEvidence(model, 2));
  const a2 = early.rows.find(item => item.person === 'A2');
  assert.equal(a2.status, 'already-top');
  const a3 = early.rows.find(item => item.person === 'A3');
  assert.equal(a3.status, 'retest', 'A3 只有 wall drive 与伤休记录，无法换算共同尺度');
  const a1 = early.rows.find(item => item.person === 'A1');
  assert.equal(a1.status, 'ineligible-age');
});
