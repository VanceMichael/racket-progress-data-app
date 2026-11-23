// 说明与回查：
//  - explainPerson：给家长说明自己孩子的课程建议、依据和证据不足之处。
//  - decisionReviews：回查每次换课登记时实际使用的评估版本，
//    以及事后到达的评分纠正；对失访学员明确纠正不能完整说明其水平。

import { personHistory, lostToFollowUp, knownEvents, resolveCorrections } from './timeline.mjs';
import { toCommonScale } from './comparability.mjs';
import { promotionReview } from './promotion.mjs';
import { occupancy } from './occupancy.mjs';

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

// 个人在指定知识截止时的有效评估版本（用于还原“当时看到的是哪份成绩”）。
function versionSnapshot(model, person, knownCutoff) {
  const history = personHistory(model, person, knownCutoff);
  const rows = [];
  for (const { period, events } of history.periods) {
    for (const event of events) {
      rows.push({
        event: event.event,
        period,
        form: event.form,
        action: event.action,
        score: event.score,
        conditions: event.conditions,
        level: event.stage ? event.stage.level : null,
      });
    }
  }
  return rows;
}

export function explainPerson(model, person, period, knownCutoff, evidence) {
  const stages = model.stagesByPerson.get(person) ?? [];
  if (stages.length === 0) return { person, error: '没有在册记录' };
  const history = personHistory(model, person, knownCutoff);

  // 起点与阶段：每个阶段的第一条有效成绩作为该阶段起点。
  const stageRows = stages.map(stage => {
    const inStage = [];
    for (const { period, events } of history.periods) {
      for (const event of events) {
        if (event.score === null) continue;
        if (event.stage && event.stage.from === stage.from && event.stage.to === stage.to) {
          inStage.push({ period, event });
        }
      }
    }
    inStage.sort((a, b) => a.period - b.period || a.event.event.localeCompare(b.event.event));
    const first = inStage[0] ?? null;
    return {
      level: stage.level,
      group: stage.group,
      from: stage.from,
      to: stage.to,
      change: stage.change,
      start: first ? { period: first.period, event: first.event.event, form: first.event.form, action: first.event.action, score: first.event.score } : null,
    };
  });

  // 当前证据：每个动作最近一条有效成绩及其共同尺度值；无法换算时说明原因。
  const currentStage = stages[stages.length - 1];
  const byAction = {};
  for (const { period, events } of history.periods) {
    for (const event of events) {
      if (event.score === null) continue;
      const level = event.stage ? event.stage.level : currentStage.level;
      const common = toCommonScale(event, level, evidence);
      const prev = byAction[event.action];
      if (!prev || prev.period < period || (prev.period === period && prev.event < event.event)) {
        byAction[event.action] = {
          event: event.event,
          period,
          form: event.form,
          score: event.score,
          level,
          common: common.value === null ? null : round(common.value),
          note: common.reason,
        };
      }
    }
  }

  const gaps = [];
  for (const item of evidence.perLink) {
    if (!item.linkable) {
      gaps.push(`动作 ${item.action}（${item.level}）：${item.reason}，两种形式的成绩只能各自呈现`);
    }
  }
  for (const { period: p, events } of history.periods) {
    for (const event of events) {
      if (event.score === null) {
        gaps.push(`第 ${p} 期 ${event.action} 没有有效成绩（${event.conditions === 'injury' ? '因伤缺考' : '缺考'}），该期不计入进步`);
      }
    }
  }

  const review = promotionReview(model, period, knownCutoff, evidence);
  const recommendation = review.rows.find(row => row.person === person) ?? null;

  const holds = [];
  const occ = occupancy(model, period, knownCutoff);
  for (const slot of occ.slots) {
    for (const holder of slot.holders) {
      if (holder.person === person) holds.push({ slot: slot.slot, level: slot.level, centre: slot.centre, basis: holder.basis });
    }
    for (const pending of slot.pending) {
      if (pending.person === person) holds.push({ slot: slot.slot, pending: true, state: pending.state, change: pending.change ?? null });
    }
  }

  return {
    person,
    period,
    knownCutoff,
    stages: stageRows,
    currentEvidence: byAction,
    recommendation: recommendation
      ? { status: recommendation.status, note: recommendation.note, target: recommendation.target, confirmation: recommendation.confirmation?.state ?? 'none' }
      : { status: 'off-roster', note: '当期不在册' },
    holds,
    gaps,
  };
}

// 回查：每次换课登记作出时使用的评估版本，以及之后到达的纠正。
export function decisionReviews(model, knownCutoff) {
  const cut = knownCutoff ?? Infinity;
  return model.changes
    .filter(change => change.known <= cut)
    .map(change => {
      const atDecision = versionSnapshot(model, change.person, change.known);
      const now = resolveCorrections(knownEvents(model, cut));
      const laterCorrections = [];
      for (const row of atDecision) {
        const chain = now.chainOf.get(row.event) ?? [row.event];
        const latestId = chain[chain.length - 1];
        if (latestId !== row.event) {
          const latest = now.byId.get(latestId);
          if (latest && latest.known > change.known) {
            laterCorrections.push({
              was: { event: row.event, score: row.score },
              now: { event: latest.event, score: latest.score, known: latest.known },
            });
          }
        }
      }
      const followUp = lostToFollowUp(model, change.person, cut);
      return {
        change: change.change,
        person: change.person,
        period: change.period,
        state: change.state,
        fromSlot: change.fromSlot,
        toSlot: change.toSlot,
        decidedWithKnowledgeOf: change.known,
        versionAtDecision: atDecision,
        laterCorrections,
        lostToFollowUp: followUp.lost
          ? { ...followUp, note: '该学员其后失访，事后评分纠正不能完整说明其当前水平' }
          : null,
      };
    });
}
