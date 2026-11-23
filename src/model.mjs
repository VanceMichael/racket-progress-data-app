// 把交接表解析成带类型的领域模型，并建立常用索引。
// 约定：空 score 解析为 null（伤休/缺考），绝不当作 0 分；
// period 是测试月，known 是收到凭据的月，两者都保留。

function toNumber(value, table, field, row) {
  if (value === '' || value === '-') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${table}.${field} 的 ${value} 不是数值（记录 ${JSON.stringify(row)}）`);
  }
  return parsed;
}

function toMinutes(time, row) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new Error(`courses.time 的 ${time} 不是 HH:MM（记录 ${JSON.stringify(row)}）`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export const LESSON_MINUTES = 60;

export function buildModel(tables) {
  const rosters = tables.rosters.map(row => ({
    id: row.id,
    centre: row.centre,
    age: toNumber(row.age, 'rosters', 'age', row),
    level: row.level,
    group: row.group,
    from: toNumber(row.from_period, 'rosters', 'from_period', row),
    to: toNumber(row.to_period, 'rosters', 'to_period', row),
    change: row.change,
  }));

  const events = tables.assessments.map(row => ({
    event: row.event,
    person: row.person,
    period: toNumber(row.period, 'assessments', 'period', row),
    known: toNumber(row.known_period, 'assessments', 'known_period', row),
    form: row.form,
    action: row.action,
    score: toNumber(row.score, 'assessments', 'score', row),
    conditions: row.conditions,
    supersedes: row.supersedes === '' || row.supersedes === '-' ? null : row.supersedes,
  }));

  const links = tables['form-links'].map(row => ({
    link: row.link,
    action: row.action,
    level: row.level,
    left: row.left,
    right: row.right,
    supportMin: toNumber(row.support_min, 'form-links', 'support_min', row),
  }));

  const sessions = tables['bridge-sessions'].map(row => ({
    session: row.session,
    period: toNumber(row.period, 'bridge-sessions', 'period', row),
    level: row.level,
    conditions: row.conditions,
    leftEvent: row.left_event,
    rightEvent: row.right_event,
  }));

  const courses = tables.courses.map(row => ({
    slot: row.slot,
    centre: row.centre,
    level: row.level,
    coach: row.coach,
    court: row.court,
    time: row.time,
    start: toMinutes(row.time, row),
    capacity: toNumber(row.capacity, 'courses', 'capacity', row),
  }));

  const notices = tables.notices.map(row => ({
    person: row.person,
    period: toNumber(row.period, 'notices', 'period', row),
    slot: row.slot,
    status: row.status,
  }));

  const staff = tables.staff.map(row => ({
    coach: row.coach,
    highLevelAuthority: row.high_level_authority === 'true',
    centres: row.centre_allowed.split('|').filter(Boolean),
  }));

  const ageRules = tables['age-rules'].map(row => ({
    level: row.level,
    minAge: toNumber(row.min_age, 'age-rules', 'min_age', row),
    maxAge: toNumber(row.max_age, 'age-rules', 'max_age', row),
    estimatedMinScore: toNumber(row.estimated_min_score, 'age-rules', 'estimated_min_score', row),
  }));

  const changes = tables['lesson-changes'].map(row => ({
    change: row.change,
    person: row.person,
    period: toNumber(row.period, 'lesson-changes', 'period', row),
    fromSlot: row.from_slot === '' || row.from_slot === '-' ? null : row.from_slot,
    toSlot: row.to_slot,
    state: row.state,
    known: toNumber(row.known_period, 'lesson-changes', 'known_period', row),
  }));

  const byKey = (rows, key) => new Map(rows.map(row => [row[key], row]));
  const groupBy = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      const id = row[key];
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(row);
    }
    return map;
  };

  const stagesByPerson = groupBy(rosters, 'id');
  for (const stages of stagesByPerson.values()) {
    stages.sort((a, b) => a.from - b.from);
  }
  const eventsByPerson = groupBy(events, 'person');
  for (const list of eventsByPerson.values()) {
    list.sort((a, b) => a.period - b.period || a.known - b.known || a.event.localeCompare(b.event));
  }

  // 等级顺序按共同尺度门槛从低到高，用于判断“下一级”。
  const levelOrder = [...ageRules].sort((a, b) => a.estimatedMinScore - b.estimatedMinScore).map(rule => rule.level);

  return {
    rosters,
    events,
    links,
    sessions,
    courses,
    notices,
    staff,
    ageRules,
    changes,
    levelOrder,
    stagesByPerson,
    eventsByPerson,
    eventsById: byKey(events, 'event'),
    coursesBySlot: byKey(courses, 'slot'),
    staffByCoach: byKey(staff, 'coach'),
    ageRuleByLevel: byKey(ageRules, 'level'),
    noticesByPerson: groupBy(notices, 'person'),
    changesByPerson: groupBy(changes, 'person'),
    people: [...stagesByPerson.keys()].sort(),
  };
}

export function nextLevel(model, level) {
  const index = model.levelOrder.indexOf(level);
  return index >= 0 && index + 1 < model.levelOrder.length ? model.levelOrder[index + 1] : null;
}
