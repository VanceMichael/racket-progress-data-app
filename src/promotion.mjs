// 升级评审：按评估证据判断哪些孩子可以考虑升级、哪些应补测。
// 潜在升级（证据达到共同尺度门槛且年龄合格）与真实确认（家长已确认的排课）分开呈现。
// 安全限制：未知成绩（伤休/缺考/未测）不能绕过门槛，一律进入补测名单。
// 每个登记动作分别核对共同尺度；动作之间证据不一致时列入补测，而不是任选一条。

import { nextLevel } from './model.mjs';
import { personHistory, stageAt } from './timeline.mjs';
import { toCommonScale } from './comparability.mjs';

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

// 当前阶段内、各登记动作的最近有效成绩及共同尺度值（按知识截止过滤）。
// 同一动作同一期有多条时，优先新形式的直接测量，其次才是换算值。
function actionEvidence(model, person, stage, evidence, knownCutoff) {
  const history = personHistory(model, person, knownCutoff);
  const actions = [...new Set(model.links.filter(link => link.level === stage.level).map(link => link.action))];
  const perAction = [];
  for (const action of actions) {
    const candidates = [];
    for (const { period, events } of history.periods) {
      for (const event of events) {
        if (event.action !== action || event.score === null) continue;
        if (!event.stage || event.stage.level !== stage.level) continue;
        if (event.period < stage.from || event.period > stage.to) continue;
        const common = toCommonScale(event, stage.level, evidence);
        candidates.push({
          event: event.event,
          period,
          form: event.form,
          score: event.score,
          common: common.value,
          note: common.reason,
          direct: common.via === 'direct' ? 1 : 0,
        });
      }
    }
    candidates.sort((a, b) => a.period - b.period || a.direct - b.direct || a.event.localeCompare(b.event));
    const latest = candidates[candidates.length - 1] ?? null;
    perAction.push(latest
      ? { action, event: latest.event, period: latest.period, form: latest.form, score: latest.score, common: latest.common === null ? null : round(latest.common), note: latest.note }
      : { action, common: null, note: '当前阶段没有该动作的有效成绩' });
  }
  return perAction;
}

// 最近一期在当前阶段是否有有效成绩；没有时区分因伤缺考与未参加测评。
function latestPeriodGap(model, person, stage, period, knownCutoff) {
  const history = personHistory(model, person, knownCutoff);
  const atPeriod = history.periods.find(item => item.period === period);
  const events = (atPeriod?.events ?? []).filter(event =>
    event.stage && event.stage.level === stage.level && event.period >= stage.from && event.period <= stage.to);
  if (events.some(event => event.score !== null)) return null;
  if (events.some(event => event.conditions === 'injury')) return `第 ${period} 期因伤缺考，安全限制不能由未知成绩绕过，需补测`;
  if (events.length === 0) return `第 ${period} 期没有测评记录，需补测`;
  return `第 ${period} 期没有有效成绩，需补测`;
}

// 家长确认状态：confirmed 改变占用，notified/proposed 只是待确认。
function confirmationState(model, person, targetLevel, period) {
  const holds = [];
  for (const notice of model.noticesByPerson.get(person) ?? []) {
    if (notice.period < period) continue;
    const course = model.coursesBySlot.get(notice.slot);
    if (!course || course.level !== targetLevel) continue;
    holds.push({ kind: 'notice', slot: notice.slot, period: notice.period, status: notice.status });
  }
  for (const change of model.changesByPerson.get(person) ?? []) {
    if (change.period < period) continue;
    const course = model.coursesBySlot.get(change.toSlot);
    if (!course || course.level !== targetLevel) continue;
    holds.push({ kind: 'change', change: change.change, slot: change.toSlot, period: change.period, status: change.state });
  }
  if (holds.some(hold => hold.status === 'confirmed')) return { state: 'confirmed', holds };
  if (holds.some(hold => hold.status === 'notified' || hold.status === 'proposed')) return { state: 'pending', holds };
  if (holds.length > 0) return { state: 'declined', holds };
  return { state: 'none', holds };
}

export function promotionReview(model, period, knownCutoff, evidence) {
  const rows = [];
  for (const person of model.people) {
    const stage = stageAt(model, person, period);
    if (!stage) continue;
    const target = nextLevel(model, stage.level);
    const base = {
      person,
      centre: stage.centre,
      age: stage.age,
      level: stage.level,
      group: stage.group,
      target,
    };
    if (!target) {
      rows.push({ ...base, status: 'already-top', note: '已是最高登记等级' });
      continue;
    }
    const rule = model.ageRuleByLevel.get(target);
    const perAction = actionEvidence(model, person, stage, evidence, knownCutoff);
    const gap = latestPeriodGap(model, person, stage, period, knownCutoff);
    const ageOk = stage.age >= rule.minAge && stage.age <= rule.maxAge;
    const confirmation = confirmationState(model, person, target, period);
    const usable = perAction.filter(item => item.common !== null);
    const describe = perAction
      .map(item => `${item.action} ${item.common === null ? '无共同尺度成绩' : `共同尺度 ${item.common}`}`)
      .join('，');

    let status;
    let note;
    if (usable.length === 0) {
      status = 'retest';
      note = '当前阶段没有可换算到共同尺度的有效成绩，需补测';
    } else if (gap) {
      status = 'retest';
      note = gap;
    } else if (!ageOk) {
      status = 'ineligible-age';
      note = `年龄 ${stage.age} 不在 ${target} 的 ${rule.minAge}-${rule.maxAge} 岁范围`;
    } else {
      const meet = usable.filter(item => item.common >= rule.estimatedMinScore);
      if (meet.length === usable.length) {
        status = 'potential';
        note = `各动作均达门槛 ${rule.estimatedMinScore}（${describe}）`;
      } else if (meet.length === 0) {
        status = 'below-threshold';
        note = `各动作均低于门槛 ${rule.estimatedMinScore}（${describe}）`;
      } else {
        status = 'retest';
        note = `动作之间证据不一致（${describe}），需补测确认`;
      }
    }
    rows.push({
      ...base,
      status,
      note,
      evidence: perAction,
      rule: { minAge: rule.minAge, maxAge: rule.maxAge, estimatedMinScore: rule.estimatedMinScore },
      confirmation,
    });
  }
  return { period, knownCutoff, rows };
}

export function summarizeReview(review) {
  const by = status => review.rows.filter(row => row.status === status);
  return {
    potential: by('potential'),
    retest: by('retest'),
    ineligibleAge: by('ineligible-age'),
    belowThreshold: by('below-threshold'),
    alreadyTop: by('already-top'),
    confirmedAmongPotential: by('potential').filter(row => row.confirmation.state === 'confirmed'),
  };
}
