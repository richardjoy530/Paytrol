import type { GuestContact } from '@/types';

/** One short line describing a guest, the same on every screen. */
export function guestSubtitle(guest: Pick<GuestContact, 'linkedUid' | 'email'>): string {
  if (guest.linkedUid) return 'Has an account';
  if (guest.email) return 'Guest · invited';
  return 'Guest';
}
