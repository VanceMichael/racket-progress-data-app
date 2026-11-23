// 进步证据：同一孩子的进步、班级组成变化、因伤停训、缺考分开呈现。
// 成绩只计入发生时所处阶段（升班后的成绩不回填为升班前能力）；
// 跨形式的变化只在联测证据充分时换算到共同尺度，否则各自呈现。

import { personHistory } from './timeline.mjs';
import { comparable, toCommonScale } from './comparability.mjs';

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

function summarize(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : null;
  return {
    n,
    mean: round(mean),
    sd: variance === null ? null : round(Math.sqrt(variance)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

// 个人某动作的成绩序列（有效版本、按测试月排序），每条标注所属阶段与共同尺度值。
export function personActionSeries(model, person, action, knownCutoff, evidence) {
  const history = personHistory(model, person, knownCutoff);
  const points = [];
  for (const { period, events } of history.periods) {
    for (const event of events) {
      if (event.action !== action) continue;
      const level = event.stage ? event.stage.level : null;
      const common = level ? toCommonScale(event, level, evidence) : { value: null, reason: '成绩不在任何登记阶段内' };
      points.push({
        event: event.event,
        period,
        form: event.form,
        conditions: event.conditions,
        score: event.score,
        level,
        group: event.stage ? event.stage.group : null,
        common: common.value,
        note: common.reason,
      });
    }
  }
  return points.sort((a, b) => a.period - b.period || a.event.localeCompare(b.event));
}

// 个人在窗口内、指定动作上的可比变化。只取窗口内属于当前阶段的成绩。
export function personChange(model, person, action, fromPeriod, toPeriod, knownCutoff, evidence) {
  const points = personActionSeries(model, person, action, knownCutoff, evidence)
    .filter(point => point.period >= fromPeriod && point.period <= toPeriod && point.score !== null);
  if (points.length < 2) {
    return { ok: false, reason: points.length === 0 ? '窗口内没有有效成绩' : '窗口内只有一个有效成绩', points };
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first.level !== last.level) {
    return { ok: false, reason: '两端不在同一训练阶段，不直接相减', points };
  }
  const judge = comparable(
    { action, form: first.form, conditions: first.conditions },
    { action, form: last.form, conditions: last.conditions },
    first.level,
    evidence,
  );
  if (!judge.ok) {
    return { ok: false, reason: judge.reason, points };
  }
  if (first.common === null || last.common === null) {
    return { ok: false, reason: '端点成绩无法换算到共同尺度', points };
  }
  return {
    ok: true,
    kind: judge.kind,
    from: { period: first.period, form: first.form, score: first.score, common: first.common },
    to: { period: last.period, form: last.form, score: last.score, common: last.common },
    change: round(last.common - first.common),
    calibrationSd: judge.kind === 'linked' ? judge.sd : null,
    points,
  };
}

const CHANGE_LABEL = {
  none: '在册变动',
  joined: '新加入',
  advanced: '升班',
  injury: '因伤停训',
};

// 班级分解：窗口期内每名在册成员的分类与可比变化。
export function groupDecomposition(model, groupId, fromPeriod, toPeriod, knownCutoff, evidence) {
  const members = model.rosters.filter(stage =>
    stage.group === groupId && stage.from <= toPeriod && stage.to >= fromPeriod);

  // 班级实际进行过测评的月份（用于区分“缺考”与“当月未安排测评”），按知识截止过滤。
  const cut = knownCutoff ?? Infinity;
  const assessedPeriods = new Set();
  for (const stage of members) {
    for (const event of model.eventsByPerson.get(stage.id) ?? []) {
      if (event.known > cut) continue;
      if (event.period >= Math.max(stage.from, fromPeriod) && event.period <= Math.min(stage.to, toPeriod)) {
        assessedPeriods.add(event.period);
      }
    }
  }

  const actions = [...new Set(model.links.map(link => link.action))];
  const rows = [];
  for (const stage of members) {
    const windowFrom = Math.max(stage.from, fromPeriod);
    const windowTo = Math.min(stage.to, toPeriod);
    // 离开原因看本人下一阶段：新阶段行上的 advanced 标记说明本阶段是因升班结束。
    const ownStages = model.stagesByPerson.get(stage.id) ?? [];
    const nextStage = ownStages[ownStages.findIndex(item => item === stage) + 1] ?? null;
    const leaveLabel = stage.change === 'injury'
      ? '因伤停训'
      : nextStage && nextStage.change === 'advanced'
        ? '升班'
        : (CHANGE_LABEL[stage.change] ?? stage.change);
    const composition = [];
    if (stage.from > fromPeriod) composition.push(`第 ${stage.from} 期${CHANGE_LABEL[stage.change] ?? stage.change}进入`);
    if (stage.to < toPeriod) {
      composition.push(`第 ${stage.to} 期后${leaveLabel}离开${nextStage && leaveLabel === '升班' ? `（进入 ${nextStage.level}/${nextStage.group}）` : ''}`);
    }

    const history = personHistory(model, stage.id, knownCutoff);
    const byPeriod = new Map(history.periods.map(item => [item.period, item.events]));
    const injuryPeriods = [];
    const absentPeriods = [];
    for (let period = windowFrom; period <= windowTo; period += 1) {
      const events = (byPeriod.get(period) ?? []).filter(event => event.stage === stage ||
        (event.stage && event.stage.from === stage.from && event.stage.to === stage.to));
      if (events.some(event => event.score !== null)) continue;
      if (events.some(event => event.conditions === 'injury')) {
        injuryPeriods.push(period);
      } else if (assessedPeriods.has(period)) {
        absentPeriods.push(period);
      }
    }

    const changes = {};
    for (const action of actions) {
      // 阶段归属：只取该阶段窗口内的成绩，升班后的成绩不回填。
      const result = personChange(model, stage.id, action, windowFrom, windowTo, knownCutoff, evidence);
      changes[action] = result.ok
        ? { ok: true, change: result.change, from: result.from, to: result.to, kind: result.kind }
        : { ok: false, reason: result.reason };
    }

    rows.push({
      person: stage.id,
      centre: stage.centre,
      age: stage.age,
      level: stage.level,
      window: [windowFrom, windowTo],
      composition,
      injuryPeriods,
      absentPeriods,
      leftRoster: stage.to < toPeriod ? leaveLabel : null,
      changes,
    });
  }

  // 班级层面：每个动作分别汇总“同一孩子”的可比变化，并保留观察范围与不确定性。
  const summary = {};
  for (const action of actions) {
    const changes = rows.map(row => row.changes[action]).filter(item => item.ok);
    const link = evidence.index.get(`${action}|${members[0]?.level ?? ''}`);
    const forms = new Set();
    for (const stage of members) {
      for (const event of model.eventsByPerson.get(stage.id) ?? []) {
        if (event.action === action) forms.add(event.form);
      }
    }
    const mixedForms = forms.size > 1;
    summary[action] = {
      pairs: changes.length,
      stats: changes.length > 0 ? summarize(changes.map(item => item.change)) : null,
      window: [fromPeriod, toPeriod],
      linkable: link ? link.linkable : false,
      note: !link
        ? '没有登记的共同动作'
        : !link.linkable && mixedForms
          ? `两种形式都出现过，但${link.reason}，跨形式部分只能各自呈现`
          : null,
    };
  }

  return {
    group: groupId,
    level: members[0]?.level ?? null,
    window: [fromPeriod, toPeriod],
    assessedPeriods: [...assessedPeriods].sort((a, b) => a - b),
    counts: {
      roster: rows.length,
      withPairs: rows.filter(row => Object.values(row.changes).some(item => item.ok)).length,
      composition: rows.filter(row => row.composition.length > 0).length,
      injury: rows.filter(row => row.injuryPeriods.length > 0 || row.leftRoster === '因伤停训').length,
      absent: rows.filter(row => row.absentPeriods.length > 0).length,
    },
    members: rows,
    summary,
  };
}

// 班级比较：保留各自的观察范围与不确定性；证据单薄时明确说出，避免误停小班。
export const THIN_EVIDENCE_PAIRS = 3;

export function compareGroups(model, groupA, groupB, action, fromPeriod, toPeriod, knownCutoff, evidence) {
  const left = groupDecomposition(model, groupA, fromPeriod, toPeriod, knownCutoff, evidence);
  const right = groupDecomposition(model, groupB, fromPeriod, toPeriod, knownCutoff, evidence);
  const sides = [left, right].map(item => ({
    group: item.group,
    level: item.level,
    window: item.window,
    assessedPeriods: item.assessedPeriods,
    counts: item.counts,
    action: item.summary[action],
  }));
  const link = evidence.index.get(`${action}|${left.level ?? ''}`);
  const warnings = [];
  if (!link) {
    warnings.push(`动作 ${action} 没有登记的共同动作，两班不能合并比较`);
  } else if (!link.linkable) {
    warnings.push(`${link.reason}；两班跨形式部分各自呈现，不合并`);
  }
  for (const side of sides) {
    if ((side.action.pairs ?? 0) < THIN_EVIDENCE_PAIRS) {
      warnings.push(
        `${side.group} 只有 ${side.action.pairs} 对可比成绩（窗口第 ${side.window[0]}-${side.window[1]} 期），` +
        '证据单薄，不足以据此判断教学效果或停开班级');
    }
  }
  const both = sides.every(side => side.action.stats);
  return {
    action,
    sides,
    difference: both ? round(sides[1].action.stats.mean - sides[0].action.stats.mean) : null,
    warnings,
  };
}
