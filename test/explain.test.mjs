import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionReviews, explainPerson } from '../src/explain.mjs';
import { fixtureEvidence, fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const evidence = fixtureEvidence(model);

test('家长说明保留起点与阶段，升班后成绩不回填为升班前能力', () => {
  const a2 = explainPerson(model, 'A2', 3, 4, evidence);
  assert.equal(a2.stages.length, 2);
  assert.equal(a2.stages[0].level, 'beginner');
  assert.equal(a2.stages[0].start.event, 'T3', 'beginner 阶段起点只有升班前的 T3');
  assert.equal(a2.stages[1].level, 'intermediate');
  assert.equal(a2.stages[1].start.event, 'T10', 'intermediate 阶段起点使用纠正后的有效版本');
  assert.equal(a2.stages[1].start.score, 7);
});

test('家长说明给出建议、依据与证据不足', () => {
  const a9 = explainPerson(model, 'A9', 3, 4, evidence);
  assert.equal(a9.recommendation.status, 'potential');
  assert.ok(a9.gaps.some(gap => gap.includes('drive') && gap.includes('各自呈现')));
  const a11 = explainPerson(model, 'A11', 3, 4, evidence);
  assert.ok(a11.gaps.some(gap => gap.includes('因伤缺考')));
});

test('回查换课决定使用的是当时的评估版本', () => {
  const reviews = decisionReviews(model, 4);
  const m1 = reviews.find(item => item.change === 'M1');
  assert.equal(m1.decidedWithKnowledgeOf, 3);
  const ids = m1.versionAtDecision.map(row => row.event);
  assert.ok(ids.includes('T10'), '决定时纠正已到达，版本中是 T10');
  assert.ok(!ids.includes('T4'), '被取代的 T4 不在有效版本里');
});

test('失访学员：事后纠正不能完整说明其水平', () => {
  const reviews = decisionReviews(model, 4);
  const m4 = reviews.find(item => item.change === 'M4');
  assert.ok(m4.lostToFollowUp);
  assert.match(m4.lostToFollowUp.note, /不能完整说明/);
});

test('知识截止限制回查范围：未知的转班登记不出现', () => {
  const reviews = decisionReviews(model, 3);
  assert.ok(!reviews.some(item => item.change === 'M4'), 'M4 第 4 期才知悉');
  assert.ok(reviews.some(item => item.change === 'M1'));
});
