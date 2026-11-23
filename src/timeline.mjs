// 时间线：按 known_period 还原“某一月为止实际掌握的评估版本”，
// 解析裁判评分纠正链（supersedes），并把每条成绩归属到当时所处的训练阶段。
// 阶段归属是防回填的关键：升班后的成绩只属于升班后的阶段。

export function stageAt(model, person, period) {
  const stages = model.stagesByPerson.get(person) ?? [];
  return stages.find(stage => stage.from <= period && period <= stage.to) ?? null;
}

// 截至 knownCutoff 已知的评估事件（按凭据到达月过滤，不按测试月）。
export function knownEvents(model, knownCutoff) {
  const cut = knownCutoff ?? Infinity;
  return model.events.filter(event => event.known <= cut);
}

// 在已知事件集合上解析纠正链。
// 返回：
//   effective —— 未被任何已知纠正取代的事件（当前有效版本）
//   replacedBy —— 被取代事件 -> 取代它的事件 id
//   chainOf   —— 任一事件 id -> 从原始到最新的完整链（仅限已知部分）
export function resolveCorrections(events) {
  const byId = new Map(events.map(event => [event.event, event]));
  const replacedBy = new Map();
  for (const event of events) {
    if (event.supersedes && byId.has(event.supersedes)) {
      replacedBy.set(event.supersedes, event.event);
    }
  }
  const effective = events.filter(event => !replacedBy.has(event.event));
  const chainOf = new Map();
  for (const event of events) {
    const chain = [event.event];
    let cursor = event.event;
    while (replacedBy.has(cursor)) {
      cursor = replacedBy.get(cursor);
      chain.push(cursor);
    }
    chainOf.set(event.event, chain);
  }
  return { effective, replacedBy, chainOf, byId };
}

// 某事件在指定知识截止时的有效版本（沿纠正链走到已知末端）。
export function effectiveVersion(model, eventId, knownCutoff) {
  const { replacedBy, byId } = resolveCorrections(knownEvents(model, knownCutoff));
  if (!byId.has(eventId)) return null;
  let cursor = eventId;
  while (replacedBy.has(cursor)) cursor = replacedBy.get(cursor);
  return byId.get(cursor);
}

// 个人历史：阶段 + 每个测试月的有效事件，事件均标注所属阶段。
// 没有覆盖该测试月的阶段时 stage 为 null（资料缺口，不猜测）。
export function personHistory(model, person, knownCutoff) {
  const stages = model.stagesByPerson.get(person) ?? [];
  const { effective } = resolveCorrections(knownEvents(model, knownCutoff));
  const mine = effective
    .filter(event => event.person === person)
    .sort((a, b) => a.period - b.period || a.event.localeCompare(b.event));
  const periods = new Map();
  for (const event of mine) {
    if (!periods.has(event.period)) periods.set(event.period, []);
    periods.get(event.period).push({ ...event, stage: stageAt(model, person, event.period) });
  }
  return {
    person,
    stages,
    periods: [...periods.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([period, events]) => ({ period, events })),
  };
}

// 失访判断：最后一条有效成绩之后，在册期内再没有任何有效成绩。
// 对失访学员，事后到达的评分纠正只能修正历史记录，不能完整说明其当前水平。
export function lostToFollowUp(model, person, knownCutoff) {
  const history = personHistory(model, person, knownCutoff);
  const valid = [];
  for (const { period, events } of history.periods) {
    for (const event of events) {
      if (event.score !== null) valid.push(period);
    }
  }
  if (valid.length === 0) return { lost: true, lastValidPeriod: null, reason: '没有任何有效成绩' };
  const lastValidPeriod = Math.max(...valid);
  const lastStage = history.stages[history.stages.length - 1];
  const rosterEnd = lastStage ? lastStage.to : lastValidPeriod;
  const laterPeriods = history.periods.filter(({ period }) => period > lastValidPeriod);
  const lost = rosterEnd > lastValidPeriod && laterPeriods.every(({ events }) => events.every(event => event.score === null));
  return {
    lost,
    lastValidPeriod,
    rosterEnd,
    reason: lost ? `第 ${lastValidPeriod} 期后在册至第 ${rosterEnd} 期但再无有效成绩` : null,
  };
}
