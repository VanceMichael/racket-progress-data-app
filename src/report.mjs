// 文本报告：教研与排课共用的中文呈现。所有结论都带观察范围与不确定性说明。

const STATUS_LABEL = {
  potential: '可考虑升级（潜在）',
  retest: '应补测',
  'ineligible-age': '年龄未达',
  'below-threshold': '共同尺度未达门槛',
  'already-top': '已是最高等级',
  'off-roster': '当期不在册',
};

function line(text = '') {
  return text;
}

export function renderComparability(result, knownCutoff) {
  const out = [line(`联测证据核对（凭据截止第 ${knownCutoff} 期）`), ''];
  for (const item of result.perLink) {
    out.push(`共同动作 ${item.action}（${item.level}，${item.left}↔${item.right}，最低 ${item.supportMin} 人）`);
    if (item.linkable) {
      out.push(`  结论：可合并。独立学员 ${item.supporters.length} 人（${item.supporters.join('、')}）`);
      out.push(`  量表差（${item.right}−${item.left}）：均值 ${item.offset.mean}，标准差 ${item.offset.sd ?? '—'}，范围 [${item.offset.min}, ${item.offset.max}]`);
      out.push('  共同尺度取新形式一侧；旧形式成绩加量表差后对齐。');
    } else {
      out.push(`  结论：不能合并。${item.reason}。`);
      out.push('  处理：两种评估形式各自呈现变化，不计算跨形式进步。');
    }
    for (const rejected of item.rejected) {
      out.push(`  排除场次 ${rejected.session}：${rejected.reason}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function renderProgress(decomposition) {
  const out = [
    line(`班级 ${decomposition.group}（${decomposition.level}）第 ${decomposition.window[0]}-${decomposition.window[1]} 期分解`),
    `在册 ${decomposition.counts.roster} 人；有可比成绩对 ${decomposition.counts.withPairs} 人；` +
      `组成变化 ${decomposition.counts.composition} 人；因伤停训 ${decomposition.counts.injury} 人；缺考 ${decomposition.counts.absent} 人`,
    `班级测评月份：第 ${decomposition.assessedPeriods.join('、')} 期`,
    '',
  ];
  for (const [action, summary] of Object.entries(decomposition.summary)) {
    out.push(`动作 ${action}：可比成绩对 ${summary.pairs} 对（观察窗口第 ${summary.window[0]}-${summary.window[1]} 期）`);
    if (summary.stats) {
      out.push(`  同一孩子平均变化 ${summary.stats.mean}（标准差 ${summary.stats.sd ?? '—'}，范围 [${summary.stats.min}, ${summary.stats.max}]，n=${summary.stats.n}）`);
    }
    if (summary.note) out.push(`  注意：${summary.note}`);
  }
  out.push('');
  for (const member of decomposition.members) {
    const parts = [`${member.person}（${member.age} 岁，窗口第 ${member.window[0]}-${member.window[1]} 期）`];
    if (member.composition.length > 0) parts.push(`组成：${member.composition.join('；')}`);
    if (member.injuryPeriods.length > 0) parts.push(`因伤停训：第 ${member.injuryPeriods.join('、')} 期`);
    if (member.absentPeriods.length > 0) parts.push(`缺考：第 ${member.absentPeriods.join('、')} 期`);
    for (const [action, change] of Object.entries(member.changes)) {
      if (change.ok) {
        parts.push(`${action} 变化 ${change.change}（第 ${change.from.period} 期 ${change.from.form}=${change.from.score} → 第 ${change.to.period} 期 ${change.to.form}=${change.to.score}，共同尺度 ${change.from.common}→${change.to.common}${change.kind === 'linked' ? '，经联测对齐' : ''}）`);
      }
    }
    out.push(`  ${parts.join('；')}`);
  }
  return out.join('\n');
}

export function renderGroupComparison(comparison) {
  const out = [line(`班级比较：动作 ${comparison.action}`), ''];
  for (const side of comparison.sides) {
    const stats = side.action.stats;
    out.push(`${side.group}（${side.level}，窗口第 ${side.window[0]}-${side.window[1]} 期，测评月份 ${side.assessedPeriods.join('/')}）`);
    out.push(`  在册 ${side.counts.roster}，可比成绩对 ${side.action.pairs}，组成变化 ${side.counts.composition}，伤停 ${side.counts.injury}，缺考 ${side.counts.absent}`);
    if (stats) {
      out.push(`  平均变化 ${stats.mean} ± ${stats.sd ?? '—'}（范围 [${stats.min}, ${stats.max}]，n=${stats.n}）`);
    } else {
      out.push('  没有可比成绩对');
    }
  }
  if (comparison.difference !== null) {
    out.push(`均值差（后者−前者）：${comparison.difference}（仅描述观察范围，不作超出数据的推断）`);
  }
  for (const warning of comparison.warnings) {
    out.push(`⚠ ${warning}`);
  }
  return out.join('\n');
}

export function renderPromotion(review) {
  const out = [line(`升级评审（当前第 ${review.period} 期，凭据截止第 ${review.knownCutoff} 期）`), ''];
  const groups = [
    ['potential', '可考虑升级（潜在，不等于已确认）'],
    ['retest', '应补测'],
    ['ineligible-age', '年龄未达'],
    ['below-threshold', '共同尺度未达门槛'],
    ['already-top', '已是最高等级'],
  ];
  for (const [status, title] of groups) {
    const rows = review.rows.filter(row => row.status === status);
    if (rows.length === 0) continue;
    out.push(`${title}：${rows.length} 人`);
    for (const row of rows) {
      const evidence = Array.isArray(row.evidence) && row.evidence.length > 0
        ? `依据：${row.evidence.map(item => item.common === null
            ? `${item.action} 无共同尺度成绩`
            : `${item.action} 共同尺度 ${item.common}（${item.event}，第 ${item.period} 期 ${item.form}=${item.score}）`).join('；')}`
        : '无可用依据';
      const confirmation = row.confirmation && row.confirmation.state !== 'none'
        ? `；排课确认状态：${{ confirmed: '已确认', pending: '待家长确认', declined: '家长已拒绝' }[row.confirmation.state] ?? row.confirmation.state}`
        : '';
      out.push(`  ${row.person}（${row.centre}，${row.age} 岁，${row.level}→${row.target}）：${row.note}。${evidence}${confirmation}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export function renderOccupancy(result) {
  const out = [line(`名额占用（第 ${result.period} 期，凭据截止第 ${result.knownCutoff} 期）`), ''];
  for (const slot of result.slots) {
    out.push(`${slot.slot}（${slot.centre} ${slot.level}，${slot.coach}/${slot.court} ${slot.time}，容量 ${slot.capacity}）：占用 ${slot.used}，空余 ${slot.free}${slot.overCapacity ? '，超容量！' : ''}`);
    for (const holder of slot.holders) {
      const flags = holder.flags.length > 0 ? `（${holder.flags.join('；')}）` : '';
      out.push(`  ${holder.person} — ${holder.basis}${flags}`);
    }
    for (const pending of slot.pending) {
      if (pending.kind === 'change') {
        out.push(`  待确认：${pending.person} 转班 ${pending.change}（${pending.fromSlot ?? '无原班'}→${pending.toSlot}，${pending.state}，不改变占用）`);
      } else {
        out.push(`  待确认：${pending.person} 通知（${pending.state}，不占名额）`);
      }
    }
  }
  return out.join('\n');
}

export function renderPlanComparison(comparison) {
  const out = [line('班组方案比较'), ''];
  for (const evaluation of comparison.evaluations) {
    out.push(`${evaluation.name}：开班 ${evaluation.slots.join('、')}${evaluation.feasible ? '' : '（不可行）'}`);
    if (!evaluation.feasible) {
      for (const conflict of evaluation.conflicts) {
        out.push(`  冲突：${conflict.slots.join(' 与 ')} — ${conflict.reasons.join('；')}`);
      }
      for (const issue of evaluation.staffIssues) out.push(`  人员：${issue}`);
      for (const slot of evaluation.unknownSlots) out.push(`  未知班级：${slot}`);
      out.push('');
      continue;
    }
    out.push(`  承诺承接 ${evaluation.commitments.honored.length} 人，待转移 ${evaluation.commitments.displaced.length} 人`);
    for (const displaced of evaluation.commitments.displaced) {
      out.push(`    待转移：${displaced.person}（${displaced.slot}，${displaced.basis}）— ${displaced.note}`);
    }
    for (const capacity of evaluation.capacity) {
      out.push(`  ${capacity.slot}（${capacity.centre} ${capacity.level}）：容量 ${capacity.capacity}，已占 ${capacity.held}，空余 ${capacity.free}`);
    }
    for (const demand of evaluation.upgradeDemand) {
      out.push(`  升级需求 ${demand.centre} ${demand.level}：潜在 ${demand.potential} 人（已确认 ${demand.confirmed}），空位 ${demand.freeSeats}，${demand.fits ? '可容纳' : '容量不足'}`);
    }
    for (const loss of evaluation.entryLoss) {
      out.push(`  ⚠ ${loss.note}（当前在册 ${loss.enrolled} 人，年龄 ${loss.enrolledAges.join('/')}）`);
    }
    if (evaluation.progress.n > 0) {
      out.push(`  承接学员平均进步（${evaluation.progress.action}，共同尺度）：${evaluation.progress.mean} ± ${evaluation.progress.sd ?? '—'}（n=${evaluation.progress.n}）`);
    } else {
      out.push('  承接学员没有可比进步数据');
    }
    out.push('');
  }
  for (const flag of comparison.flags) {
    out.push(`⚠ ${flag}`);
  }
  return out.join('\n');
}

export function renderExplain(explanation) {
  if (explanation.error) return `${explanation.person}：${explanation.error}`;
  const out = [line(`学员 ${explanation.person} 说明（当前第 ${explanation.period} 期，凭据截止第 ${explanation.knownCutoff} 期）`), ''];
  out.push('阶段与起点：');
  for (const stage of explanation.stages) {
    const start = stage.start
      ? `起点：第 ${stage.start.period} 期 ${stage.start.form} ${stage.start.action}=${stage.start.score}`
      : '起点：本阶段暂无有效成绩';
    out.push(`  第 ${stage.from}-${stage.to} 期 ${stage.level}/${stage.group}（${stage.change}）：${start}`);
  }
  out.push('当前证据（各动作最近有效成绩）：');
  for (const [action, item] of Object.entries(explanation.currentEvidence)) {
    const common = item.common === null ? `无法换算共同尺度（${item.note}）` : `共同尺度 ${item.common}`;
    out.push(`  ${action}：第 ${item.period} 期 ${item.form}=${item.score}（${item.level}），${common}`);
  }
  if (explanation.recommendation) {
    const rec = explanation.recommendation;
    out.push(`课程建议：${STATUS_LABEL[rec.status] ?? rec.status}${rec.target ? `（目标 ${rec.target}）` : ''} — ${rec.note}`);
    if (rec.confirmation && rec.confirmation !== 'none') {
      out.push(`排课确认状态：${{ confirmed: '已确认', pending: '待家长确认', declined: '家长已拒绝' }[rec.confirmation] ?? rec.confirmation}`);
    }
  }
  if (explanation.holds.length > 0) {
    out.push('名额与待确认事项：');
    for (const hold of explanation.holds) {
      out.push(hold.pending
        ? `  ${hold.slot}：待确认（${hold.state}${hold.change ? `，${hold.change}` : ''}）`
        : `  ${hold.slot}（${hold.centre} ${hold.level}）：${hold.basis}`);
    }
  }
  if (explanation.gaps.length > 0) {
    out.push('证据不足之处：');
    for (const gap of explanation.gaps) out.push(`  - ${gap}`);
  }
  return out.join('\n');
}

export function renderDecisions(reviews) {
  const out = [line('换课决定的评估版本回查'), ''];
  for (const review of reviews) {
    out.push(`${review.change}：${review.person} 第 ${review.period} 期 ${review.fromSlot ?? '无原班'}→${review.toSlot}（${review.state}，决定时凭据截止到第 ${review.decidedWithKnowledgeOf} 期）`);
    out.push('  决定时使用的评估版本：');
    if (review.versionAtDecision.length === 0) out.push('    （当时没有任何已知评估）');
    for (const row of review.versionAtDecision) {
      out.push(`    ${row.event}：第 ${row.period} 期 ${row.form} ${row.action}=${row.score ?? '无效'}（${row.level ?? '阶段未知'}，${row.conditions}）`);
    }
    for (const correction of review.laterCorrections) {
      out.push(`  事后纠正：${correction.was.event}=${correction.was.score} → ${correction.now.event}=${correction.now.score}（第 ${correction.now.known} 期才确认）`);
    }
    if (review.lostToFollowUp) {
      out.push(`  ⚠ ${review.lostToFollowUp.note}（${review.lostToFollowUp.reason}）`);
    }
    out.push('');
  }
  return out.join('\n');
}
