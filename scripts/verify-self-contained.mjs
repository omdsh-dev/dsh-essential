import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const localSpec = /^(?:file:|link:|workspace:)|(?:^|\/)\.\.\//
const problems = []

for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
  for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
    if (localSpec.test(String(spec))) problems.push(`${group}.${name} uses local spec ${spec}`)
  }
}

if (pkg.main !== 'lib/index.js') problems.push('main must be lib/index.js')
if (pkg.types !== 'lib/types/index.d.ts') problems.push('types must be lib/types/index.d.ts')
if (pkg.exports?.['./invariant'] === undefined) problems.push('missing ./invariant export')
if (pkg.exports?.['./client'] === undefined) problems.push('missing ./client export')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') problems.push('missing dsh.bundle.patch')
if (pkg.dsh?.client?.platform !== 'web') problems.push('missing dsh.client web declaration')
if (!pkg.files?.includes('cordis.patch.yml')) problems.push('files must include cordis.patch.yml')
if (pkg.files?.includes('patches')) problems.push('self-contained bundle must not ship host patches')
if (pkg.exports?.['./patches/session-menu-slot.patch'] !== undefined) problems.push('self-contained bundle must not export a host patch')

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log('self-contained manifest checks passed')
