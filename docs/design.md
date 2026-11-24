# Conversation deletion design

DeepSeek Harness currently treats Session persistence as append-only. The public persistence service can report the per-Session JSONL artifact and open a write handle, but it does not expose deletion, and a live Agent's teardown handle belongs only to its creator. This plugin therefore does not remove a file from underneath a live writer.

The `/delete-conversation` command writes one request keyed by the exact Session lifecycle (`id` plus `createdAt`). At the next process start, the plugin runs after Session persistence becomes available and before the Web Workspace registry is allowed to build its header index. It takes the backend write lease, checks the lifecycle and artifact location, and refuses logs still needed by a stored fork. It then atomically renames the whole Session directory into `stateDir/trash/<lifecycle-key>`. A recovery manifest records the original directory.

The browser half registers a structured Session context menu action. The menu passes the captured Session ID to a root confirmation dialog, which stays mounted independently of the menu.

The confirmed action addresses the clicked row's Session id through the plugin's root-scoped `conversationDeletion.queue` Remote. Unlike the commands Remote, this interface does not require a live Agent, so historical rows can reach the same Host runtime that validates and durably queues Session lifecycles. The slash command remains a separate human adapter over that runtime. Only after the root Remote succeeds does the browser call the standard Workspace `archiveSession` service. The returned archive set updates the browser projection immediately, hides the row across grouping surfaces, and clears a current selection through the Host's existing rule.

Archive state is intentionally durable and independent from log movement. If the archive call fails after queue admission, the pending deletion remains valid and the UI reports the partial outcome. The next cold start can still move the artifact safely; no optimistic browser-only filter can diverge from other tabs or survive reloads.

The request file remains in `stateDir/pending` if validation or the move fails. A crash after the directory rename is also recoverable: the deterministic trash target proves the move committed, and the next boot writes any missing manifest before retiring the request.

Recovery also checks the process-local Session store. If the plugin is hot-reloaded while a queued Session remains live, the request is retained rather than treating HMR as a cold start.

This design deliberately provides recoverable product deletion rather than permanent erasure. Permanent trash retention policy belongs to an administrator or a future storage-level deletion API with sidecar cascading.
