import { createDocument, queryDocuments, updateDocument, deleteDocument, equalsIgnoreCase } from '@/lib/db';
import type { Friendship, UserProfile } from '@/types';
import { generateId } from '@/lib/utils';

export interface InviteSender {
  uid: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export type InviteResult =
  | { ok: true; data: Friendship; message: string }
  | { ok: false; status: number; error: string };

/**
 * Every friendship document involving this user, filtered in code so the
 * result is exact on both Cosmos and the in-memory store.
 */
export async function getRelationships(uid: string, email: string | undefined): Promise<Friendship[]> {
  const docs = await queryDocuments<Friendship>(
    'friendships',
    {
      $or: [
        { fromUid: uid },
        { toUid: uid },
        ...(email ? [{ toEmail: equalsIgnoreCase(email) }] : []),
      ],
    }
  );
  const seen = new Set<string>();
  return docs.filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return (
      doc.fromUid === uid ||
      doc.toUid === uid ||
      (!!email && doc.toEmail?.toLowerCase() === email && doc.fromUid !== uid)
    );
  });
}

/** A stable key for "the other person" so mutual invites collapse into one entry. */
export function otherPartyKey(doc: Friendship, uid: string): string {
  if (doc.fromUid === uid) return doc.toUid || doc.toEmail.toLowerCase();
  return doc.fromUid;
}

/**
 * Send a friend invite from `sender` to `rawEmail`, or accept theirs if they
 * already invited the sender. Shared by the Friends API and Add person.
 */
export async function sendFriendInvite(sender: InviteSender, rawEmail: string): Promise<InviteResult> {
  const uid = sender.uid;
  const targetEmail = rawEmail.toLowerCase().trim();

  if (!targetEmail || !targetEmail.includes('@')) {
    return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  }

  const myEmail = sender.email?.toLowerCase();
  if (myEmail && targetEmail === myEmail) {
    return { ok: false, status: 400, error: 'You cannot send a friend invite to yourself.' };
  }

  // Check if invite or friendship already exists, in either direction
  const existing = (await getRelationships(uid, myEmail)).filter((invite) =>
    invite.fromUid === uid
      ? invite.toEmail.toLowerCase() === targetEmail
      : invite.fromEmail?.toLowerCase() === targetEmail
  );

  // They already invited us: accept that invite instead of creating a second one.
  const theirInvite = existing.find((invite) => invite.status === 'pending' && invite.fromUid !== uid);
  if (theirInvite && !existing.some((invite) => invite.status === 'accepted')) {
    theirInvite.status = 'accepted';
    theirInvite.toUid = uid;
    theirInvite.updatedAt = new Date().toISOString();
    const accepted = await updateDocument('friendships', theirInvite);
    return {
      ok: true,
      data: accepted,
      message: `${theirInvite.fromName || 'They'} had already invited you, so you're now friends.`,
    };
  }

  if (existing.some((invite) => invite.status === 'accepted')) {
    return { ok: false, status: 400, error: 'You are already friends with this person.' };
  }
  if (existing.some((invite) => invite.status === 'pending')) {
    return { ok: false, status: 400, error: 'An invite is already pending with this person.' };
  }
  // A previously declined invite no longer blocks a new one.
  for (const declined of existing.filter((invite) => invite.status === 'declined')) {
    await deleteDocument('friendships', declined.id);
  }

  const targetUser = await findUserByEmail(targetEmail);

  const now = new Date().toISOString();
  const friendship: Friendship = {
    id: generateId(),
    fromUid: uid,
    fromName: sender.name || 'Driver',
    fromEmail: myEmail || 'driver@paytrol.app',
    fromPhoto: sender.image || null,
    toUid: targetUser?.id || null,
    toEmail: targetEmail,
    toName: targetUser?.displayName || targetEmail.split('@')[0],
    toPhoto: targetUser?.photoURL || null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const created = await createDocument('friendships', friendship);

  // No email is sent yet: the invite appears in the app when they sign in with this email.
  return {
    ok: true,
    data: created,
    message: targetUser
      ? `Friend request sent to ${created.toName}.`
      : 'Invite saved. It will appear when they sign in to Paytrol with this email.',
  };
}

/** The Paytrol account that uses this email, if any. */
export async function findUserByEmail(email: string): Promise<UserProfile | null> {
  const users = await queryDocuments<UserProfile>('users', { email: equalsIgnoreCase(email.trim()) });
  return users.find((user) => user.email?.toLowerCase() === email.trim().toLowerCase()) || users[0] || null;
}
