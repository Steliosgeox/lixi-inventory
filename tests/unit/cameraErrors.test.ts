import { describe, expect, it } from 'vitest'
import { cameraErrorMessage } from '../../src/capture/cameraErrors'

describe('camera errors across browsers', () => {
  it.each(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])('normalizes %s without depending on browser wording', name => {
    expect(cameraErrorMessage({name, message:'Browser-specific wording'})).toContain('Δεν επιτρέπεται η πρόσβαση στην κάμερα.')
  })
  it.each(['NotFoundError', 'DevicesNotFoundError'])('explains missing camera: %s', name => {
    expect(cameraErrorMessage({name})).toContain('Δεν βρέθηκε κάμερα')
  })
  it.each(['NotReadableError', 'TrackStartError'])('explains busy camera: %s', name => {
    expect(cameraErrorMessage({name})).toContain('χρησιμοποιείται')
  })
  it.each(['OverconstrainedError', 'ConstraintNotSatisfiedError'])('explains unsupported constraints: %s', name => {
    expect(cameraErrorMessage({name})).toContain('ρυθμίσεις')
  })
  it('handles aborted startup', () => { expect(cameraErrorMessage({name:'AbortError'})).toContain('διακόπηκε') })
  it('preserves actionable decoder errors', () => { expect(cameraErrorMessage(new Error('Worker timed out'))).toBe('Worker timed out') })
  it.each([null, undefined, 12, 'unexpected'])('handles non-error throws: %s', value => { expect(cameraErrorMessage(value)).toContain('Η κάμερα δεν άνοιξε') })
})
