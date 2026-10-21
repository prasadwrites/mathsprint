"""Sharing a deck with another registered user by their email.

Plain Python so it can be tested without Firebase; main.py does the lookups and writes. The deck stays the owner's:
the recipient's uid goes in the deck's sharedWith list, which lets them read it and its questions (see
firestore.rules) and practice it with their own sessions. Sharing costs no generation, so it doesn't count toward the
recipient's plan or need an access code.
"""

from __future__ import annotations

from accounts import AccessDenied, clean_invite_email

MAX_SHARES = 50  # people one deck can be shared with


def clean_share_email(email: object, own_email: str) -> str:
    """The recipient's address, lowercased. Raises AccessDenied with a message for the owner."""
    try:
        return clean_invite_email(email, own_email)
    except AccessDenied as e:
        if "own email" in str(e):
            raise AccessDenied("That's your own email. Enter the email of the person you want to share with.")
        raise


def check_can_share(owner_uid: str, recipient_uid: str, shared_with: list) -> bool:
    """Whether the recipient still has to be added (False when they already have it). Raises AccessDenied."""
    if recipient_uid == owner_uid:
        raise AccessDenied("That's your own account. Enter the email of the person you want to share with.")
    if recipient_uid in shared_with:
        return False
    if len(shared_with) >= MAX_SHARES:
        raise AccessDenied(f"A deck can be shared with up to {MAX_SHARES} people.")
    return True


def can_unshare(caller_uid: str, owner_uid: str, recipient_uid: str) -> bool:
    """The owner can remove anyone; a recipient can only remove themselves."""
    return caller_uid == owner_uid or caller_uid == recipient_uid
