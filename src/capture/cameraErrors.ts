/** Browser-specific DOMException messages are not stable; use their standardized names. */
export function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Δεν επιτρέπεται η πρόσβαση στην κάμερα. Επίτρεψε την κάμερα στις ρυθμίσεις του browser για το Leaksy και δοκίμασε ξανά.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Δεν βρέθηκε κάμερα. Σύνδεσε μία ή επίλεξε φωτογραφία barcode.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Η κάμερα χρησιμοποιείται ή δεν είναι διαθέσιμη. Κλείσε τις άλλες εφαρμογές κάμερας και δοκίμασε ξανά.'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'Η κάμερα δεν υποστηρίζει τις επιλεγμένες ρυθμίσεις. Δοκίμασε άλλη κάμερα ή φωτογραφία.'
    case 'AbortError':
      return 'Η εκκίνηση της κάμερας διακόπηκε. Δοκίμασε ξανά.'
    default:
      return error instanceof Error ? error.message : 'Η κάμερα δεν άνοιξε. Δοκίμασε ξανά ή επίλεξε φωτογραφία.'
  }
}
