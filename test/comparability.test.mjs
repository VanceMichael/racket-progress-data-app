import assert from 'node:assert/strict';
import test from 'node:test';
import { comparable, linkEvidence, linkingEvidence, toCommonScale } from '../src/comparability.mjs';
import { fixtureEvidence, fixtureModel } from './helpers.mjs';

const model = await fixtureModel();
const evidence = fixtureEvidence(model);

test('net 共同动作联测证据充分，可合并并给出量表差', () => {
  const net = evidence.perLink.find(item => item.action === 'net');
  assert.equal(net.linkable, true);
  assert.deepEqual(net.supporters.sort(), ['A1', 'A4', 'A8', 'A9']);
  assert.equal(net.offset.mean, -1.25);
  assert.equal(net.offset.sd, 0.5);
  assert.equal(net.offset.min, -2);
  assert.equal(net.offset.max, -1);
});

test('drive 共同动作独立学员不足，不能合并并说明原因', () => {
  const drive = evidence.perLink.find(item => item.action === 'drive');
  assert.equal(drive.linkable, false);
  assert.equal(drive.supporters.length, 2);
  assert.match(drive.reason, /最低 3 人/);
});

test('联测场次按动作归位，动作不符的场次被排除并记录原因', () => {
  const net = evidence.perLink.find(item => item.action === 'net');
  assert.deepEqual(net.rejected.map(item => item.session).sort(), ['B5', 'B6']);
  assert.ok(net.rejected.every(item => item.reason.includes('动作')));
});

test('共同尺度换算：旧形式经量表差对齐，新形式直接采用，证据不足拒绝换算', () => {
  assert.equal(toCommonScale({ action: 'net', form: 'wall', score: 9 }, 'beginner', evidence).value, 7.75);
  assert.equal(toCommonScale({ action: 'net', form: 'motion', score: 8 }, 'beginner', evidence).value, 8);
  const drive = toCommonScale({ action: 'drive', form: 'wall', score: 7 }, 'beginner', evidence);
  assert.equal(drive.value, null);
  assert.match(drive.reason, /最低 3 人/);
  const empty = toCommonScale({ action: 'net', form: 'motion', score: null }, 'beginner', evidence);
  assert.equal(empty.value, null);
});

test('可比性判断看形式、场地条件与动作', () => {
  const netWall = { action: 'net', form: 'wall', conditions: 'dry' };
  const netMotion = { action: 'net', form: 'motion', conditions: 'dry' };
  assert.equal(comparable(netWall, netMotion, 'beginner', evidence).ok, true);
  assert.equal(comparable(netMotion, netMotion, 'beginner', evidence).kind, 'direct');
  const driveWall = { action: 'drive', form: 'wall', conditions: 'dry' };
  const driveMotion = { action: 'drive', form: 'motion', conditions: 'dry' };
  assert.equal(comparable(driveWall, driveMotion, 'beginner', evidence).ok, false);
  const netWet = { action: 'net', form: 'motion', conditions: 'wet' };
  assert.equal(comparable(netMotion, netWet, 'beginner', evidence).ok, false);
  const other = { action: 'smash', form: 'motion', conditions: 'dry' };
  assert.equal(comparable(netMotion, other, 'beginner', evidence).ok, false);
});

test('知识截止影响联测证据：凭据未到时联测不成立', () => {
  const early = linkingEvidence(model, 1);
  const net = early.perLink.find(item => item.action === 'net');
  assert.equal(net.linkable, false);
  assert.equal(net.supporters.length, 0);
});
