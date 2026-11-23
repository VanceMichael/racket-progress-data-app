// 测量可比性：先核对登记的共同动作是否在相同训练阶段及场地条件下，
// 由足够多的学员分别做过两种评估（联测证据）。证据足够才允许跨形式对齐，
// 否则各自呈现并说明原因。共同尺度取 right（新形式）一侧的量表。

import { effectiveVersion, stageAt } from './timeline.mjs';

function stats(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : null;
  return {
    n,
    mean,
    sd: variance === null ? null : Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

// 核对一条 form-link 的联测证据。逐条联测场次给出采信或排除原因，保证可回查。
// 场次的两端凭据不按位置对应形式，按事件的实际形式归位到 link.left / link.right。
export function linkEvidence(model, link, knownCutoff) {
  const accepted = [];
  const rejected = [];
  for (const session of model.sessions.filter(item => item.level === link.level)) {
    const first = effectiveVersion(model, session.leftEvent, knownCutoff);
    const second = effectiveVersion(model, session.rightEvent, knownCutoff);
    const reject = reason => rejected.push({ session: session.session, reason });
    if (!first || !second) {
      reject('联测凭据在截止月尚不可知');
      continue;
    }
    let left = null;
    let right = null;
    if (first.form === link.left && second.form === link.right) {
      left = first;
      right = second;
    } else if (first.form === link.right && second.form === link.left) {
      left = second;
      right = first;
    } else {
      reject(`形式与登记不符（${first.form}/${second.form}，应为 ${link.left}/${link.right}）`);
      continue;
    }
    if (left.action !== link.action || right.action !== link.action) {
      reject(`动作与登记不符（应为 ${link.action}）`);
      continue;
    }
    if (left.person !== right.person) {
      reject('两端不是同一学员');
      continue;
    }
    if (left.period !== session.period || right.period !== session.period) {
      reject('两次测量不在同一练习时段');
      continue;
    }
    if (left.conditions !== session.conditions || right.conditions !== session.conditions) {
      reject(`场地条件不一致（${left.conditions}/${right.conditions}，场次登记 ${session.conditions}）`);
      continue;
    }
    const stage = stageAt(model, left.person, session.period);
    if (!stage || stage.level !== link.level) {
      reject('学员当时不在登记的训练阶段');
      continue;
    }
    if (left.score === null || right.score === null) {
      reject('一端没有有效成绩（伤休或缺考不计入联测）');
      continue;
    }
    accepted.push({
      session: session.session,
      person: left.person,
      period: session.period,
      conditions: session.conditions,
      leftScore: left.score,
      rightScore: right.score,
      offset: right.score - left.score,
    });
  }
  const supporters = [...new Set(accepted.map(pair => pair.person))];
  const offsets = accepted.length > 0 ? stats(accepted.map(pair => pair.offset)) : null;
  const linkable = supporters.length >= link.supportMin;
  return {
    link: link.link,
    action: link.action,
    level: link.level,
    left: link.left,
    right: link.right,
    supportMin: link.supportMin,
    supporters,
    accepted,
    rejected,
    linkable,
    // 共同尺度 = right 形式量表；left 成绩 + offset 可对齐到共同尺度。
    offset: linkable ? { mean: round(offsets.mean), sd: round(offsets.sd), min: offsets.min, max: offsets.max, n: offsets.n } : null,
    reason: linkable
      ? null
      : `独立学员 ${supporters.length} 人，低于登记的最低 ${link.supportMin} 人，不能建立 ${link.left}↔${link.right} 对齐`,
  };
}

export function linkingEvidence(model, knownCutoff) {
  const perLink = model.links.map(link => linkEvidence(model, link, knownCutoff));
  const index = new Map(perLink.map(item => [`${item.action}|${item.level}`, item]));
  return { perLink, index };
}

// 把一条成绩换算到共同尺度。无法换算时返回 null 并给出原因。
export function toCommonScale(event, level, evidence) {
  if (event.score === null) {
    return { value: null, reason: '空成绩（伤休/缺考）不参与换算' };
  }
  const item = evidence.index.get(`${event.action}|${level}`);
  if (!item) {
    return { value: null, reason: `动作 ${event.action} 在等级 ${level} 没有登记的共同动作` };
  }
  if (event.form === item.right) {
    return { value: event.score, reason: null, via: 'direct' };
  }
  if (event.form === item.left) {
    if (!item.linkable) {
      return { value: null, reason: item.reason };
    }
    return { value: round(event.score + item.offset.mean), reason: null, via: 'linked', offset: item.offset.mean };
  }
  return { value: null, reason: `形式 ${event.form} 不在登记的对齐范围内` };
}

// 判断两条成绩是否可比。可比性取决于评估形式、场地条件和动作；
// 观察日期（period）由调用方用于选取比较窗口，这里不限制。
export function comparable(a, b, level, evidence) {
  if (a.action !== b.action) {
    return { ok: false, reason: `动作不同（${a.action} 与 ${b.action}）` };
  }
  if (a.conditions !== b.conditions) {
    return { ok: false, reason: `场地条件不同（${a.conditions} 与 ${b.conditions}）` };
  }
  if (a.form === b.form) {
    return { ok: true, kind: 'direct' };
  }
  const item = evidence.index.get(`${a.action}|${level}`);
  if (!item) {
    return { ok: false, reason: `动作 ${a.action} 没有登记的共同动作，跨形式不能合并` };
  }
  if (!item.linkable) {
    return { ok: false, reason: item.reason };
  }
  return { ok: true, kind: 'linked', offset: item.offset.mean, sd: item.offset.sd };
}
