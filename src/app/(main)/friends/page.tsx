'use client';

import { useId, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Friendship, GuestContact } from '@/types';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  UserPlusIcon,
  VerifiedIcon,
} from '@/components/icons';
import { invalidate, RESOURCES, useCachedData } from '@/lib/data-cache';
import { BTN, BTN_SIZE } from '@/lib/ui';

interface FriendLists {
  friends: Friendship[];
  pendingSent: Friendship[];
  pendingReceived: Friendship[];
}

const INPUT =
  'h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink outline-none focus:border-primary disabled:opacity-60';

export default function FriendsPage() {
  const { user } = useAuth();
  const nameId = useId();
  const emailId = useId();
  const friendsResource = useCachedData<FriendLists>(RESOURCES.friends);
  const guestsResource = useCachedData<GuestContact[]>(RESOURCES.guests);
  const friends = friendsResource.data?.friends ?? [];
  const pendingSent = friendsResource.data?.pendingSent ?? [];
  const pendingReceived = friendsResource.data?.pendingReceived ?? [];
  const loading = friendsResource.loading;
  const currentUserId = user?.uid || '';

  // A guest whose account is already a friend is shown once, as the friend.
  const friendUids = new Set(
    friends
      .map((friend) => (friend.fromUid === currentUserId ? friend.toUid : friend.fromUid))
      .filter((uid): uid is string => Boolean(uid))
  );
  const guests = (guestsResource.data ?? []).filter(
    (guest) => !guest.linkedUid || !friendUids.has(guest.linkedUid)
  );

  const setFriends = (update: (current: Friendship[]) => Friendship[]) =>
    friendsResource.mutate((current) => ({
      friends: update(current?.friends ?? []),
      pendingSent: current?.pendingSent ?? [],
      pendingReceived: current?.pendingReceived ?? [],
    }));
  const setGuestContacts = (update: (current: GuestContact[]) => GuestContact[]) =>
    guestsResource.mutate((current) => update(current ?? []));

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add person
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // One open row at a time, keyed `friend:<id>` or `guest:<id>`.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [guestNameDraft, setGuestNameDraft] = useState('');
  const [guestEmailDraft, setGuestEmailDraft] = useState('');

  const toggleRow = (key: string, guest?: GuestContact) => {
    setConfirmingDelete(false);
    setRowError(null);
    if (openRow === key) {
      setOpenRow(null);
      return;
    }
    setOpenRow(key);
    if (guest) {
      setGuestNameDraft(guest.name);
      setGuestEmailDraft(guest.email || '');
    }
  };

  const closeAdd = () => {
    setShowAdd(false);
    setNewName('');
    setNewEmail('');
    setAddError(null);
  };

  const handleAddPerson = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name) return;
    setAdding(true);
    setAddError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not add this person.');
      }
      if (data.kind === 'guest') {
        const guest = data.data as GuestContact;
        setGuestContacts((current) => [guest, ...current]);
      } else {
        invalidate([RESOURCES.friends]);
      }
      closeAdd();
      setNotice({ type: 'success', text: data.message });
    } catch (error: unknown) {
      // Keep the form open so nothing typed is lost.
      setAddError(error instanceof Error ? error.message : 'Could not add this person.');
    } finally {
      setAdding(false);
    }
  };

  const handleRespondInvite = async (friendshipId: string, action: 'accept' | 'decline') => {
    setNotice(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId, action }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not answer this request.');
      setNotice({ type: 'success', text: action === 'accept' ? 'You’re now friends.' : 'Request declined.' });
      invalidate([RESOURCES.friends, RESOURCES.guests]);
    } catch (error: unknown) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Could not answer this request.' });
    }
  };

  const handleUnfriend = async (friendshipId: string) => {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not remove friend.');
      setFriends((current) => current.filter((friend) => friend.id !== friendshipId));
      invalidate([RESOURCES.friends, RESOURCES.balances]);
      setOpenRow(null);
      setNotice({ type: 'success', text: 'Friend removed.' });
    } catch (error: unknown) {
      setRowError(error instanceof Error ? error.message : 'Could not remove friend.');
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const handleDeleteGuest = async (guestId: string) => {
    setBusy(true);
    setRowError(null);
    try {
      const res = await fetch('/api/guests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not delete guest.');
      setGuestContacts((current) => current.filter((guest) => guest.id !== guestId));
      invalidate([RESOURCES.trips, RESOURCES.balances]);
      setOpenRow(null);
      setNotice({ type: 'success', text: 'Guest deleted and removed from their trips.' });
    } catch (error: unknown) {
      setRowError(error instanceof Error ? error.message : 'Could not delete guest.');
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const handleSaveGuest = async (guest: GuestContact) => {
    setBusy(true);
    setRowError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/guests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: guest.id,
          name: guestNameDraft,
          email: guestEmailDraft.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not save guest.');
      const updated = data.data as GuestContact;
      setGuestContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const justLinked = Boolean(updated.linkedUid && !guest.linkedUid);
      if (justLinked) invalidate([RESOURCES.trips, RESOURCES.balances, RESOURCES.friends]);
      setOpenRow(null);
      setNotice({
        type: 'success',
        text: justLinked
          ? `${guest.name} already uses Paytrol as ${updated.name}. Their trips and balance moved to that account.`
          : 'Guest saved.',
      });
    } catch (error: unknown) {
      setRowError(error instanceof Error ? error.message : 'Could not save guest.');
    } finally {
      setBusy(false);
    }
  };

  const deleteConfirm = (label: string, question: string, onConfirm: () => void) =>
    confirmingDelete ? (
      <div className="space-y-2.5 rounded-xl border border-danger-line bg-danger-soft p-3">
        <p className="text-xs font-medium text-ink">{question}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={busy}
            className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className={cn(BTN.danger, BTN_SIZE.md, 'w-full')}>
            {busy ? 'Working…' : label}
          </button>
        </div>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setConfirmingDelete(true)}
        className={cn(BTN.dangerOutline, BTN_SIZE.md, 'w-full')}
      >
        {label}
      </button>
    );

  const rowErrorText = rowError && (
    <p role="alert" className="text-xs text-danger">
      {rowError}
    </p>
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink">Friends</h1>
          <p className="mt-1 text-xs text-muted">People you split trips with.</p>
        </div>
        {!showAdd && (
          <button
            type="button"
            onClick={() => {
              setShowAdd(true);
              setNotice(null);
            }}
            className={cn(BTN.primary, BTN_SIZE.md)}
          >
            <UserPlusIcon size={18} />
            Add person
          </button>
        )}
      </header>

      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-start gap-2.5 rounded-2xl border p-3.5 text-xs',
            notice.type === 'success'
              ? 'border-primary-line bg-primary-soft text-primary'
              : 'border-danger-line bg-danger-soft text-danger'
          )}
        >
          {notice.type === 'success' ? <CheckCircleIcon size={18} /> : <AlertCircleIcon size={18} />}
          <span>{notice.text}</span>
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAddPerson} className="space-y-3 rounded-2xl border border-primary-line bg-surface p-4">
          <h2 className="text-sm font-bold text-ink">Add person</h2>
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-xs font-medium text-muted">
              Name
            </label>
            <input
              id={nameId}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={80}
              required
              autoFocus
              placeholder="e.g. Rahul"
              className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={emailId} className="block text-xs font-medium text-muted">
              Email <span className="font-normal">(optional)</span>
            </label>
            <input
              id={emailId}
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="rahul@example.com"
              className={INPUT}
            />
            <p className="text-[11px] text-muted">
              If they use Paytrol, we send a friend request. If not, you can split with them now and their
              trips move to their account when they sign up.
            </p>
          </div>
          {addError && (
            <p role="alert" className="text-xs text-danger">
              {addError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={closeAdd} className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={adding || !newName.trim()}
              className={cn(BTN.primary, BTN_SIZE.md, 'w-full')}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-soft" />
          ))}
        </div>
      ) : (
        <>
          {pendingReceived.length > 0 && (
            <Section title="Requests" count={pendingReceived.length}>
              {pendingReceived.map((f) => (
                <Card key={f.id}>
                  <Person name={f.fromName} subtitle={f.fromEmail} photo={f.fromPhoto} verified />
                  <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                    <button
                      type="button"
                      onClick={() => handleRespondInvite(f.id, 'decline')}
                      className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondInvite(f.id, 'accept')}
                      className={cn(BTN.primary, BTN_SIZE.md, 'w-full')}
                    >
                      Accept
                    </button>
                  </div>
                </Card>
              ))}
            </Section>
          )}

          <Section title="Friends" count={friends.length}>
            {friends.length === 0 ? (
              <Empty>No friends yet. Tap Add person and enter their email.</Empty>
            ) : (
              friends.map((f) => {
                const isFrom = f.fromUid === currentUserId;
                const name = (isFrom ? f.toName : f.fromName) || 'Friend';
                const key = `friend:${f.id}`;
                const open = openRow === key;
                return (
                  <Card key={f.id} open={open}>
                    <Person
                      name={name}
                      verified
                      subtitle={isFrom ? f.toEmail : f.fromEmail}
                      photo={isFrom ? f.toPhoto : f.fromPhoto}
                      onClick={() => toggleRow(key)}
                      open={open}
                    />
                    {open && (
                      <div className="space-y-2.5 border-t border-line p-3">
                        {rowErrorText}
                        {deleteConfirm('Remove friend', `Remove ${name} from your friends?`, () =>
                          handleUnfriend(f.id)
                        )}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </Section>

          {pendingSent.length > 0 && (
            <Section title="Requests sent" count={pendingSent.length}>
              {pendingSent.map((f) => (
                <Card key={f.id}>
                  <Person
                    name={f.toName || f.toEmail}
                    subtitle={f.toEmail}
                    photo={f.toPhoto}
                    trailing={<span className="rounded-full bg-surface-soft px-2.5 py-1 text-[11px] font-semibold text-muted">Waiting</span>}
                  />
                </Card>
              ))}
            </Section>
          )}

          <Section title="Guests" count={guests.length} hint="Not on Paytrol yet. You track them by name.">
            {guests.length === 0 ? (
              <Empty>No guests yet. Add someone without an email, or whose email isn&apos;t on Paytrol.</Empty>
            ) : (
              guests.map((guest) => {
                const key = `guest:${guest.id}`;
                const open = openRow === key;
                return (
                  <Card key={guest.id} open={open}>
                    <Person
                      name={guest.name}
                      verified={Boolean(guest.linkedUid)}
                      subtitle={
                        guest.linkedUid
                          ? 'Has an account'
                          : guest.email
                            ? `Invited · ${guest.email}`
                            : 'Guest'
                      }
                      onClick={() => toggleRow(key, guest)}
                      open={open}
                    />
                    {open && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleSaveGuest(guest);
                        }}
                        className="space-y-3 border-t border-line p-3"
                      >
                        <label className="block space-y-1.5">
                          <span className="block text-xs font-medium text-muted">Name</span>
                          <input
                            value={guestNameDraft}
                            onChange={(event) => setGuestNameDraft(event.target.value)}
                            maxLength={80}
                            required
                            className={INPUT}
                          />
                        </label>
                        <label className="block space-y-1.5">
                          <span className="block text-xs font-medium text-muted">
                            Email <span className="font-normal">(optional)</span>
                          </span>
                          <input
                            type="email"
                            value={guestEmailDraft}
                            onChange={(event) => setGuestEmailDraft(event.target.value)}
                            disabled={Boolean(guest.linkedUid)}
                            placeholder="name@example.com"
                            className={INPUT}
                          />
                          <span className="block text-[11px] text-muted">
                            {guest.linkedUid
                              ? 'Linked to their account, so the email can’t change.'
                              : 'When they sign up with this email, their trips move to their account.'}
                          </span>
                        </label>
                        {rowErrorText}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => toggleRow(key)}
                            className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={busy || confirmingDelete}
                            className={cn(BTN.primary, BTN_SIZE.md, 'w-full')}
                          >
                            {busy && !confirmingDelete ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        {deleteConfirm(
                          'Delete guest',
                          `Delete ${guest.name}? They’re removed from your trips and their share is split among the others.`,
                          () => handleDeleteGuest(guest.id)
                        )}
                      </form>
                    )}
                  </Card>
                );
              })
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          {title}
          {count ? (
            <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[11px] font-semibold text-muted">
              {count}
            </span>
          ) : null}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Card({ open, children }: { open?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-surface', open ? 'border-line-strong' : 'border-line')}>
      {children}
    </div>
  );
}

function Person({
  name,
  subtitle,
  photo,
  verified,
  onClick,
  open,
  trailing,
}: {
  name: string;
  subtitle?: string | null;
  photo?: string | null;
  verified?: boolean;
  onClick?: () => void;
  open?: boolean;
  trailing?: React.ReactNode;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-10 w-10 shrink-0 rounded-full" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
            {name?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-semibold text-ink">
            <span className="truncate">{name}</span>
            {verified && (
              <span title="Has a Paytrol account" className="shrink-0 text-primary">
                <VerifiedIcon size={15} />
                <span className="sr-only">Has a Paytrol account</span>
              </span>
            )}
          </p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {trailing}
      {onClick && (
        <ChevronDownIcon
          size={18}
          className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      )}
    </>
  );

  if (!onClick) {
    return <div className="flex min-h-16 items-center justify-between gap-3 p-3">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-16 w-full items-center justify-between gap-3 p-3 text-left hover:bg-surface-soft"
    >
      {content}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-muted">
      {children}
    </div>
  );
}
