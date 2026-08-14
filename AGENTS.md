# dsh-essential contributor notes

- Preserve the function-plugin named exports `name`, `inject`, `Config`, and `apply`; do not add a default export.
- Keep Loader metadata in `src/index.ts`, schema/defaults in `src/config.ts`, filesystem recovery in `src/queue.ts`, and Cordis activation in `src/runtime.ts`.
- Conversation deletion is restart-gated and recoverable: never unlink or overwrite a Session artifact as the product operation.
- Validate the exact Session lifecycle (`id`, `createdAt`, and `cwd`) again before moving its directory.
- Keep `stateDir` outside Session artifact directories and absolute at the configuration boundary.
- Keep registrations scoped to the plugin fiber and drain admitted operations during disposal.
- Update both READMEs, public JSDoc, tests, and `cordis.patch.yml` together when behavior changes.
- Run `pnpm run verify:self-contained`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `pnpm run prepare` before handoff.
