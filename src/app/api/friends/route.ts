import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { queryDocuments, getDocument, updateDocument, deleteDocument } from '@/lib/db';
import type { Friendship } from '@/types';
import { getRelationships, otherPartyKey, sendFriendInvite } from '@/lib/friend-invites';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const uid = session?.user?.uid || null;
    const email = session?.user?.email?.toLowerCase();

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // The auto-link lookup and the relationship query don't depend on each
    // other (the relationship query already matches invites by email), so
    // run them together instead of one after another.
    const [unlinkedInvites, relationships] = await Promise.all([
      // Invites sent to this user's email before they signed up
      email
        ? queryDocuments<Friendship>('friendships', { toEmail: email, $or: [{ toUid: null }, { toUid: '' }] })
        : Promise.resolve([] as Friendship[]),
      getRelationships(uid, email),
    ]);

    // Link those invites to this account
    await Promise.all(
      unlinkedInvites.map((inv) => {
        inv.toUid = uid;
        inv.toName = session?.user?.name || inv.toName;
        inv.toPhoto = session?.user?.image || inv.toPhoto;
        inv.updatedAt = new Date().toISOString();
        return updateDocument('friendships', inv);
      })
    );

    // One entry per person: mutual or repeated invites must not show twice.
    const friends: Friendship[] = [];
    const friendKeys = new Set<string>();
    for (const doc of relationships) {
      if (doc.status !== 'accepted') continue;
      const key = otherPartyKey(doc, uid);
      if (friendKeys.has(key)) continue;
      friendKeys.add(key);
      friends.push(doc);
    }
    const pendingSent = relationships.filter(
      (doc) => doc.status === 'pending' && doc.fromUid === uid && !friendKeys.has(otherPartyKey(doc, uid))
    );
    const pendingReceived = relationships.filter(
      (doc) => doc.status === 'pending' && doc.fromUid !== uid && !friendKeys.has(otherPartyKey(doc, uid))
    );

    return NextResponse.json({
      success: true,
      data: {
        friends,
        pendingSent,
        pendingReceived,
      },
    });
  } catch (error: unknown) {
    console.error('Friends GET error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load friends' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = session?.user?.uid || null;

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const result = await sendFriendInvite(
      { uid, name: session?.user?.name, email: session?.user?.email, image: session?.user?.image },
      typeof body.email === 'string' ? body.email : ''
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data, message: result.message });
  } catch (error: unknown) {
    console.error('Friends POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send invite' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = session?.user?.uid || null;

    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { friendshipId, action } = body;

    if (!friendshipId || !['accept', 'decline'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid invite parameters' },
        { status: 400 }
      );
    }

    const friendship = await getDocument<Friendship>('friendships', friendshipId);
    if (!friendship) {
      return NextResponse.json(
        { success: false, error: 'Friendship invite not found.' },
        { status: 404 }
      );
    }
    const recipientMatches =
      friendship.toUid === uid ||
      friendship.toEmail.toLowerCase() === session?.user?.email?.toLowerCase();
    if (!recipientMatches) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    friendship.status = action === 'accept' ? 'accepted' : 'declined';
    friendship.toUid = uid;
    friendship.toName = session?.user?.name || friendship.toName;
    friendship.toPhoto = session?.user?.image || friendship.toPhoto;
    friendship.updatedAt = new Date().toISOString();

    const updated = await updateDocument('friendships', friendship);
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    console.error('Friends PATCH error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update invite' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = session?.user?.uid || null;
    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { friendshipId?: unknown };
    if (typeof body.friendshipId !== 'string') {
      return NextResponse.json({ success: false, error: 'Friendship ID is required.' }, { status: 400 });
    }

    const friendship = await getDocument<Friendship>('friendships', body.friendshipId);
    if (!friendship) {
      return NextResponse.json({ success: false, error: 'Friendship not found.' }, { status: 404 });
    }
    if (friendship.fromUid !== uid && friendship.toUid !== uid) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    await deleteDocument('friendships', friendship.id);
    return NextResponse.json({ success: true, data: { id: friendship.id } });
  } catch (error: unknown) {
    console.error('Friends DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to unfriend' },
      { status: 500 }
    );
  }
}
