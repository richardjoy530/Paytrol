'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, cn } from '@/lib/utils';
import type { Friendship, GuestContact, Trip, TripParticipant } from '@/types';
import { invalidate, RESOURCES, setCachedData, useCachedData } from '@/lib/data-cache';
import { cleanTripName, collectTripTags } from '@/lib/trip-labels';
import TripLabelsFields from '@/components/TripLabelsFields';
import PersonToggle from '@/components/PersonToggle';
import QuickAddGuest from '@/components/QuickAddGuest';
import { guestSubtitle } from '@/lib/people';

interface VerifiedTripData {
  distanceKm: number;
  avgMileageKmpl: number;
  fuelPricePerLiter: number;
  fuelUsedLiters: number;
  totalCost: number;
}

function isVerifiedTripData(value: unknown): value is VerifiedTripData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Record<string, unknown>;
  return ['distanceKm', 'avgMileageKmpl', 'fuelPricePerLiter', 'fuelUsedLiters', 'totalCost'].every(
    (key) => typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] > 0
  );
}

export default function SplitPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [verifiedData, setVerifiedData] = useState<VerifiedTripData | null>(null);
  const friendsResource = useCachedData<{ friends: Friendship[] }>(RESOURCES.friends);
  const guestsResource = useCachedData<GuestContact[]>(RESOURCES.guests);
  const friends = friendsResource.data?.friends ?? [];
  const guestContacts = guestsResource.data ?? [];
  const setGuestContacts = (update: (current: GuestContact[]) => GuestContact[]) =>
    guestsResource.mutate((current) => update(current ?? []));
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [autoSelected, setAutoSelected] = useState(false);
  const [tripName, setTripName] = useState('');
  const [tripTags, setTripTags] = useState<string[]>([]);
  const { data: pastTrips } = useCachedData<Trip[]>(RESOURCES.trips);
  const tagSuggestions = collectTripTags(pastTrips ?? []);
  const [selectedGuests, setSelectedGuests] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [addingGuest, setAddingGuest] = useState(false);
  const [includeMe, setIncludeMe] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('paytrol_verified_v2');
    sessionStorage.removeItem('paytrol_verified');
    if (!raw) {
      router.replace('/capture');
      return;
    }
    try {
      const data: unknown = JSON.parse(raw);
      if (!isVerifiedTripData(data)) throw new Error('Invalid verified trip data');
      setVerifiedData(data);
    } catch {
      sessionStorage.removeItem('paytrol_verified_v2');
      router.replace('/capture');
      return;
    }
  }, [router]);

  // Pre-select the first friend once, for convenience, as soon as the friends list is known.
  const currentUserId = user?.uid || '';
  const firstFriend = friends[0];
  const firstFriendUid = firstFriend
    ? firstFriend.fromUid === currentUserId ? firstFriend.toUid : firstFriend.fromUid
    : null;
  if (!autoSelected && friendsResource.data && currentUserId) {
    setAutoSelected(true);
    if (firstFriendUid) setSelectedFriends([firstFriendUid]);
  }

  const friendUserIds = new Set(
    friends
      .map((friend) => friend.fromUid === currentUserId ? friend.toUid : friend.fromUid)
      .filter((uid): uid is string => Boolean(uid))
  );
  const selectableGuestContacts = guestContacts.filter(
    (guest) => !guest.linkedUid || !friendUserIds.has(guest.linkedUid)
  );

  // Toggle friend selection
  const handleToggleFriend = (friendUid: string) => {
    setSelectedFriends((prev) =>
      prev.includes(friendUid) ? prev.filter((id) => id !== friendUid) : [...prev, friendUid]
    );
  };

  const participantKeys = [
    ...(includeMe ? [currentUserId] : []),
    ...selectedFriends,
    ...selectedGuests.map((guestId) => `guest:${guestId}`),
  ];
  const participantCount = participantKeys.length;
  const totalCost = verifiedData?.totalCost || 0;
  if (!verifiedData) return null;

  const getParticipantShare = (participantKey: string): number => {
    if (participantCount <= 0 || totalCost <= 0) return 0;
    const totalCents = Math.round(totalCost * 100);
    const baseCents = Math.floor(totalCents / participantCount);
    const remainingCents = totalCents % participantCount;
    const participantIndex = participantKeys.indexOf(participantKey);
    return (baseCents + (participantIndex >= 0 && participantIndex < remainingCents ? 1 : 0)) / 100;
  };

  const handleAddGuest = async () => {
    const name = guestName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (guestContacts.some((guest) => guest.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setErrorMsg('A guest with that name is already in this split.');
      return;
    }

    setAddingGuest(true);
    try {
      const res = await fetch('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not add guest.');
      }
      const guest = data.data as GuestContact;
      setGuestContacts((current) => [guest, ...current]);
      setSelectedGuests((current) => [...current, guest.id]);
      setGuestName('');
      setErrorMsg(null);
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not add guest.');
    } finally {
      setAddingGuest(false);
    }
  };

  const handleToggleGuest = (guestId: string) => {
    setSelectedGuests((current) =>
      current.includes(guestId)
        ? current.filter((id) => id !== guestId)
        : [...current, guestId]
    );
  };

  const handleSaveTrip = async () => {
    if (!verifiedData) return;
    if (participantCount === 0) {
      setErrorMsg('Include yourself or select at least one friend.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);

    const photoURL = sessionStorage.getItem('paytrol_photoURL') || '';

    // Build participants array
    const participantsList: TripParticipant[] = [];

    // Current user if included
    if (includeMe) {
      participantsList.push({
        uid: currentUserId,
        displayName: user?.name || 'You (Driver)',
        photoURL: user?.image || null,
        shareAmount: getParticipantShare(currentUserId),
        customPercentage: null,
        settled: true, // creator is already settled
        settledAt: new Date().toISOString(),
      });
    }

    // Selected friends
    for (const fUid of selectedFriends) {
      const match = friends.find((f) => f.fromUid === fUid || f.toUid === fUid);
      const isFrom = match?.fromUid === fUid;
      const fName = isFrom ? match?.fromName : match?.toName;
      const fPhoto = isFrom ? match?.fromPhoto : match?.toPhoto;

      participantsList.push({
        uid: fUid,
        displayName: fName || 'Friend',
        photoURL: fPhoto || null,
        shareAmount: getParticipantShare(fUid),
        customPercentage: null,
        settled: false,
        settledAt: null,
      });
    }

    for (const guestId of selectedGuests) {
      const guest = guestContacts.find((contact) => contact.id === guestId);
      if (!guest) continue;
      participantsList.push({
        uid: guest.linkedUid || guest.guestUid,
        guestContactId: guest.id,
        displayName: guest.name,
        photoURL: null,
        isGuest: !guest.linkedUid,
        shareAmount: getParticipantShare(`guest:${guest.id}`),
        customPercentage: null,
        settled: false,
        settledAt: null,
      });
    }

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoURL,
          distanceKm: verifiedData.distanceKm,
          avgMileageKmpl: verifiedData.avgMileageKmpl,
          fuelPricePerLiter: verifiedData.fuelPricePerLiter,
          fuelUsedLiters: verifiedData.fuelUsedLiters,
          totalCost: verifiedData.totalCost,
          splitMode: 'equal',
          participants: participantsList,
          name: cleanTripName(tripName),
          tags: tripTags,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save trip');
      }

      sessionStorage.setItem('paytrol_tripResult', JSON.stringify(data.data));
      setCachedData<Trip[]>(RESOURCES.trips, (current) => [data.data as Trip, ...(current ?? [])]);
      invalidate([RESOURCES.trips, RESOURCES.balances]);
      router.push('/result');
    } catch (err: unknown) {
      console.error('Trip save error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create trip ledger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/verify')}
            className="text-muted hover:text-ink p-1 rounded-lg"
          >
            ←
          </button>
          <h1 className="text-2xl font-black text-ink">Trip Splitting</h1>
        </div>
        <p className="text-xs text-muted mt-1">
          Total: <strong className="text-ink font-bold">{formatCurrency(totalCost)}</strong> ({verifiedData?.fuelUsedLiters} L fuel @ ₹{verifiedData?.fuelPricePerLiter}/L)
        </p>
      </header>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-danger-soft border border-danger-line text-xs text-danger">
          {errorMsg}
        </div>
      )}

      <div className="rounded-2xl bg-surface border border-line p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {user?.image ? (
            <img src={user.image} alt="" className="w-10 h-10 rounded-full border border-line" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-surface-soft text-ink-soft flex items-center justify-center font-bold">
              {user?.name?.[0] || 'Y'}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-ink">Include me in the split</p>
            <p className="text-xs text-muted">Driver share included in calculation</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIncludeMe(!includeMe)}
          role="switch"
          aria-checked={includeMe}
          aria-label="Include me in the split"
          className={cn(
            'w-12 h-7 rounded-full p-1 transition-colors duration-200 ease-in-out relative',
            includeMe ? 'bg-primary' : 'bg-line-strong'
          )}
        >
          <div
            className={cn(
              'w-5 h-5 rounded-full bg-surface transform transition-transform duration-200 ease-in-out',
              includeMe ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </button>
      </div>
      <div className="rounded-2xl border border-line bg-surface px-4 py-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-soft">Equal split</span>
        <span className="text-xs font-bold text-ink">
          {participantCount > 0 ? `1 / ${participantCount}` : '0'}
        </span>
      </div>

      {/* People in this split */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">People in this split</h2>
          <button
            type="button"
            onClick={() => router.push('/friends')}
            className="text-xs font-semibold text-primary hover:text-primary-hover"
          >
            Manage people
          </button>
        </div>

        {friends.length > 0 && (
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Friends</p>
        )}
        {friends.map((friend) => {
          const isFrom = friend.fromUid === currentUserId;
          const fUid = isFrom ? friend.toUid : friend.fromUid;
          if (!fUid) return null;
          const isSelected = selectedFriends.includes(fUid);
          return (
            <PersonToggle
              key={friend.id}
              name={(isFrom ? friend.toName : friend.fromName) || 'Friend'}
              subtitle={isFrom ? friend.toEmail : friend.fromEmail}
              photo={isFrom ? friend.toPhoto : friend.fromPhoto}
              verified
              selected={isSelected}
              onToggle={() => handleToggleFriend(fUid)}
              trailing={isSelected && (
                <span className="text-sm font-bold text-primary">{formatCurrency(getParticipantShare(fUid))}</span>
              )}
            />
          );
        })}

        {selectableGuestContacts.length > 0 && (
          <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Guests ({selectableGuestContacts.length})
          </p>
        )}
        {selectableGuestContacts.map((guest) => {
          const isSelected = selectedGuests.includes(guest.id);
          return (
            <PersonToggle
              key={guest.id}
              name={guest.name}
              subtitle={guestSubtitle(guest)}
              verified={Boolean(guest.linkedUid)}
              selected={isSelected}
              onToggle={() => handleToggleGuest(guest.id)}
              trailing={isSelected && (
                <span className="text-sm font-bold text-primary">
                  {formatCurrency(getParticipantShare(`guest:${guest.id}`))}
                </span>
              )}
            />
          );
        })}

        {friends.length === 0 && selectableGuestContacts.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line p-4 text-center text-xs text-muted">
            Just you so far. Add a guest below, or add friends from the Friends tab.
          </p>
        )}

        <QuickAddGuest value={guestName} onChange={setGuestName} onAdd={handleAddGuest} adding={addingGuest} />
      </section>

      {/* Optional trip name and tags */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">Trip details</h2>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <TripLabelsFields
            name={tripName}
            onNameChange={setTripName}
            tags={tripTags}
            onTagsChange={setTripTags}
            suggestions={tagSuggestions}
          />
        </div>
      </section>

      {/* Summary card */}
      <div className="rounded-2xl bg-canvas border border-line p-4 space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Active Participants:</span>
          <span className="text-ink font-semibold">{participantCount} person(s)</span>
        </div>
        <div className="flex justify-between text-xs text-muted">
          <span>Total Fuel Bill:</span>
          <span className="text-ink font-semibold">{formatCurrency(totalCost)}</span>
        </div>
        <div className="border-t border-line pt-2 flex justify-between items-baseline">
          <span className="text-xs font-semibold text-muted">Typical share:</span>
          <span className="text-xl font-black text-ink">
            {participantCount > 0 ? formatCurrency(totalCost / participantCount) : formatCurrency(0)}
          </span>
        </div>
      </div>

      {/* Submit / Save Button */}
      <button
        type="button"
        onClick={handleSaveTrip}
        disabled={participantCount === 0 || saving}
        className="w-full py-4 bg-primary hover:bg-primary-hover active:scale-[0.99] disabled:bg-surface-sunken disabled:text-muted text-on-primary font-semibold rounded-2xl transition-all text-base flex items-center justify-center gap-2"
      >
        {saving ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
            Posting to ledger...
          </span>
        ) : (
          <span>{participantCount > 1 ? 'Split & Save Trip' : 'Save as Solo Trip'}</span>
        )}
      </button>
    </div>
  );
}
