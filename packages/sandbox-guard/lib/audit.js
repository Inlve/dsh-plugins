/**
 * Append-only audit trail for escalated operations.
 *
 * One JSON object per line: who asked, for what, under which rule, and what the
 * plugin answered. The Session already records the approval pair when the
 * request reaches the approval service; this file is the cross-session view and
 * survives log rotation.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export function createAudit(dir, fileName = 'escalations.jsonl') {
  const file = path.join(dir, fileName)
  let ready = false

  async function ensureDir() {
    if (ready) return
    await mkdir(dir, { recursive: true })
    ready = true
  }

  return {
    file,

    /** Append one record; never throws, so auditing cannot fail an approval. */
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
