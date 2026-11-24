# dsh-essential

**Compatibility**: DeepSeek Harness `0.2.3-alpha.2`, using Node.js `^24.22.3 || >=26.13.1`.

**English** | [中文](README.zh.md)

A recoverable conversation-deletion plugin for DeepSeek Harness. It contributes **Delete conversation** to each Session row menu and also registers `/delete-conversation`. After explicit confirmation, the selected Session lifecycle is queued and immediately hidden through the Workspace's durable archive projection; on the next DSH start its JSONL directory is atomically moved into recovery trash before the Web Workspace builds its index.

## Why deletion is restart-gated

DSH currently defines Session persistence as append-only and exposes no deletion method. A live Agent's teardown handle also belongs only to its creator. Moving a log underneath a live writer would be unsafe, so the plugin separates intent from execution: the running process persists a request, and the next process performs the move before any Session is resumed.

## Install

This package is a self-contained DSH bundle with `cordis.patch.yml`. It does not patch or rebuild the DeepSeek Harness source tree. Install it into a Web profile with the built Harness CLI:

```sh
node /path/to/DSH/apps/cli/lib/bin.js plugin --profile web add /path/to/dsh-essential
```

Restart DSH after installation. The bundle mounts the plugin, stores state under the DSH home `conversation-trash` directory, and makes the Web Workspace wait for deletion recovery before indexing persisted Sessions.

For a direct `cordis.yml` composition, `stateDir` is required and absolute:

```yaml
- id: essential-conversation-delete
  name: '@deepseek-ai/dsh-essential'
  config:
    stateDir: /absolute/path/to/conversation-trash
```

## Use

Open a Session row's `…` menu and choose **Delete conversation**. The Web UI opens an in-page card titled **Delete this conversation?** with **Cancel / Delete conversation** actions; it no longer uses native browser dialogs. Confirming addresses the clicked Session through the plugin's root Remote (which also works for historical Sessions without a live Agent), then archives the Session so it disappears immediately from every Session grouping surface. Cancelling sends no request.

The menu uses the native DSH Session menu and passes the clicked Session ID to a root confirmation dialog.

While deletion is pending, the card pins itself open, disables both actions, changes the primary button to **Deleting…**, and shows progress. Failures and queued-but-not-hidden partial outcomes render inside the card. On full success, the disappearing row is the result feedback; no second success popup interrupts the flow.

Immediate hiding changes only the Workspace list projection; it never moves or deletes an active log. The next cold start still validates the exact lifecycle before moving the log into recovery trash. If queueing succeeds but the archive request fails, the plugin reports that deletion is queued but the row could not yet be hidden instead of misreporting the deletion as rejected.

The human command remains available. Delete the current conversation:

```text
/delete-conversation CONFIRM
```

Delete another conversation by Session id:

```text
/delete-conversation <session-id> CONFIRM
```

After the command succeeds, restart DSH. The next boot moves the log to `<stateDir>/trash/<session-lifecycle-key>/`. Its `deletion.json` records the original directory. To restore, stop DSH, remove `deletion.json`, and move the directory back to `originalDirectory`.

## Configuration

| Field | Type | Default | Meaning |
|---|---|---|---|
| `stateDir` | string | required | Absolute pending-request and recovery-trash directory, outside Session artifact directories. |
| `commandName` | string | `delete-conversation` | Optional human-command alias without `/`; the menu always uses stable `/delete-conversation`. |

## Safety and recovery

A session that is still the source of a stored fork cannot be moved to recovery trash.

- The literal `CONFIRM` is mandatory.
- Requests bind `sessionId`, `createdAt`, and `cwd`, preventing a reused id from deleting a newer lifecycle.
- The persistence listing, backend location, and full inspection identity are checked again before the move.
- HMR retains the request whenever the target Session is still live; only a cold start may move it.
- Product deletion renames the Session directory; it never unlinks the log.
- A crash after rename is recoverable through the deterministic trash target.
- A failed validation or move retains the request and leaves the source untouched.

See [docs/design.md](docs/design.md) for the transaction design.

## Development verification

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

## Model Experience

### Human command lifecycle

#### What the model sees

No direct model input. The command layer handles `/delete-conversation` without sending it to the model. The command framework records log-only `command/run` and `command/done` events, which do not enter the conversation surface.

#### Token effect

Zero direct request tokens and no model call.

#### KV Cache effect

The command neither replaces an existing model-request prefix nor creates an independent request. Once the entire Session is removed, it produces no future requests.

## Known Limitations and Deferred Work

- **Per-Session JSONL only** — SQLite has no independent artifact location, so the plugin rejects it explicitly.
- **Log move is effective after restart** — the row hides immediately through the durable archive projection, but the running process never moves the target log; this preserves Agent ownership and persistence coordination.
- **Not permanent erasure** — logs remain in recovery trash until an administrator applies a retention policy.
- **No sidecar cascade** — independent stores such as message feedback can retain orphan rows because DSH has no cross-domain Session deletion transaction.
