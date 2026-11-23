import { pathToFileURL } from 'node:url';
import { loadTables } from '../src/tables.mjs';
import { buildModel } from '../src/model.mjs';
import { linkingEvidence } from '../src/comparability.mjs';
import { groupDecomposition, compareGroups } from '../src/progress.mjs';
import { promotionReview } from '../src/promotion.mjs';
import { occupancy } from '../src/occupancy.mjs';
import { defaultPlans, evaluatePlan, comparePlans } from '../src/planning.mjs';
import { explainPerson, decisionReviews } from '../src/explain.mjs';
import {
  renderComparability,
  renderProgress,
  renderGroupComparison,
  renderPromotion,
  renderOccupancy,
  renderPlanComparison,
  renderExplain,
  renderDecisions,
} from '../src/report.mjs';

const USAGE = `用法：node tools/review.mjs <命令> [选项]

命令：
  comparability            核对联测证据，判断哪些共同动作可以跨形式合并
  progress                 分班分解进步、组成变化、伤停与缺考（--group 指定班，--compare A,B 比较两班，--action 指定动作）
  promotion                升级评审：可考虑升级 / 应补测 / 确认状态
  occupancy                名额占用：连续课程占用与待确认事项
  plan                     班组方案评估与比较（--plans S1+S3,S2+S5 指定，默认枚举极大可行方案）
  explain --person A9      给家长的个人说明：建议、依据与证据不足
  decisions                回查每次换课登记作出时使用的评估版本

选项：
  --data DIR               交接资料目录，可重复（各中心分别逐月录入后合并）
  --as-of N                凭据知识截止期（默认资料中最晚）
  --period N               当前期（默认在册记录中最晚）
  --format json|text       输出格式（默认 text）
`;

function parseArgs(argv) {
  const args = { data: [], format: 'text' };
  const rest = [...argv];
  args.command = rest.shift();
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === '--data') args.data.push(rest.shift());
    else if (flag === '--as-of') args.asOf = Number(rest.shift());
    else if (flag === '--period') args.period = Number(rest.shift());
    else if (flag === '--group') args.group = rest.shift();
    else if (flag === '--compare') args.compare = rest.shift();
    else if (flag === '--action') args.action = rest.shift();
    else if (flag === '--person') args.person = rest.shift();
    else if (flag === '--plans') args.plans = rest.shift();
    else if (flag === '--format') args.format = rest.shift();
    else throw new Error(`未知选项 ${flag}\n${USAGE}`);
  }
  return args;
}

function defaults(model, args) {
  const knownCutoff = args.asOf ?? Math.max(...model.events.map(event => event.known), ...model.changes.map(change => change.known));
  const period = args.period ?? Math.max(...model.rosters.map(stage => stage.to));
  return { knownCutoff, period };
}

function emit(payload, text, format) {
  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(text);
  }
}

export async function run(argv, defaultData) {
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help') {
    return USAGE;
  }
  const sources = args.data.length > 0 ? args.data : [defaultData];
  const { tables } = await loadTables(sources);
  const model = buildModel(tables);
  const { knownCutoff, period } = defaults(model, args);
  const evidence = linkingEvidence(model, knownCutoff);
  const json = args.format === 'json';

  switch (args.command) {
    case 'comparability': {
      emit(evidence, renderComparability(evidence, knownCutoff), args.format);
      return null;
    }
    case 'progress': {
      if (args.compare) {
        const [a, b] = args.compare.split(',');
        const action = args.action ?? evidence.perLink.find(item => item.linkable)?.action ?? model.links[0].action;
        const comparison = compareGroups(model, a, b, action, 1, period, knownCutoff, evidence);
        emit(comparison, renderGroupComparison(comparison), args.format);
        return null;
      }
      const groups = args.group ? [args.group] : [...new Set(model.rosters.map(stage => stage.group))].sort();
      const payload = groups.map(group => groupDecomposition(model, group, 1, period, knownCutoff, evidence));
      emit(payload, payload.map(renderProgress).join('\n\n'), args.format);
      return null;
    }
    case 'promotion': {
      const review = promotionReview(model, period, knownCutoff, evidence);
      emit(review, renderPromotion(review), args.format);
      return null;
    }
    case 'occupancy': {
      const result = occupancy(model, period, knownCutoff);
      emit(result, renderOccupancy(result), args.format);
      return null;
    }
    case 'plan': {
      const plans = args.plans
        ? args.plans.split(',').map((item, index) => ({ name: `方案${index + 1}（${item}）`, slots: item.split('+') }))
        : defaultPlans(model);
      const evaluations = plans.map(plan => evaluatePlan(model, plan, period, knownCutoff, evidence));
      const comparison = comparePlans(evaluations);
      emit(comparison, renderPlanComparison(comparison), args.format);
      return null;
    }
    case 'explain': {
      if (!args.person) throw new Error('explain 需要 --person');
      const explanation = explainPerson(model, args.person, period, knownCutoff, evidence);
      emit(explanation, renderExplain(explanation), args.format);
      return null;
    }
    case 'decisions': {
      const reviews = decisionReviews(model, knownCutoff);
      emit(reviews, renderDecisions(reviews), args.format);
      return null;
    }
    default:
      throw new Error(`未知命令 ${args.command}\n${USAGE}`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const defaultData = new URL('../fixtures/', import.meta.url);
  try {
    const message = await run(process.argv.slice(2), defaultData);
    if (message) console.log(message);
  } catch (error) {
    console.error(`错误：${error.message}`);
    process.exitCode = 1;
  }
}
