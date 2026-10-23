import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engagement  # noqa: E402

NOW = 1_800_000_000_000
DAY = 86_400_000


def user(uid, created=NOW - 30 * DAY, admin=False):
    return {"uid": uid, "email": f"{uid}@example.com", "displayName": uid.title(), "createdAt": created, "lastSignInAt": None, "isAdmin": admin}


def build(users, **kw):
    args = dict(account_docs={}, decks={}, sessions=[], challenges={}, attempts=[], tests={}, takers=[], public_tests={},
                public_attempts=[], posts=[], invites=[])
    args.update(kw)
    return engagement.build(users, now_ms=NOW, **args)


def test_a_quiet_account_scores_zero():
    rows = build([user("ann")])
    r = rows["ann"]
    assert r["score"] == 0
    assert r["linksCreated"] == r["completions"] == r["signups"] == 0
    assert r["completionRate"] is None


def test_challenge_plays_finishes_and_new_accounts():
    before, after = NOW - 10 * DAY, NOW - DAY
    rows = build(
        [user("ann"), user("old", created=NOW - 20 * DAY), user("new", created=after + 5_000)],
        decks={"d1": {"ownerId": "ann", "title": "Algebra"}},
        sessions=[{"id": "s1", "ownerId": "ann", "deckId": "d1", "status": "completed"}],
        challenges={"c1": {"challengerUid": "ann", "sessionId": "s1"}},
        attempts=[
            {"challengeId": "c1", "status": "completed", "claimedUid": "old", "startedAtMs": before},  # had an account
            {"challengeId": "c1", "status": "completed", "claimedUid": "new", "startedAtMs": after},  # joined after
            {"challengeId": "c1", "status": "started"},
        ],
    )
    ch = rows["ann"]["channels"]["challenge"]
    assert ch == {"links": 1, "reached": 3, "completed": 2, "signups": 1}
    deck = rows["ann"]["decks"][0]
    assert deck["title"] == "Algebra" and deck["own"] and deck["completed"] == 2 and deck["ownSessions"] == 1


def test_group_test_member_who_signs_up_later():
    rows = build(
        [user("teacher"), user("kid", created=NOW - DAY)],
        decks={"d1": {"ownerId": "teacher"}},
        tests={"t1": {"ownerUid": "teacher", "deckId": "d1"}},
        takers=[
            {"testId": "t1", "email": "KID@example.com", "status": "completed", "createdAt": NOW - 2 * DAY},
            {"testId": "t1", "email": "nobody@example.com", "status": "assigned", "createdAt": NOW - 2 * DAY},
        ],
    )
    assert rows["teacher"]["channels"]["group"] == {"links": 2, "reached": 2, "completed": 1, "signups": 1}
    assert rows["teacher"]["completionRate"] == 0.5


def test_shared_deck_counts_as_finished_once_practiced():
    rows = build(
        [user("ann"), user("bo"), user("cy")],
        decks={"d1": {"ownerId": "ann", "sharedWith": ["bo", "cy"]}},
        sessions=[
            {"id": "s1", "ownerId": "bo", "deckId": "d1", "status": "completed"},
            {"id": "s2", "ownerId": "bo", "deckId": "d1", "status": "completed"},
            {"id": "s3", "ownerId": "cy", "deckId": "d1", "status": "active"},
        ],
    )
    assert rows["ann"]["channels"]["share"] == {"links": 2, "reached": 2, "completed": 1, "signups": 0}
    assert rows["bo"]["decksPracticed"] == 1 and rows["bo"]["sessionsCompleted"] == 2
    assert rows["bo"]["decks"] == []  # practicing someone else's deck doesn't make it theirs


def test_a_new_account_counts_once_across_channels():
    rows = build(
        [user("ann"), user("new", created=NOW - DAY)],
        decks={"d1": {"ownerId": "ann"}},
        sessions=[{"id": "s1", "ownerId": "ann", "deckId": "d1", "status": "completed"}],
        challenges={"c1": {"challengerUid": "ann", "sessionId": "s1"}},
        attempts=[{"challengeId": "c1", "status": "completed", "claimedUid": "new", "startedAtMs": NOW - 2 * DAY}],
        invites=[{"inviterUid": "ann", "status": "joined", "joinedUid": "new"}],
    )
    assert rows["ann"]["signups"] == 1
    assert rows["ann"]["channels"]["invite"] == {"links": 1, "reached": 0, "completed": 0, "signups": 0}


def test_public_links_and_posts():
    rows = build(
        [user("admin", admin=True), user("p1", created=NOW - DAY), user("p2", created=NOW - DAY)],
        decks={"d1": {"ownerId": "admin"}, "q1_p2": {"ownerId": "p2", "fromPost": "q1"}},
        public_tests={"pt": {"ownerUid": "admin", "deckId": "d1"}},
        public_attempts=[{"testId": "pt", "status": "completed", "claimedUid": "p1", "startedAtMs": NOW - 2 * DAY}],
        posts=[{"id": "q1", "ownerUid": "admin", "deckId": "d1", "answers": 7, "createdAt": NOW - 3 * DAY}],
    )
    a = rows["admin"]
    assert a["channels"]["public"] == {"links": 1, "reached": 1, "completed": 1, "signups": 1}
    assert a["channels"]["post"] == {"links": 1, "reached": 7, "completed": 7, "signups": 1}
    assert rows["p2"]["decksCreated"] == 0  # a saved post deck wasn't built by them
    assert [r["uid"] for r in engagement.ranked(rows)] == ["p1", "p2"]
    assert engagement.ranked(rows, include_admin=True)[0]["uid"] == "admin"


def test_deck_count_survives_a_reset_and_deletes():
    rows = build(
        [user("ann"), user("bo")],
        account_docs={"ann": {"decksCreated": 0}, "bo": {"decksCreated": 9}},
        decks={"d1": {"ownerId": "ann"}, "d2": {"ownerId": "ann"}, "d3": {"ownerId": "ann", "source": "sample"}},
    )
    assert rows["ann"]["decksCreated"] == 2
    assert rows["bo"]["decksCreated"] == 9


def test_score_adds_up_and_ranks():
    rows = build(
        [user("ann"), user("bo")],
        account_docs={"ann": {"activeSeconds": 600, "activeDays": {"2027-01-14": 600}, "decksCreated": 2}, "bo": {"activeSeconds": 60}},
    )
    ann = rows["ann"]
    # 10 minutes x 0.2 + 1 day x 2 + 2 decks x 3
    assert ann["points"]["activeMinutes"] == 2 and ann["points"]["activeDays"] == 2 and ann["points"]["decksCreated"] == 6
    assert ann["score"] == 10
    assert [r["uid"] for r in engagement.ranked(rows)] == ["ann", "bo"]
    assert {s["field"] for s in engagement.scoring()} <= set(ann)


def test_records_for_deleted_users_are_skipped():
    rows = build(
        [user("ann")],
        challenges={"c1": {"challengerUid": "gone", "sessionId": "s1"}},
        attempts=[{"challengeId": "c1", "status": "completed", "claimedUid": "ann", "startedAtMs": NOW}],
        invites=[{"inviterUid": "gone", "status": "joined", "joinedUid": "ann"}],
    )
    assert rows["ann"]["score"] == 0


def test_top_links_rank_by_finishes_and_new_accounts():
    rows, links = engagement.build_all(
        [user("ann"), user("bo"), user("new", created=NOW - DAY), user("new2", created=NOW - DAY)],
        account_docs={}, decks={"d1": {"ownerId": "ann"}},
        sessions=[{"id": "s1", "ownerId": "ann", "deckId": "d1", "status": "completed"}],
        challenges={"c1": {"challengerUid": "ann", "sessionId": "s1", "deckTitle": "Algebra"}},
        attempts=[
            {"challengeId": "c1", "status": "completed", "claimedUid": "new", "startedAtMs": NOW - 2 * DAY},
            {"challengeId": "c1", "status": "completed", "claimedUid": "new", "startedAtMs": NOW - 2 * DAY},  # same person
            {"challengeId": "c1", "status": "started"},
        ],
        tests={"t1": {"ownerUid": "bo", "deckTitle": "Geometry", "groupName": "Period 3"}},
        takers=[{"testId": "t1", "email": f"k{i}@example.com", "status": "completed", "createdAt": NOW} for i in range(3)]
        + [{"testId": "t1", "email": "new2@example.com", "status": "assigned", "createdAt": NOW - 2 * DAY}],
        public_tests={}, public_attempts=[], posts=[], invites=[], now_ms=NOW,
    )
    top = engagement.top_links(links)
    assert [(l["kind"], l["id"]) for l in top["active"]] == [("group", "t1"), ("challenge", "c1")]
    g = top["active"][0]
    assert g["ownerName"] == "Bo" and g["label"] == "Period 3" and (g["reached"], g["completed"], g["signups"]) == (4, 3, 1)
    c = top["active"][1]
    assert c["title"] == "Algebra" and (c["reached"], c["completed"], c["signups"]) == (3, 2, 1)
    assert {l["id"] for l in top["signups"]} == {"t1", "c1"}
