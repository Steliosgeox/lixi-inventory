import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { encodePhoto, restorePhoto, type StoredPhoto } from '../../src/jev/photoStorage'

describe('portable photo persistence', () => {
  it('detaches a selected file into owned bytes before storage', async () => {
    const saved = await encodePhoto(new Blob([new Uint8Array([0, 1, 128, 255])], { type: 'image/png' }))
    expect(saved.blob).toBeNull()
    expect(saved.bytes).toBeInstanceOf(ArrayBuffer)
    expect(saved.mime).toBe('image/png')
    expect(new Uint8Array(await restorePhoto(saved)!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 128, 255]))
  })
  it('survives a database close and reopen without persisting Blob handles', async () => {
    const db = new Dexie('photo-byte-regression')
    db.version(1).stores({ photos: '&id' })
    try {
      await db.table('photos').add({ id: 'one', ...await encodePhoto(new Blob(['photograph'], { type: 'image/jpeg' })) })
      db.close(); await db.open()
      const saved = await db.table('photos').get('one') as StoredPhoto
      expect(saved.blob).toBeNull()
      expect(await restorePhoto(saved)!.text()).toBe('photograph')
    } finally { await db.delete() }
  })
  it('preserves compatibility with existing pending Blob records', () => {
    const legacy = new Blob(['old-photo'], { type: 'image/png' })
    expect(restorePhoto({ blob: legacy })).toBe(legacy)
  })
  it('does not recreate cleared evidence for committed records', () => {
    expect(restorePhoto({ blob: null, bytes: null })).toBeNull()
  })
})
