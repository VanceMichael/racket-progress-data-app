// 班组方案评估：安全限制（教练/球场同时段只能一个班、容量、教练权限）、
// 已通知承诺的承接、入门机会是否保留、以及可比的平均进步。
// 两个方案平均进步相近但一个让某年龄段失去入门机会时，必须在结果里看得见。

import { LESSON_MINUTES } from './model.mjs';
import { occupancy } from './occupancy.mjs';
import { promotionReview } from './promotion.mjs';
import { personChange } from './progress.mjs';
import { stageAt } from './timeline.mjs';

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

export function timeOverlap(a, b) {
  return a.start < b.start + LESSON_MINUTES && b.start < a.start + LESSON_MINUTES;
}

export function slotConflicts(courses) {
  const conflicts = [];
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      const a = courses[i];
      const b = courses[j];
      if (!timeOverlap(a, b)) continue;
      const reasons = [];
      if (a.coach === b.coach) reasons.push(`教练 ${a.coach} 同时段`);
      if (a.court === b.court) reasons.push(`球场 ${a.court} 同时段`);
      if (reasons.length > 0) conflicts.push({ slots: [a.slot, b.slot], reasons });
    }
  }
  return conflicts;
}

export function staffIssues(model, courses) {
  const issues = [];
  const entryLevel = model.levelOrder[0];
  for (const course of courses) {
    const coach = model.staffByCoach.get(course.coach);
    if (!coach) {
      issues.push(`${course.slot}: 教练 ${course.coach} 没有登记`);
      continue;
    }
    if (!coach.centres.includes(course.centre)) {
      issues.push(`${course.slot}: 教练 ${course.coach} 未获准在中心 ${course.centre} 授课`);
    }
    if (course.level !== entryLevel && !coach.highLevelAuthority) {
      issues.push(`${course.slot}: 教练 ${course.coach} 没有 ${course.level} 等级的授课权限`);
    }
  }
  return issues;
}

// 评估一个方案。plan = { name, slots: [slotId...] }，period 为当前期（方案针对 period+1）。
// 承诺基数按目标期计算：在目标期之前已确认的转班（如 M4）已改变实际占用。
export function evaluatePlan(model, plan, period, knownCutoff, evidence) {
  const targetPeriod = period + 1;
  const open = model.courses.filter(course => plan.slots.includes(course.slot));
  const unknown = plan.slots.filter(slot => !model.coursesBySlot.has(slot));
  const conflicts = slotConflicts(open);
  const staff = staffIssues(model, open);

  // 已通知/已确认的承诺：方案内开班才接得住，否则列为待转移（需家长确认才算数）。
  const current = occupancy(model, targetPeriod, knownCutoff);
  const honored = [];
  const displaced = [];
  for (const slot of current.slots) {
    for (const holder of slot.holders) {
      const record = { person: holder.person, slot: slot.slot, centre: slot.centre, level: slot.level, basis: holder.basis };
      if (plan.slots.includes(slot.slot)) honored.push(record);
      else displaced.push({ ...record, note: '方案不开此班，需家长确认转班后才改变占用' });
    }
  }

  const capacity = open.map(course => {
    const held = current.slots.find(slot => slot.slot === course.slot)?.holders.length ?? 0;
    return { slot: course.slot, centre: course.centre, level: course.level, capacity: course.capacity, held, free: course.capacity - held };
  });

  // 潜在升级 vs 真实确认：升级名额需求按中心与目标级汇总，与空位对照。
  const review = promotionReview(model, period, knownCutoff, evidence);
  const demand = {};
  for (const row of review.rows.filter(item => item.status === 'potential')) {
    const key = `${row.centre}|${row.target}`;
    demand[key] ??= { centre: row.centre, level: row.target, potential: 0, confirmed: 0, people: [] };
    demand[key].potential += 1;
    if (row.confirmation.state === 'confirmed') demand[key].confirmed += 1;
    demand[key].people.push(row.person);
  }
  const upgradeFit = Object.values(demand).map(item => {
    const free = capacity
      .filter(slot => slot.centre === item.centre && slot.level === item.level)
      .reduce((sum, slot) => sum + slot.free, 0);
    return { ...item, freeSeats: free, fits: free >= item.potential };
  });

  // 入门机会：当前课表提供的 (中心, 等级) 与方案对比，丢失的给出受影响年龄段。
  const currentOffering = new Set(model.courses.map(course => `${course.centre}|${course.level}`));
  const planOffering = new Set(open.map(course => `${course.centre}|${course.level}`));
  const entryLoss = [];
  for (const offering of currentOffering) {
    if (planOffering.has(offering)) continue;
    const [centre, level] = offering.split('|');
    const rule = model.ageRuleByLevel.get(level);
    const affected = model.rosters.filter(stage =>
      stage.centre === centre && stage.level === level && stage.from <= period && stage.to >= period);
    const ages = [...new Set(affected.map(stage => stage.age))].sort((a, b) => a - b);
    entryLoss.push({
      centre,
      level,
      isEntry: level === model.levelOrder[0],
      ruleAges: rule ? `${rule.minAge}-${rule.maxAge}` : null,
      enrolled: affected.length,
      enrolledAges: ages,
      note: level === model.levelOrder[0]
        ? `中心 ${centre} 将失去 ${rule?.minAge}-${rule?.maxAge} 岁的入门机会`
        : `中心 ${centre} 将失去 ${level} 课程`,
    });
  }

  // 平均进步：方案承接的在册学员在共同尺度上的最近可比变化。
  const linkableAction = evidence.perLink.find(item => item.linkable)?.action ?? null;
  const progresses = [];
  if (linkableAction) {
    const people = new Set([...honored, ...displaced].map(item => item.person));
    for (const person of people) {
      if (!stageAt(model, person, period)) continue;
      const change = personChange(model, person, linkableAction, 1, period, knownCutoff, evidence);
      if (change.ok) progresses.push({ person, change: change.change });
    }
  }
  const values = progresses.map(item => item.change);
  const mean = values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const sd = values.length > 1
    ? round(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)))
    : null;

  return {
    name: plan.name,
    slots: plan.slots,
    feasible: unknown.length === 0 && conflicts.length === 0 && staff.length === 0,
    unknownSlots: unknown,
    conflicts,
    staffIssues: staff,
    commitments: { honored, displaced },
    capacity,
    upgradeDemand: upgradeFit,
    entryLoss,
    progress: { action: linkableAction, n: values.length, mean, sd, detail: progresses },
  };
}

// 方案对比：平均进步相近（差值不超过 tolerance）但入门机会损失不同的组合要标出来。
export function comparePlans(evaluations, tolerance = 1) {
  const flags = [];
  for (let i = 0; i < evaluations.length; i += 1) {
    for (let j = i + 1; j < evaluations.length; j += 1) {
      const a = evaluations[i];
      const b = evaluations[j];
      if (a.progress.mean === null || b.progress.mean === null) continue;
      if (Math.abs(a.progress.mean - b.progress.mean) > tolerance) continue;
      const lossA = a.entryLoss.filter(loss => loss.isEntry);
      const lossB = b.entryLoss.filter(loss => loss.isEntry);
      if (lossA.length !== lossB.length) {
        const worse = lossA.length > lossB.length ? a : b;
        const better = lossA.length > lossB.length ? b : a;
        flags.push(
          `${a.name} 与 ${b.name} 平均进步相近（${a.progress.mean} vs ${b.progress.mean}），` +
          `但 ${worse.name} 会让 ${worse.entryLoss.filter(loss => loss.isEntry).map(loss => `中心 ${loss.centre} 的 ${loss.ruleAges} 岁`).join('、')}失去现有入门机会，` +
          `${better.name} 不会`,
        );
      }
    }
  }
  return { evaluations, flags };
}

// 默认候选：所有无冲突且人员合规的极大开班组合。
export function defaultPlans(model) {
  const slots = model.courses.map(course => course.slot);
  const feasible = [];
  for (let mask = 1; mask < 2 ** slots.length; mask += 1) {
    const picked = slots.filter((_, index) => mask & (2 ** index));
    const courses = model.courses.filter(course => picked.includes(course.slot));
    if (slotConflicts(courses).length === 0 && staffIssues(model, courses).length === 0) {
      feasible.push(picked);
    }
  }
  const maximal = feasible.filter(picked =>
    !feasible.some(other => other.length > picked.length && picked.every(slot => other.includes(slot))));
  return maximal.map(picked => ({ name: `方案 ${picked.join('+')}`, slots: picked }));
}
