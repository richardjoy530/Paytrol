import { createHash } from 'node:crypto';
import {
  createDocument,
  deleteDocument,
  getDocument,
  queryDocuments,
  updateDocument,
} from '@/lib/db';
import { roundMoney } from '@/lib/money';
import { generateId } from '@/lib/utils';
import type { Balance, GuestContact, Trip, TripParticipant, UserProfile } from '@/types';

function getBalanceKey(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join('_');
}

export function getGuestUid(ownerUid: string, contactId: string) {
  return `guest-${createHash('sha256').update(`${ownerUid}:${contactId}`).digest('hex')}`;
}

export async function linkGuestContact(
  contact: GuestContact,
  user: Pick<UserProfile, 'id' | 'displayName' | 'photoURL'>
): Promise<GuestContact> {
  if (contact.linkedUid === user.id) return contact;
  if (contact.ownerUid === user.id) {
    throw new Error('A guest contact cannot be linked to its owner.');
  }

  const trips = await queryDocuments<Trip>(
    'trips',
    { participants: { $elemMatch: { uid: contact.guestUid } } }
  );

  for (const trip of trips) {
    const updatedParticipants: TripParticipant[] = [];
    for (const participant of trip.participants) {
      if (participant.uid !== contact.guestUid) {
        updatedParticipants.push(participant);
        continue;
      }

      const existing = updatedParticipants.find((item) => item.uid === user.id);
      if (existing) {
        existing.shareAmount = roundMoney(existing.shareAmount + participant.shareAmount);
        existing.settled = existing.settled && participant.settled;
        existing.guestContactId = contact.id;
        if (!existing.settled) existing.settledAt = null;
      } else {
        updatedParticipants.push({
          ...participant,
          uid: user.id,
          displayName: user.displayName,
          photoURL: user.photoURL,
          isGuest: false,
        });
      }
    }

    trip.participants = updatedParticipants;
    await updateDocument('trips', trip);
  }

  const guestBalanceId = getBalanceKey(contact.ownerUid, contact.guestUid);
  const guestBalance = await getDocument<Balance>('balances', guestBalanceId);
  if (guestBalance) {
    const linkedBalanceId = getBalanceKey(contact.ownerUid, user.id);
    const linkedBalance = await getDocument<Balance>('balances', linkedBalanceId);

    if (linkedBalance) {
      const migratedUid1 = guestBalance.uid1 === contact.guestUid ? user.id : guestBalance.uid1;
      linkedBalance.netAmount = roundMoney(
        linkedBalance.netAmount +
          (linkedBalance.uid1 === migratedUid1 ? guestBalance.netAmount : -guestBalance.netAmount)
      );
      await updateDocument('balances', linkedBalance);
    } else {
      const migratedBalance: Balance = {
        ...guestBalance,
        id: linkedBalanceId,
        odataId: linkedBalanceId,
        uid1: guestBalance.uid1 === contact.guestUid ? user.id : guestBalance.uid1,
        uid2: guestBalance.uid2 === contact.guestUid ? user.id : guestBalance.uid2,
        name1: guestBalance.uid1 === contact.guestUid ? user.displayName : guestBalance.name1,
        name2: guestBalance.uid2 === contact.guestUid ? user.displayName : guestBalance.name2,
        photo1: guestBalance.uid1 === contact.guestUid ? user.photoURL : guestBalance.photo1,
        photo2: guestBalance.uid2 === contact.guestUid ? user.photoURL : guestBalance.photo2,
      };
      delete migratedBalance.guestUid;
      await createDocument('balances', migratedBalance);
    }

    await deleteDocument('balances', guestBalanceId);
  }

  contact.linkedUid = user.id;
  contact.guestUid = user.id;
  contact.name = user.displayName;
  contact.updatedAt = new Date().toISOString();
  return updateDocument('guests', contact);
}

export async function renameGuestContact(contact: GuestContact, name: string) {
  contact.name = name;
  contact.updatedAt = new Date().toISOString();
  await updateDocument('guests', contact);

  const trips = await queryDocuments<Trip>(
    'trips',
    { participants: { $elemMatch: { guestContactId: contact.id } } }
  );
  for (const trip of trips) {
    trip.participants = trip.participants.map((participant) =>
      participant.guestContactId === contact.id
        ? { ...participant, displayName: name }
        : participant
    );
    await updateDocument('trips', trip);
  }

  const balanceId = getBalanceKey(contact.ownerUid, contact.linkedUid || contact.guestUid);
  const balance = await getDocument<Balance>('balances', balanceId);
  if (balance) {
    if (balance.uid1 === (contact.linkedUid || contact.guestUid)) balance.name1 = name;
    if (balance.uid2 === (contact.linkedUid || contact.guestUid)) balance.name2 = name;
    await updateDocument('balances', balance);
  }
}

export async function linkGuestContactsForUser(
  user: Pick<UserProfile, 'id' | 'email' | 'displayName' | 'photoURL'>
) {

  const email = user.email.trim().toLowerCase();
  if (!email) return;

  const contacts = await queryDocuments<GuestContact>(
    'guests',
    { email, linkedUid: null }
  );

  for (const contact of contacts) {
    if (contact.ownerUid !== user.id) {
      await linkGuestContact(contact, user);
    }
  }
}

export type CreateGuestResult =
  | { ok: true; guest: GuestContact }
  | { ok: false; status: number; error: string };

/** Add a guest contact owned by `ownerUid`, optionally with an email to link later. */
export async function createGuestContact(
  ownerUid: string,
  rawName: string,
  rawEmail?: string | null
): Promise<CreateGuestResult> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80) {
    return { ok: false, status: 400, error: 'Enter a name up to 80 characters.' };
  }
  const email = rawEmail ? rawEmail.trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'Enter a valid email address.' };
  }

  const existingGuests = await queryDocuments<GuestContact>('guests', { ownerUid });
  if (existingGuests.some((guest) => guest.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    return { ok: false, status: 409, error: `You already have a guest called ${name}.` };
  }
  if (email && existingGuests.some((guest) => guest.email?.toLowerCase() === email)) {
    return { ok: false, status: 409, error: 'You already have a guest with that email.' };
  }

  const id = generateId();
  const now = new Date().toISOString();
  const guest: GuestContact = {
    id,
    ownerUid,
    guestUid: getGuestUid(ownerUid, id),
    name,
    email,
    linkedUid: null,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, guest: await createDocument('guests', guest) };
}
