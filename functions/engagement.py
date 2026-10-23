"""Admin engagement panel: how much each person uses MathSprint and how far their decks travel.

Everything here is plain Python so it can be tested without Firebase; main.py reads the collections, turns timestamps
into milliseconds and passes plain dicts in.

The ways a deck reaches other people ("channels"):
  challenge - a head-to-head link made from a finished practice session (anyone)
  group     - a group test, one link and code per member (Pro and Pro Max)
  share     - a deck shared with a registered user by email (Pro and Pro Max)
  public    - a public test link with a leaderboard (admin)
  post      - a one-question social media post (admin)
  invite    - an invite to join, not tied to a deck

For each channel: links made, people reached (who got or opened a deck), people who finished the test, and new
accounts made after playing. An invite is a link but reaches no deck, so it only adds links and sign-ups.
"""

from __future__ import annotations

import accounts

CHANNELS = ("challenge", "group", "share", "public", "post", "invite")
CHANNEL_LABELS = {
    "challenge": "Challenge links",
    "group": "Group tests",
    "share": "Shared by email",
    "public": "Public test links",
    "post": "Question posts",
    "invite": "Invites",
}

# A sign-up only counts when the account was made after the person got the link. Clocks differ a little.
SIGNUP_SLACK_MS = 60_000

# The engagement score. Each line is (field, points for each one, what it means). Shown on the admin page as is.
SCORE = (
    ("activeMinutes", 0.2, "minute actively using the site (1 point for 5 minutes)"),
    ("activeDays", 2, "day active in the last 35 days"),
    ("decksCreated", 3, "deck created"),
    ("sessionsCompleted", 1, "practice session finished"),
    ("linksCreated", 2, "link made, deck shared or friend invited"),
    ("completions", 4, "person who finished a test from their links"),
    ("signups", 10, "new account made by someone they brought in"),
)


def _channel_counts() -> dict:
    return {c: {"links": 0, "reached": 0, "completed": 0, "signups": 0} for c in CHANNELS}


def _deck_row(deck_id: str, deck: dict | None, uid: str) -> dict:
    deck = deck or {}
    return {
        "deckId": deck_id,
        "title": deck.get("title") or "Deleted deck",
        "subject": deck.get("subject") or "Math",
        "deleted": not deck,
        # A challenge can come from practicing someone else's shared deck.
        "own": deck.get("ownerId") == uid,
        "createdAt": deck.get("createdAt"),
        "ownSessions": 0,
        "links": 0,
        "reached": 0,
        "completed": 0,
        "signups": 0,
    }


def score_of(row: dict) -> dict:
    """The score and the points each part adds, rounded to whole points."""
    parts = {field: round(row.get(field, 0) * points, 1) for field, points, _ in SCORE}
    return {"score": round(sum(parts.values())), "points": parts}


def build(*args, **kwargs) -> dict[str, dict]:
    """One row per user, keyed by uid (see build_all)."""
    return build_all(*args, **kwargs)[0]


def build_all(
    users: list[dict],
    account_docs: dict[str, dict],
    decks: dict[str, dict],
    sessions: list[dict],
    challenges: dict[str, dict],
    attempts: list[dict],
    tests: dict[str, dict],
    takers: list[dict],
    public_tests: dict[str, dict],
    public_attempts: list[dict],
    posts: list[dict],
    invites: list[dict],
    now_ms: int,
) -> tuple[dict[str, dict], list[dict]]:
    """One row per user, keyed by uid, with their own usage, each channel's numbers, their decks and the score; and one
    row per quiz link (challenge, group test, public test, question post) with its plays, finishes and new accounts.

    users: {uid, email, displayName, createdAt, lastSignInAt, isAdmin}, from Firebase Auth.
    Every timestamp is in milliseconds. Records for people who are no longer users are skipped.
    """
    created = {u["uid"]: u.get("createdAt") or 0 for u in users}
    by_email = {(u.get("email") or "").lower(): u["uid"] for u in users if u.get("email")}

    def new_account_since(uid: object, since_ms: object) -> bool:
        """Whether uid is someone who signed up after getting a link at since_ms."""
        if not isinstance(uid, str) or uid not in created:
            return False
        return created[uid] + SIGNUP_SLACK_MS >= int(since_ms or 0)

    links: dict[tuple, dict] = {}

    def link(kind: str, link_id: str, owner: object, title: object, created_at: object, label: str = "") -> dict | None:
        if owner not in rows:
            return None
        key = (kind, link_id)
        if key not in links:
            links[key] = {"kind": kind, "id": link_id, "ownerUid": owner, "title": title or "Untitled deck", "label": label,
                          "createdAt": created_at, "reached": 0, "completed": 0, "signups": 0, "_new": set()}
        return links[key]

    def link_play(l: dict | None, completed: bool, new_uid: object = None, since_ms: object = None) -> None:
        if l is None:
            return
        l["reached"] += 1
        l["completed"] += int(completed)
        if new_uid != l["ownerUid"] and new_account_since(new_uid, since_ms) and new_uid not in l["_new"]:
            l["_new"].add(new_uid)
            l["signups"] += 1

    rows: dict[str, dict] = {}
    signed_up: dict[str, set] = {}
    for u in users:
        account = account_docs.get(u["uid"]) or {}
        activity = accounts.activity_summary(account, now_ms)
        rows[u["uid"]] = {
            **{k: u.get(k) for k in ("uid", "email", "displayName", "createdAt", "lastSignInAt")},
            "isAdmin": bool(u.get("isAdmin")),
            "activeSeconds": activity["activeSeconds"],
            "weekSeconds": activity["weekSeconds"],
            "todaySeconds": activity["todaySeconds"],
            "lastActiveAt": activity["lastActiveAt"],
            "activeMinutes": activity["activeSeconds"] // 60,
            "activeDays": sum(1 for v in (account.get("activeDays") or {}).values() if int(v) > 0),
            # The plan counter can be reset by the admin, and deleting decks lowers the count of decks kept, so take
            # whichever is bigger.
            "decksCreated": int(account.get("decksCreated") or 0),
            "decksKept": 0,
            "sessionsCompleted": 0,
            "decksPracticed": 0,
            "channels": _channel_counts(),
            "decks": {},
        }
        signed_up[u["uid"]] = set()

    def deck_of(uid: str, deck_id: object) -> dict | None:
        if uid not in rows or not isinstance(deck_id, str) or not deck_id:
            return None
        found = rows[uid]["decks"]
        if deck_id not in found:
            found[deck_id] = _deck_row(deck_id, decks.get(deck_id), uid)
        return found[deck_id]

    def add(uid: str, channel: str, deck_id: object = None, **counts: int) -> None:
        if uid not in rows:
            return
        ch = rows[uid]["channels"][channel]
        d = deck_of(uid, deck_id)
        for k, v in counts.items():
            ch[k] += v
            if d is not None:
                d[k] += v

    def signup(owner: str, channel: str, deck_id: object, new_uid: object, since_ms: object) -> None:
        """Counts a new account once per owner, under the first channel that brought them in."""
        if owner not in rows or new_uid == owner or not new_account_since(new_uid, since_ms):
            return
        if new_uid in signed_up[owner]:
            return
        signed_up[owner].add(new_uid)
        add(owner, channel, deck_id, signups=1)

    # Their own decks and practice.
    for deck_id, d in decks.items():
        owner = d.get("ownerId")
        if owner in rows and d.get("source") != "sample" and not d.get("fromPost"):
            rows[owner]["decksKept"] += 1
            deck_of(owner, deck_id)
    practiced: dict[str, set] = {uid: set() for uid in rows}
    finished_by: dict[tuple, int] = {}  # (uid, deckId) -> finished sessions, to tell when a shared deck was practiced
    session_deck: dict[str, str] = {}
    for s in sessions:
        session_deck[s["id"]] = s.get("deckId")
        uid = s.get("ownerId")
        if uid not in rows or s.get("status") != "completed":
            continue
        rows[uid]["sessionsCompleted"] += 1
        practiced[uid].add(s.get("deckId"))
        finished_by[(uid, s.get("deckId"))] = finished_by.get((uid, s.get("deckId")), 0) + 1
        if (decks.get(s.get("deckId")) or {}).get("ownerId") == uid:
            deck_of(uid, s.get("deckId"))["ownSessions"] += 1

    # Challenge links.
    for cid, c in challenges.items():
        add(c.get("challengerUid"), "challenge", session_deck.get(c.get("sessionId")), links=1)
    for a in attempts:
        c = challenges.get(a.get("challengeId"))
        if not c:
            continue
        owner, deck_id = c.get("challengerUid"), session_deck.get(c.get("sessionId"))
        add(owner, "challenge", deck_id, reached=1, completed=int(a.get("status") == "completed"))
        signup(owner, "challenge", deck_id, a.get("claimedUid"), a.get("startedAtMs"))
        link_play(link("challenge", a.get("challengeId"), owner, c.get("deckTitle"), c.get("createdAt")),
                  a.get("status") == "completed", a.get("claimedUid"), a.get("startedAtMs"))

    # Group tests: each member's link is one link and one person reached.
    for t in takers:
        test = tests.get(t.get("testId"))
        if not test:
            continue
        owner, deck_id = test.get("ownerUid"), test.get("deckId")
        add(owner, "group", deck_id, links=1, reached=1, completed=int(t.get("status") == "completed"))
        new_uid = by_email.get((t.get("email") or "").lower())
        signup(owner, "group", deck_id, new_uid, t.get("createdAt"))
        link_play(link("group", t.get("testId"), owner, test.get("deckTitle"), test.get("createdAt"), test.get("groupName") or ""),
                  t.get("status") == "completed", new_uid, t.get("createdAt"))

    # Decks shared by email. The people already have accounts; finishing means they finished a practice session on it.
    for deck_id, d in decks.items():
        owner = d.get("ownerId")
        for uid in d.get("sharedWith") or []:
            if uid == owner:
                continue
            add(owner, "share", deck_id, links=1, reached=1, completed=int(finished_by.get((uid, deck_id), 0) > 0))

    # Public test links.
    for tid, t in public_tests.items():
        add(t.get("ownerUid"), "public", t.get("deckId"), links=1)
    for a in public_attempts:
        t = public_tests.get(a.get("testId"))
        if not t:
            continue
        owner, deck_id = t.get("ownerUid"), t.get("deckId")
        add(owner, "public", deck_id, reached=1, completed=int(a.get("status") == "completed"))
        signup(owner, "public", deck_id, a.get("claimedUid"), a.get("startedAtMs"))
        link_play(link("public", a.get("testId"), owner, t.get("deckTitle"), t.get("createdAt")),
                  a.get("status") == "completed", a.get("claimedUid"), a.get("startedAtMs"))

    # Question posts: an answer to the posted question counts as finishing it. A visitor who saves the deck to a new
    # account is a sign-up.
    post_by_id = {p["id"]: p for p in posts}
    for p in posts:
        add(p.get("ownerUid"), "post", p.get("deckId"), links=1, reached=int(p.get("answers") or 0), completed=int(p.get("answers") or 0))
        l = link("post", p["id"], p.get("ownerUid"), p.get("deckTitle"), p.get("createdAt"))
        if l is not None:
            l["reached"] += int(p.get("answers") or 0)
            l["completed"] += int(p.get("answers") or 0)
    for d in decks.values():
        p = post_by_id.get(d.get("fromPost"))
        if p:
            signup(p.get("ownerUid"), "post", p.get("deckId"), d.get("ownerId"), p.get("createdAt"))
            l = links.get(("post", p["id"]))
            if l is not None and d.get("ownerId") != l["ownerUid"] and new_account_since(d.get("ownerId"), p.get("createdAt")) \
                    and d.get("ownerId") not in l["_new"]:
                l["_new"].add(d.get("ownerId"))
                l["signups"] += 1

    # Invites: the server already checks the friend signed up after the invite.
    for inv in invites:
        owner = inv.get("inviterUid")
        add(owner, "invite", links=1)
        if inv.get("status") == "joined":
            signup(owner, "invite", None, inv.get("joinedUid"), 0)

    for uid, r in rows.items():
        r["decksCreated"] = max(r["decksCreated"], r["decksKept"])
        r["decksPracticed"] = len(practiced[uid])
        for total, k in (("linksCreated", "links"), ("peopleReached", "reached"), ("completions", "completed"), ("signups", "signups")):
            r[total] = sum(ch[k] for ch in r["channels"].values())
        r["completionRate"] = round(r["completions"] / r["peopleReached"], 3) if r["peopleReached"] else None
        r.update(score_of(r))
        r["decks"] = sorted(r["decks"].values(), key=lambda d: (-(d["completed"] + d["reached"]), -(d["createdAt"] or 0)))
    link_rows = []
    for l in links.values():
        l.pop("_new")
        owner = rows[l["ownerUid"]]
        link_rows.append({**l, "ownerName": owner["displayName"] or owner["email"], "ownerEmail": owner["email"], "ownerIsAdmin": owner["isAdmin"]})
    return rows, link_rows


TOP_LINKS = 10


def top_links(link_rows: list[dict], n: int = TOP_LINKS) -> dict[str, list[dict]]:
    """The most active links (most finished, then most plays) and the links that brought in the most new accounts."""
    active = sorted((l for l in link_rows if l["reached"]), key=lambda l: (-l["completed"], -l["reached"], -l["signups"], -(l["createdAt"] or 0)))
    signups = sorted((l for l in link_rows if l["signups"]), key=lambda l: (-l["signups"], -l["completed"], -(l["createdAt"] or 0)))
    return {"active": active[:n], "signups": signups[:n]}


def ranked(rows: dict[str, dict], include_admin: bool = False) -> list[dict]:
    """Highest score first; ties go to more finished tests, then more time on site."""
    out = [r for r in rows.values() if include_admin or not r["isAdmin"]]
    out.sort(key=lambda r: (-r["score"], -r["completions"], -r["activeSeconds"], r["email"] or ""))
    return out


def scoring() -> list[dict]:
    return [{"field": f, "points": p, "per": per} for f, p, per in SCORE]
