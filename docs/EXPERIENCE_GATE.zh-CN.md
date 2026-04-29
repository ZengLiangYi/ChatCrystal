# 经验质量门槛

[English](EXPERIENCE_GATE.md) | 简体中文

经验质量门槛用于确保 ChatCrystal 沉淀的是可复用经验资产，而不是原始对话摘要。

## 目标

ChatCrystal 应优先保留包含以下内容的对话：

- 问题解决过程
- 多步推理或分析
- 决策与取舍
- 已验证结果
- 可复用模式

应过滤或降级：

- 单轮信息型问答
- 低密度确认消息
- 没有分析的原始日志
- 没有结果的头脑风暴
- 缺少验证的实现记录
- 没有稳定结论的内容

## 判定模型

门槛由几部分组合：

1. 从对话消息中提取的**词法信号**。
2. 在不需要 LLM judge 时直接拒绝低信号内容的 **prefilter 规则**。
3. 对候选内容进行结构化评分的维度：
   - `problem_clarity`
   - `process_depth`
   - `decision_value`
   - `outcome_closure`
   - `reuse_potential`
4. 在摘要生成和 MCP writeback 中都由 Core 执行的强制校验。

这是一套混合算法：确定性规则处理简单情况，结构化评分处理高密度或更细微的经验候选。

## 持久化

被拒绝的对话不会创建笔记。审计信息保存在 conversation 行上：

- `experience_score`
- `experience_gate_reason`
- `experience_gate_details`
- `status = filtered`

这样过滤结果可复查，也为后续重试流程保留空间。

## 离线校准

运行校准样本：

```bash
npm run eval:experience -w server
```

默认样本集位置：

```text
server/src/services/experience/eval-samples.json
```

当前默认样本集包含 37 个校准案例，要求 false accept 和 false reject 都为 0。

## 样本来源与隐私

默认样本集声明为：

```json
{
  "origin": "synthetic_calibration_cases",
  "contains_real_user_data": false
}
```

这些样本是手写校准案例，不是从本机 ChatCrystal 数据库或原始私人对话日志中复制出来的。

隐私测试会拒绝常见敏感模式，包括：

- 绝对本机用户路径
- 个人用户名
- 邮箱地址
- 私有 IP 段和 loopback 字面量
- 类似密钥的 token
- private key 内容

以后如果加入真实案例，应先脱敏，并明确更新 provenance metadata。

## 添加校准案例

当门槛出现有意义的 false accept 或 false reject 时，应加入样本。

一个有价值的样本应包含：

- `id`：稳定的 kebab-case 标识
- `label`：人类可读场景名
- `expected_decision`：`accept` 或 `reject`
- `messages`：最小化的对话证据
- `judge_dimensions`：样本会通过 prefilter 时需要提供
- `notes`：说明这个案例为什么重要

优先添加小而高信号的案例，不要粘贴大段原始 transcript。

## Review Workflow

下一步产品能力应让 gate 判定可复查：

1. 在 UI 或 CLI 中展示 filtered 对话和理由。
2. 允许用户标记“应该保留”或“过滤正确”。
3. 将 false accept 和 false reject 回流到校准样本集。
4. 调整阈值前先运行 `npm run eval:experience -w server`。

质量门槛应该从真实复查结果中演化，而不是只凭直觉调整。

