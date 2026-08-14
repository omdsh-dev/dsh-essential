# Conversation deletion design

DeepSeek Harness currently treats Session persistence as append-only. The public persistence service can locate and inspect a per-Session JSONL artifact, but it does not expose deletion, and a live Agent's teardown handle belongs only to its creator. This plugin therefore does not remove a file from underneath a live writer.

The `/delete-conversation` command writes one request keyed by the exact Session lifecycle (`id` plus `createdAt`). At the next process start, the plugin runs after Session persistence becomes available and before the Web Workspace registry is allowed to build its header index. It validates the current header, location, and inspected identity, then atomically renames the whole Session directory into `stateDir/trash/<lifecycle-key>`. A recovery manifest records the original directory.

The browser half contributes one destructive row action through `sidebar.workspaces.sessionMenu`. Selecting it opens the shared Web `Modal` card with the concise confirmation “Delete this conversation?” and explicit cancel/delete actions; it never invokes native `window.confirm` or `window.alert`. The owner menu closes immediately but retains its hidden extension subtree through the host `Menu.keepMounted` option, so the slot contribution and its portaled card preserve local state without leaving the higher-z-index menu visible. Cancellation or completion unmounts the card. During the request, dismissal and actions are disabled; failures remain visible inside the card.

The confirmed action addresses the clicked row's Session id through the plugin's root-scoped `conversationDeletion.queue` Remote. Unlike the commands Remote, this interface does not require a live Agent, so historical rows can reach the same Host runtime that validates and durably queues Session lifecycles. The slash command remains a separate human adapter over that runtime. Only after the root Remote succeeds does the browser call the standard Workspace `archiveSession` service. The returned archive set updates the browser projection immediately, hides the row across grouping surfaces, and clears a current selection through the Host's existing rule.

Archive state is intentionally durable and independent from log movement. If the archive call fails after queue admission, the pending deletion remains valid and the UI reports the partial outcome. The next cold start can still move the artifact safely; no optimistic browser-only filter can diverge from other tabs or survive reloads.

The request file remains in `stateDir/pending` if validation or the move fails. A crash after the directory rename is also recoverable: the deterministic trash target proves the move committed, and the next boot writes any missing manifest before retiring the request.

Recovery also checks the process-local Session store. If the plugin is hot-reloaded while a queued Session remains live, the request is retained rather than treating HMR as a cold start.

This design deliberately provides recoverable product deletion rather than permanent erasure. Permanent trash retention policy belongs to an administrator or a future storage-level deletion API with sidecar cascading.
