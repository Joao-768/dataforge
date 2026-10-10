// Copies Monaco's prebuilt AMD bundle into public/ so the SQL editor loads it
// from the app's own origin instead of a CDN. Runs after npm install and
// before builds; the copy is gitignored.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'monaco-editor', 'min', 'vs')
const target = join(root, 'public', 'monaco', 'vs')

if (!existsSync(source)) {
    console.error('monaco-editor is not installed; run npm install first.')
    process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log('Copied Monaco to public/monaco/vs')
