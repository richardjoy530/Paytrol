'use client';

import { useState } from 'react';
import { formatCurrency, cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import type { Trip } from '@/types';
import { RESOURCES, useCachedData } from '@/lib/data-cache';
import { CheckCircleIcon, CheckIcon, ChevronDownIcon } from '@/components/icons';
import { BTN, BTN_SIZE } from '@/lib/ui';

interface NormalizedBalance {
  id: string;
  odataId: string;
  friendUid: string;
  friendName: string;
  friendPhoto: string | null;
  isGuest?: boolean;
  amount: number; // positive = friend owes you, negative = you owe friend
}

export default function BalancesPage() {
  const { user } = useAuth();
  const balancesResource = useCachedData<NormalizedBalance[]>(RESOURCES.balances);
  const tripsResource = useCachedData<Trip[]>(RESOURCES.trips);
  const balances = Array.isArray(balancesResource.data) ? balancesResource.data : [];
  const trips = Array.isArray(tripsResource.data) ? tripsResource.data : [];
  const loading = balancesResource.loading;
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [confirmSettleId, setConfirmSettleId] = useState<string | null>(null);
  const [expandedFriendUid, setExpandedFriendUid] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const fetchBalancesList = async (): Promise<boolean> => {
    try {
      await Promise.all([balancesResource.refresh(), tripsResource.refresh()]);
      return true;
    } catch (error: unknown) {
      console.error('Failed to load balances:', error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not load balances.',
      });
      return false;
    }
  };

  /** Returns true when the balance was settled. */
  const handleSettle = async (balanceId: string): Promise<boolean> => {
    setSettlingId(balanceId);
    setFeedback(null);
    setSettleError(null);
    try {
      const res = await fetch('/api/balances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balanceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not update this balance.');
      }
      if (await fetchBalancesList()) {
        setFeedback({ type: 'success', message: 'Balance marked as settled.' });
      }
      return true;
    } catch (error: unknown) {
      console.error('Error settling balance:', error);
      // Shown inside the confirm panel, which stays open so they can retry.
      setSettleError(error instanceof Error ? error.message : 'Could not update this balance.');
      return false;
    } finally {
      setSettlingId(null);
    }
  };

  const totalOwedToYou = balances
    .filter((b) => b.amount > 0)
    .reduce((sum, b) => sum + b.amount, 0);

  const totalYouOwe = balances
    .filter((b) => b.amount < 0)
    .reduce((sum, b) => sum + Math.abs(b.amount), 0);

  const activeBalances = balances.filter((b) => Math.abs(b.amount) > 0.01);
  const currentUserId = user?.uid || '';

  const getTripBreakdown = (friendUid: string) => {
    return trips
      .filter((trip) =>
        trip.creatorUid === friendUid
          ? trip.participants.some((participant) => participant.uid === currentUserId)
          : trip.creatorUid === currentUserId
            ? trip.participants.some((participant) => participant.uid === friendUid)
            : false
      )
      .map((trip) => {
        const friendParticipant =
          trip.creatorUid === currentUserId
            ? trip.participants.find((participant) => participant.uid === friendUid)
            : trip.participants.find((participant) => participant.uid === currentUserId);

        if (!friendParticipant) return null;
        return {
          trip,
          amount: friendParticipant.shareAmount || 0,
          friendOwesYou: trip.creatorUid === currentUserId,
        };
      })
      .filter(
        (item): item is { trip: Trip; amount: number; friendOwesYou: boolean } => item !== null
      )
      .sort(
        (a, b) =>
          new Date(b.trip.createdAt).getTime() - new Date(a.trip.createdAt).getTime()
      );
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-ink">Balances &amp; Settlements</h1>
        <p className="text-xs text-muted mt-1">
          Net amounts across your trips. Record payments here when they’re settled.
        </p>
      </header>

      {feedback && (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-xl border px-3.5 py-3 text-xs',
            feedback.type === 'success'
              ? 'border-line-strong bg-canvas text-ink-soft'
              : 'border-danger-line bg-danger-soft text-danger'
          )}
        >
          {feedback.message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-surface-soft border border-line p-4 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Owed to you
          </span>
          <p className="text-2xl font-black text-ink">{formatCurrency(totalOwedToYou)}</p>
          <p className="text-[11px] text-muted">From shared fuel bills</p>
        </div>
        <div className="rounded-3xl bg-warning-soft border border-warning-line p-4 space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-warning">
            You owe
          </span>
          <p className="text-2xl font-black text-ink">{formatCurrency(totalYouOwe)}</p>
          <p className="text-[11px] text-warning">To friends</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-semibold uppercase tracking-wider">Net Friend Balances</span>
          <span>{activeBalances.length} active</span>
        </div>

        {loading ? (
          <div className="space-y-2.5">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 bg-surface rounded-3xl animate-pulse" />
            ))}
          </div>
        ) : activeBalances.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-line p-10 text-center space-y-2">
            <CheckCircleIcon size={36} strokeWidth={1.6} className="mx-auto text-primary" />
            <p className="text-sm font-semibold text-ink">All balances are settled!</p>
            <p className="text-xs text-muted max-w-xs mx-auto">
              When you or your friends split trips, the net balances will automatically update here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeBalances.map((bal, idx) => {
              const isOwed = bal.amount > 0;
              const absAmount = Math.abs(bal.amount);
              return (
                <div
                  key={`${bal.odataId || bal.id}-${idx}`}
                  className="rounded-3xl bg-surface border border-line p-4 space-y-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {bal.friendPhoto ? (
                        <img src={bal.friendPhoto} alt="" className="w-11 h-11 rounded-2xl border border-line" />
                      ) : (
                        <div className="w-11 h-11 rounded-2xl bg-primary-soft text-primary flex items-center justify-center font-bold text-base">
                          {bal.friendName?.[0] || 'F'}
                        </div>
                      )}
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                          {bal.friendName}
                          {bal.isGuest && (
                            <span className="rounded-full bg-surface-soft px-1.5 py-0.5 text-[11px] font-medium text-muted">
                              Guest
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted">{isOwed ? 'Owes you' : 'You owe'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-xl font-black', isOwed ? 'text-primary' : 'text-warning')}>
                        {formatCurrency(absAmount)}
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const expanded = expandedFriendUid === bal.friendUid;
                    const tripCount = getTripBreakdown(bal.friendUid).length;
                    const canSettle = isOwed || bal.isGuest;
                    const settling = settlingId === bal.odataId;
                    if (confirmSettleId === bal.odataId) {
                      return (
                        <div className="rounded-2xl border border-primary-line bg-primary-soft p-3 space-y-2.5">
                          <p className="text-xs font-medium text-ink">
                            {isOwed
                              ? `Mark ${formatCurrency(absAmount)} from ${bal.friendName} as received?`
                              : `Mark your ${formatCurrency(absAmount)} to ${bal.friendName} as paid?`}
                          </p>
                          {settleError && (
                            <p role="alert" className="text-xs text-danger">
                              {settleError}
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmSettleId(null);
                                setSettleError(null);
                              }}
                              disabled={settling}
                              className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (await handleSettle(bal.odataId)) setConfirmSettleId(null);
                              }}
                              disabled={settling}
                              className={cn(BTN.primary, BTN_SIZE.md, 'w-full')}
                            >
                              <CheckIcon size={16} />
                              {settling ? 'Saving…' : 'Yes, settled'}
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <div className={cn('grid gap-2', canSettle ? 'grid-cols-2' : 'grid-cols-1')}>
                          <button
                            type="button"
                            onClick={() => setExpandedFriendUid(expanded ? null : bal.friendUid)}
                            aria-expanded={expanded}
                            className={cn(BTN.secondary, BTN_SIZE.md, 'w-full')}
                          >
                            {expanded
                              ? 'Hide trips'
                              : tripCount === 1
                                ? '1 trip'
                                : `${tripCount} trips`}
                            <ChevronDownIcon
                              size={16}
                              className={cn('transition-transform', expanded && 'rotate-180')}
                            />
                          </button>
                          {canSettle && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmSettleId(bal.odataId);
                                setSettleError(null);
                              }}
                              className={cn(BTN.soft, BTN_SIZE.md, 'w-full')}
                            >
                              <CheckIcon size={16} />
                              Mark settled
                            </button>
                          )}
                        </div>
                        {!canSettle && (
                          <p className="text-center text-[11px] text-muted">
                            {bal.friendName} marks this settled once you&apos;ve paid.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {expandedFriendUid === bal.friendUid && (
                    <div className="rounded-2xl border border-line bg-canvas p-3 space-y-2">
                      {getTripBreakdown(bal.friendUid).length === 0 ? (
                        <p className="text-xs text-muted">No trip split details found.</p>
                      ) : (
                        getTripBreakdown(bal.friendUid).map(({ trip, amount, friendOwesYou }) => (
                          <div
                            key={trip.id}
                            className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                          >
                            <div>
                              <p className="text-xs font-semibold text-ink">
                                {trip.name || `${trip.distanceKm} km trip`}
                              </p>
                              <p className="text-[11px] text-muted">
                                {friendOwesYou ? 'Their share' : 'Your share'} ·{' '}
                                {formatCurrency(trip.totalCost)} total
                              </p>
                            </div>
                            <p className="text-xs font-bold text-ink">
                              {friendOwesYou ? '+' : '−'}{formatCurrency(amount)}
                            </p>
                          </div>
                        ))
                      )}
                      <p className="pt-1 text-[11px] text-muted">
                        Net {formatCurrency(absAmount)} after trips paid by each of you.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
