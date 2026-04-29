import type { ExperienceSignalMessage, ExperienceSignals } from './schemas.js';

const LOW_INFO_USER_RE = /^(好|好的|继续|确认|ok|okay|yes|go on|继续吧|可以)$/i;
const PROBLEM_RE =
  /(fail|failed|error|exception|bug|fix|broken|timeout|refactor|implement|migrate|optimi[sz]e|choose|decide|tradeoff|root cause|need|问题|失败|报错|异常|修复|实现|迁移|优化|选择|决策|取舍|原因|目标|约束)/i;
const ERROR_RE =
  /(error|exception|stack trace|traceback|ECONN|ETIMEDOUT|ENOENT|EADDRINUSE|TypeError|ReferenceError|SyntaxError|失败|报错|异常|错误码)/i;
const CODE_RE =
  /(```|[\w.-]+\/[\w./-]+\.(ts|tsx|js|jsx|json|md|py|sql)|\b[A-Za-z_$][\w$]+\(|diff --git|SELECT\s+.+\s+FROM)/i;
const PROCESS_RE =
  /(inspect|compared?|try|attempt|debug|verify|verified|validated|reproduce|root cause|investigate|found|排查|尝试|验证|复现|分析|比较|定位|发现)/i;
const DECISION_RE =
  /(choose|decide|decision|tradeoff|instead|because|reason|therefore|方案|选择|决策|取舍|因为|所以|最终|改为)/i;
const OUTCOME_RE =
  /(fixed|passed|complete|resolved|implemented|verified|blocked|reverted|resolution|result|makes? .+ clear|audit clear|修复|通过|完成|解决|验证通过|结论|失败原因)/i;
const REUSE_RE =
  /(pattern|reusable|reuse|pitfall|lesson|next time|future|similar|principle|模式|复用|踩坑|经验|原则|类似|以后)/i;

function boolish(value: number | boolean | null | undefined) {
  return value === true || value === 1;
}

function userTurnCount(messages: ExperienceSignalMessage[]) {
  return messages
    .filter((message) => message.type === 'user')
    .filter((message) => !LOW_INFO_USER_RE.test(message.content.trim())).length;
}

export function extractExperienceSignals(
  messages: ExperienceSignalMessage[],
): ExperienceSignals {
  const text = messages.map((message) => message.content ?? '').join('\n');
  const contentChars = text.replace(/\s+/g, '').length;
  const turns = userTurnCount(messages);
  const hasCodeMetadata = messages.some(
    (message) => boolish(message.has_code) || boolish(message.has_tool_use),
  );
  const hasProblemSignal = PROBLEM_RE.test(text);
  const hasDecisionSignal = DECISION_RE.test(text);
  const hasOutcomeSignal = OUTCOME_RE.test(text);
  const hasReuseSignal = REUSE_RE.test(text);

  return {
    effective_turns: turns,
    content_chars: contentChars,
    has_problem_signal: hasProblemSignal,
    has_error_signal: ERROR_RE.test(text),
    has_code_signal: hasCodeMetadata || CODE_RE.test(text),
    has_process_signal: PROCESS_RE.test(text),
    has_decision_signal: hasDecisionSignal,
    has_outcome_signal: hasOutcomeSignal,
    has_reuse_signal: hasReuseSignal,
    has_strong_single_turn_signal:
      turns === 1 &&
      contentChars >= 120 &&
      hasProblemSignal &&
      hasDecisionSignal &&
      (hasOutcomeSignal || hasReuseSignal),
  };
}
