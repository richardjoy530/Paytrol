import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createGuestContact } from '@/lib/guest-linking';
import { findUserByEmail, sendFriendInvite } from '@/lib/friend-invites';

/**
 * Add person: one entry point for both friends and guests.
 * - Email of someone on Paytrol: send them a friend request.
 * - Otherwise: save a guest you can split with right away. With an email,
 *   the guest links to their account when they sign up.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const uid = session?.user?.uid || null;
    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as { name?: unknown; email?: unknown };
    const name = typeof body.name === 'string' ? body.name : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ success: false, error: 'Enter a valid email address.' }, { status: 400 });
      }
      if (session?.user?.email && email === session.user.email.toLowerCase()) {
        return NextResponse.json({ success: false, error: 'That’s your own email.' }, { status: 400 });
      }
      const account = await findUserByEmail(email);
      if (account && account.id !== uid) {
        const result = await sendFriendInvite(
          { uid, name: session?.user?.name, email: session?.user?.email, image: session?.user?.image },
          email
        );
        if (!result.ok) {
          return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        }
        return NextResponse.json({
          success: true,
          kind: 'friend',
          data: result.data,
          message: result.data.status === 'accepted'
            ? result.message
            : `${account.displayName} is on Paytrol, so we sent them a friend request.`,
        });
      }
    }

    const result = await createGuestContact(uid, name, email || null);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      {
        success: true,
        kind: 'guest',
        data: result.guest,
        message: email
          ? `${result.guest.name} added. When they sign up with ${email}, their trips move to their account.`
          : `${result.guest.name} added. You can split trips with them now.`,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('People POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not add this person.' },
      { status: 500 }
    );
  }
}
