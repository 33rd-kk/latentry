// Files only their owner may read, on Windows too: the settings file, the
// pairing key, the paired-device list, the folder-name key and the like.
// Kept in lib/pairing, which needs it and is kept free of the app.

export { restrictExistingToOwner, restrictToOwner } from '@/lib/pairing/owner-only'
