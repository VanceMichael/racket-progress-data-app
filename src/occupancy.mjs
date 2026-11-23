// 名额占用：已有 notified/confirmed 的连续课程一直占名额，
// 只有 confirmed 的转班（或资料撤销）才改变实际占用；
// proposed/declined 不释放原名额。空 from_slot 的确认表示没有原通知、直接新增占用。

import { stageAt } from './timeline.mjs';

const HOLDING_NOTICE = new Set(['notified', 'confirmed']);
const RELEASING_NOTICE = new Set(['withdrawn', 'cancelled']);

export function occupancy(model, period, knownCutoff) {
  const cut = knownCutoff ?? Infinity;
  const holdsByPerson = new Map();

  const personHolds = person => {
    if (!holdsByPerson.has(person)) holdsByPerson.set(person, new Map());
    return holdsByPerson.get(person);
  };

  const timeline = [];
  for (const notice of model.notices) {
    if (notice.period <= period) timeline.push({ kind: 'notice', at: notice.period, notice });
  }
  for (const change of model.changes) {
    if (change.state === 'confirmed' && change.period <= period && change.known <= cut) {
      timeline.push({ kind: 'change', at: change.period, change });
    }
  }
  timeline.sort((a, b) => a.at - b.at);

  for (const item of timeline) {
    if (item.kind === 'notice') {
      const { notice } = item;
      const holds = personHolds(notice.person);
      if (HOLDING_NOTICE.has(notice.status)) {
        holds.set(notice.slot, { basis: `通知(${notice.status}, 第 ${notice.period} 期)` });
      } else if (RELEASING_NOTICE.has(notice.status)) {
        holds.delete(notice.slot);
      }
    } else {
      const { change } = item;
      const holds = personHolds(change.person);
      if (change.fromSlot) holds.delete(change.fromSlot);
      holds.set(change.toSlot, { basis: `转班确认(${change.change}, 第 ${change.period} 期)` });
    }
  }

  const slots = new Map(model.courses.map(course => [course.slot, {
    slot: course.slot,
    centre: course.centre,
    level: course.level,
    coach: course.coach,
    court: course.court,
    time: course.time,
    capacity: course.capacity,
    holders: [],
    pending: [],
  }]));

  for (const [person, holds] of holdsByPerson) {
    for (const [slot, hold] of holds) {
      const entry = slots.get(slot);
      if (!entry) continue;
      const course = model.coursesBySlot.get(slot);
      const stage = stageAt(model, person, period);
      const stages = model.stagesByPerson.get(person) ?? [];
      const lastStage = stages[stages.length - 1] ?? null;
      const flags = [];
      if (!stage) flags.push('当期不在册');
      if (stage && stage.level !== course.level) flags.push(`跨级连续占用（在册 ${stage.level}，课程 ${course.level}）`);
      if (!stage && lastStage && lastStage.change === 'injury') flags.push('在册记录为因伤停训，名额仍被占用');
      entry.holders.push({ person, basis: hold.basis, flags });
    }
  }

  // 待确认事项：proposed/declined 的转班与 proposed 通知不影响占用，但要让排课看到。
  for (const change of model.changes) {
    if (change.state === 'confirmed' || change.period > period || change.known > cut) continue;
    for (const slot of [change.fromSlot, change.toSlot]) {
      if (slot && slots.has(slot)) {
        slots.get(slot).pending.push({
          kind: 'change', change: change.change, person: change.person,
          state: change.state, fromSlot: change.fromSlot, toSlot: change.toSlot,
        });
      }
    }
  }
  for (const notice of model.notices) {
    if (notice.status !== 'proposed' || notice.period > period) continue;
    if (slots.has(notice.slot)) {
      slots.get(notice.slot).pending.push({ kind: 'notice', person: notice.person, state: 'proposed' });
    }
  }

  const result = [...slots.values()].map(entry => ({
    ...entry,
    used: entry.holders.length,
    free: entry.capacity - entry.holders.length,
    overCapacity: entry.holders.length > entry.capacity,
  }));
  result.sort((a, b) => a.slot.localeCompare(b.slot));
  return { period, knownCutoff, slots: result };
}
