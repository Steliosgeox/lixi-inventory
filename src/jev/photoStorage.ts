/** Store owned bytes, not WebKit's File/Blob backing handle, in IndexedDB. */
export type StoredPhoto = { blob: Blob | null; bytes?: ArrayBuffer | null; mime?: string }

export async function encodePhoto(blob: Blob): Promise<StoredPhoto> {
  return { blob: null, bytes: await blob.arrayBuffer(), mime: blob.type || 'image/jpeg' }
}

/** Keep existing queued photos readable without clearing or rewriting the user's database. */
export function restorePhoto(photo: StoredPhoto): Blob | null {
  if (photo.bytes instanceof ArrayBuffer) return new Blob([photo.bytes], { type: photo.mime || 'image/jpeg' })
  return photo.blob ?? null
}
