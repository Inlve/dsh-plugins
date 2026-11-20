/**
 * Append-only audit trail for the PATH layer.
 *
 * One JSON object per line: what the plugin added, from which source, what it
 * removed, and why the pass ran. Nothing here is load-bearing — a failed write
 * never changes what the shell sees.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export function createAudit(dir, fileName = 'pathenv.jsonl') {
  const file = path.join(dir, fileName)
  let ready = false

  async function ensureDir() {
    if (ready) return
    await mkdir(dir, { recursive: true })
    ready = true
  }

  return {
    file,

    /** Append one record; never throws, so auditing cannot fail a command. */
    async append(entry) {
      try {
        await ensureDir()
        await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
        return true
      } catch {
        return false
      }
    },

    /** Read the last `limit` parsed records, newest last. */
    async tail(limit = 20) {
      try {
        const text = await readFile(file, 'utf8')
        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
        const slice = lines.slice(-Math.max(1, limit))
        const records = []
        for (const line of slice) {
          try {
            records.push(JSON.parse(line))
          } catch {
            // Skip a torn line rather than failing the whole read.
          }
        }
        return records
      } catch {
        return []
      }
    },
  }
}
