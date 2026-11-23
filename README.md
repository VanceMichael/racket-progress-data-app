# 分阶羽毛球教学的进步证据与班级调配

业务资料均为合成记录。表头字段及跨表引用见 `fixtures/format.json`。

## 数据说明

period 以训练月为单位。known_period 是收到评估凭据的月，不等于测试月。rosters 的有效期含两端；injury 记录有伤休，空 score 不能记为零分。form-links 定义允许对齐的动作和最低独立学员数，量表差异也要检查同样场地条件。临界升班所需年龄与共同尺度分数见 age-rules，课堂安全限制不能由未知成绩绕过。
课程在登记时钟开课，每课 60 分钟，教练、球场在同期被占只支持一个班。已有 notified 或 confirmed 课程仍留名额，直到家长确认转班或取消。
bridge-sessions 中每行记录一个教学等级、同一练习时段内两次受控测量的对应凭据。两端的成绩仍按各自的表格口径记录，学员在联测之后的日常成绩不等同于联测。lesson-changes 单独登记家长答复。proposed 和 declined 都不会释放 from_slot，confirmed 才改变占用，空 from_slot 说明没有原通知。

CSV 使用 UTF-8、逗号分隔，无引号与内嵌换行。未提供的字段是空字符串，作为关系值的 `-` 表示不适用。多值字段用竖线分隔，数值和日期单位见业务约定。

## 资料检查

使用 Node.js 22.23.4，依赖仅为 Node.js 标准库。运行 `npm ci --ignore-scripts --offline` 准备工作区。

运行 `npm run check:materials` 检查合成交接资料的字段与记录引用。运行 `npm test` 检查交接资料的读取和校验。

## 进阶评估与排课应用

`npm run review -- <命令>`（即 `node tools/review.mjs`）供教研与排课人员使用。各中心把当月记录追加进自己的交接目录，用多个 `--data` 合并后重跑，即可重做下一批结论；`--as-of` 按凭据到达月还原任一月的评估版本，`--period` 指定当前期。

```
node tools/review.mjs comparability            核对联测证据：共同动作是否在同阶段、同场地条件下由足够学员分别做过两种评估
node tools/review.mjs progress [--group G1]    分班分解：同一孩子的进步 / 组成变化 / 伤停 / 缺考
node tools/review.mjs progress --compare G1,G3 --action net
                                               班级比较，保留观察范围与不确定性
node tools/review.mjs promotion                升级评审：可考虑升级（潜在）/ 应补测 / 年龄未达 / 未达门槛
node tools/review.mjs occupancy [--period 4]   名额占用：连续课程占用与待确认事项
node tools/review.mjs plan [--plans S1+S3,S2+S5]
                                               班组方案评估与比较（默认枚举极大可行方案）
node tools/review.mjs explain --person A9      给家长的说明：建议、依据与证据不足
node tools/review.mjs decisions                回查每次换课登记作出时使用的评估版本
```

通用选项：`--data DIR`（可重复，各中心目录合并，重复记录报错）、`--as-of N`、`--period N`、`--format json|text`。

### 口径约定

- **可比性**：两条成绩只有同形式、同动作、同场地条件才直接可比；跨形式必须凭联测证据（bridge-sessions 中同阶段、同条件、同学员的成对测量，人数达到 form-links 的 support_min）换算到共同尺度（新形式一侧）。证据不足的动作各自呈现，不合并。
- **阶段归属**：每条成绩只属于发生时的在册阶段。升班后的成绩不回填为升班前能力；空成绩（伤休/缺考）不记零分、不参与换算。
- **知识截止**：known_period 是凭据到达月。评分纠正（supersedes）到达后才取代原成绩；回查换课决定时用决定当月的版本。失访学员（在册期内最后一条有效成绩之后再无有效成绩）即使有事后纠正，也不能完整说明其水平。
- **升级评审**：年龄须在目标等级范围内，且当前阶段各登记动作的最近有效成绩在共同尺度上都达到 estimated_min_score；动作之间证据不一致或最近一期缺考/伤休的，列入补测。潜在升级与已确认排课（confirmed 通知或转班）分开呈现。
- **名额占用**：notified/confirmed 的连续课程一直占名额；proposed/declined 的转班不改变占用，只有 confirmed（或资料撤销）才改变。空 from_slot 的确认表示没有原通知、直接新增。方案评估按目标期计算承诺基数。
- **方案比较**：60 分钟课时内同一教练或同一球场只支持一个班；教练须在获准中心并具备高等级权限。平均进步相近但入门机会损失不同的方案会被明确标出，小班证据单薄时不下教学效果结论。
