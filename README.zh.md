# dsh-essential

[English](README.md) | **中文**

面向 DeepSeek Harness 的可恢复对话删除插件。它在会话行菜单中添加“删除对话”，也注册人工命令 `/delete-conversation`；用户确认后，目标 Session 会进入删除队列，并通过 Workspace 的持久归档投影立即从列表中隐藏。DSH 下次启动时，插件会在 Web Workspace 建立会话索引之前校验该 Session 的完整生命周期，并把其 JSONL 目录原子移动到恢复垃圾箱。

## 为什么需要重启

当前 DSH 的 Session 持久化约定是只追加的，公开服务没有删除方法；活动 Agent 的销毁句柄也只属于创建者。插件不能安全地从活动写入者脚下移走日志。因此，删除分为两个阶段：当前进程只写入一条持久请求，下一次启动在任何会话恢复之前完成移动。这个边界避免日志重建、部分写入和生命周期竞争。

## 安装

本包是一个 DSH bundle，自带 `cordis.patch.yml` 和会话菜单扩展槽补丁。DeepSeek Harness `0.1.0-rc.5` 仍由 `ui-workspace` 内部持有会话行操作，因此第一次集成时先在 `deepseek-harness` 源码仓库应用该插槽补丁并重新构建：

```sh
git -C /path/to/DSH apply /path/to/dsh-essential/patches/session-menu-slot.patch
cd /path/to/DSH && pnpm run build
```

若宿主版本已经提供 `sidebar.workspaces.sessionMenu` 槽，则跳过这一步。然后从已构建的 Harness CLI 安装到 Web profile：

```sh
node /path/to/DSH/apps/cli/lib/bin.js plugin --profile web add /path/to/dsh-essential
```

安装后重启 DSH。Bundle 会：

- 挂载 `@deepseek-ai/dsh-essential`；
- 把 `stateDir` 设为 DSH home 下的 `conversation-trash`；
- 让 Web Workspace 等待 `conversationDeletion` 服务完成启动恢复后再建立 Session 索引。

直接写 `cordis.yml` 时，`stateDir` 必须是绝对路径：

```yaml
- id: essential-conversation-delete
  name: '@deepseek-ai/dsh-essential'
  config:
    stateDir: /absolute/path/to/conversation-trash
```

## 使用

在会话列表中打开目标会话右侧的 `…` 菜单，选择“删除对话”。Web 会显示标题为“确认删除该对话吗？”的站内卡片，并提供“取消 / 删除对话”操作；不再使用浏览器原生弹窗。确认后通过不依赖活跃 Agent 的根级 Remote 提交目标会话的删除请求，并在请求成功后立即归档该 Session，使历史会话和当前会话都能从所有会话分组中隐藏。取消确认不会发出请求。

删除进行中，确认卡片会锁定关闭与操作按钮，将主按钮改为“正在删除…”，并显示进度；请求失败或“已排队但暂时无法隐藏”的部分成功状态会直接显示在卡片中。完全成功时，会话行消失即为结果反馈，不再额外弹出成功提示。

立即隐藏只改变 Workspace 的列表投影，不会在活动进程中移动或删除日志；下次冷启动仍会按完整生命周期校验并把日志移入恢复垃圾箱。如果删除请求已写入但归档接口失败，插件会明确提示“已加入队列但暂时无法隐藏”，避免把延迟隐藏误报成删除失败。

也可以继续使用人工命令。删除当前对话：

```text
/delete-conversation CONFIRM
```

按 Session id 删除另一个对话：

```text
/delete-conversation <session-id> CONFIRM
```

确认成功后重启 DSH。插件在下次启动时把日志移至：

```text
<stateDir>/trash/<session-lifecycle-key>/
```

目录中的 `deletion.json` 记录原目录。要恢复时，先停止 DSH，删除恢复目录中的 `deletion.json`，再把该目录移回 `originalDirectory`。不要在 DSH 运行时恢复。

## 配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `stateDir` | string | 必填 | pending 请求与恢复垃圾箱所在的绝对目录；必须位于 Session artifact 目录之外。 |
| `commandName` | string | `delete-conversation` | 可选的人工作命令别名，不带 `/`；菜单始终使用稳定的 `/delete-conversation`。 |

## 安全与恢复语义

- 命令要求字面量 `CONFIRM`，缺少确认不会写入请求。
- 请求绑定 `sessionId`、`createdAt` 与 `cwd`；id 被复用时不会删除新的 Session 生命周期。
- 移动前再次比较持久化列表、backend location 与完整 inspect 结果。
- HMR 重载时若目标 Session 仍然活动，请求会保留到真正的冷启动。
- 产品删除使用同一文件系统内的目录 `rename`，不会 `unlink` Session 日志。
- 移动后崩溃也可恢复：垃圾箱目标是确定性的，下次启动会补齐 manifest 并清理 pending 请求。
- 验证或移动失败时保留 pending 请求并记录错误，原日志不动。

详细事务说明见 [docs/design.md](docs/design.md)。

## 开发验证

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
git -C ../deepseek-harness apply --check "$PWD/patches/session-menu-slot.patch"
```

## Model Experience

### 人工命令生命周期

#### 模型看到什么

无直接模型输入。`/delete-conversation` 由人工命令层处理，不发送给模型；命令框架把 `command/run` 与 `command/done` 写入 Session 日志，但它们是 log-only 事件，不进入对话消息 surface。

#### Token 影响

零直接请求 token。命令不会触发模型调用。

#### KV Cache 影响

命令不修改已有模型请求前缀，也不发起独立模型请求。之后删除整个 Session 时，该 Session 不再产生未来请求。

## 已知限制与后续工作

- **仅支持逐 Session JSONL backend**——SQLite 没有独立 artifact location，插件会明确拒绝，而不是猜测数据库内部结构。
- **日志移动在重启后生效**——会话行会立即通过持久归档投影隐藏，但当前进程不会移动目标日志；这避免绕过 Agent 所有权与持久化协调器。
- **不是永久擦除**——日志被移动到恢复垃圾箱；保留期和最终清理属于部署管理员策略。
- **不级联清理 sidecar**——消息反馈等独立存储可能保留孤立行；当前 Session 持久化没有跨域删除事务。
- **需要宿主菜单槽**——DeepSeek Harness `0.1.0-rc.5` 必须先应用随包附带的 `session-menu-slot.patch`；宿主原生提供同名槽后不再需要补丁。
