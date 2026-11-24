import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  deleteDocument,
  getDocument,
  queryDocuments,
  updateDocument,
  equalsIgnoreCase,
} from '@/lib/db';
import {
  createGuestContact,
  linkGuestContact,
  renameGuestContact,
} from '@/lib/guest-linking';
import type { GuestContact, Trip, TripParticipant, UserProfile } from '@/types';
import { splitEqually } from '@/lib/money';
import { adjustBalance, getBalanceKey } from '@/lib/ledger';

async function getOwnerUid() {
  const session = await getServerSession(authOptions);
  return session?.user?.uid || null;
}

export async function GET() {
  try {
    const ownerUid = await getOwnerUid();
    if (!ownerUid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const guests = await queryDocuments<GuestContact>(
      'guests',
      { ownerUid },
      { newestFirst: true }
    );
    return NextResponse.json({ success: true, data: guests });
  } catch (error: unknown) {
    console.error('Guests GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load guests' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ownerUid = await getOwnerUid();
    if (!ownerUid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { name?: unknown };
    const result = await createGuestContact(ownerUid, typeof body.name === 'string' ? body.name : '');
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.guest }, { status: 201 });
  } catch (error: unknown) {
    console.error('Guests POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to add guest' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ownerUid = await getOwnerUid();
    if (!ownerUid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { guestId?: unknown; name?: unknown; email?: unknown };
    if (typeof body.guestId !== 'string') {
      return NextResponse.json({ success: false, error: 'Guest ID is required.' }, { status: 400 });
    }

    const guest = await getDocument<GuestContact>('guests', body.guestId);
    if (!guest || guest.ownerUid !== ownerUid) {
      return NextResponse.json({ success: false, error: 'Guest contact not found.' }, { status: 404 });
    }

    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : guest.name;
    if (!name || name.length > 80) {
      return NextResponse.json(
        { success: false, error: 'Enter a guest name up to 80 characters.' },
        { status: 400 }
      );
    }

    const email = body.email === null || body.email === ''
      ? null
      : typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : guest.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (email && email === (await getDocument<UserProfile>('users', ownerUid))?.email.toLowerCase()) {
      return NextResponse.json({ success: false, error: 'You cannot link a guest to your own email.' }, { status: 400 });
    }
    if (guest.linkedUid && email !== guest.email) {
      return NextResponse.json(
        { success: false, error: 'Email cannot be changed after this guest is linked to an account.' },
        { status: 400 }
      );
    }

    const duplicateName = (await queryDocuments<GuestContact>(
      'guests',
      { ownerUid }
    )).some((other) => other.id !== guest.id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicateName) {
      return NextResponse.json({ success: false, error: 'A guest with that name already exists.' }, { status: 409 });
    }

    guest.email = email;
    await renameGuestContact(guest, name);

    if (email && !guest.linkedUid) {
      const users = await queryDocuments<UserProfile>(
        'users',
        { email: equalsIgnoreCase(email) }
      );
      const matchingUser = users.find((user) => user.id !== ownerUid);
      if (matchingUser) {
        await linkGuestContact(guest, {
          id: matchingUser.id,
          displayName: matchingUser.displayName,
          photoURL: matchingUser.photoURL,
        });
      }
    }

    const updated = await getDocument<GuestContact>('guests', guest.id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    console.error('Guests PATCH error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update guest' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ownerUid = await getOwnerUid();
    if (!ownerUid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { guestId?: unknown };
    if (typeof body.guestId !== 'string') {
      return NextResponse.json({ success: false, error: 'Guest ID is required.' }, { status: 400 });
    }

    const guest = await getDocument<GuestContact>('guests', body.guestId);
    if (!guest || guest.ownerUid !== ownerUid) {
      return NextResponse.json({ success: false, error: 'Guest contact not found.' }, { status: 404 });
    }

    const guestUid = guest.linkedUid || guest.guestUid;
    const ownerProfile = await getDocument<UserProfile>('users', ownerUid);
    const owner = {
      uid: ownerUid,
      name: ownerProfile?.displayName || 'Driver',
      photo: ownerProfile?.photoURL ?? null,
    };
    const trips = await queryDocuments<Trip>(
      'trips',
      { participants: { $elemMatch: { guestContactId: guest.id } } }
    );

    for (const trip of trips) {
      if (trip.creatorUid !== ownerUid) continue;
      const oldParticipants = new Map(
        trip.participants.map((participant) => [participant.uid, participant])
      );
      const isRemoved = (participant: TripParticipant) =>
        participant.guestContactId === guest.id || participant.uid === guestUid;
      const removed = trip.participants.filter(isRemoved);
      const remaining = trip.participants.filter((participant) => !isRemoved(participant));
      if (removed.length === 0) continue;

      // The guest's share is spread equally across the people left on the trip.
      const shares = splitEqually(trip.totalCost, remaining.length);
      trip.participants = remaining.map((participant, index) => ({
        ...participant,
        shareAmount: shares[index],
      }));
      await updateDocument('trips', trip);

      // Remove what the guest owed for this trip. When the guest is linked to a
      // real account, only this trip's share is reversed, so their balance from
      // other trips with you is kept.
      for (const participant of removed) {
        if (participant.uid === ownerUid) continue;
        await adjustBalance(
          owner,
          { uid: participant.uid, name: participant.displayName, photo: participant.photoURL },
          -(participant.shareAmount || 0),
          { createIfMissing: false }
        );
      }
      for (const participant of trip.participants) {
        if (participant.uid === ownerUid) continue;
        const oldShare = oldParticipants.get(participant.uid)?.shareAmount || 0;
        await adjustBalance(
          owner,
          { uid: participant.uid, name: participant.displayName, photo: participant.photoURL },
          participant.shareAmount - oldShare,
          { createIfMissing: false }
        );
      }
    }

    // A guest without an account has a balance that only ever came from these
    // trips, so it can go. A linked guest is a real user: keep their balance.
    if (!guest.linkedUid) {
      try {
        await deleteDocument('balances', getBalanceKey(ownerUid, guest.guestUid));
      } catch (e: unknown) {
        if ((e as { code?: number }).code !== 404) throw e;
      }
    }
    await deleteDocument('guests', guest.id);
    return NextResponse.json({ success: true, data: { id: guest.id } });
  } catch (error: unknown) {
    console.error('Guests DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete guest' },
      { status: 500 }
    );
  }
}
