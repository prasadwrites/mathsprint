"""Cloud Functions for MathSprint (Python runtime).

generate_deck         - Claude writes a deck, SymPy checks every answer, the deck is saved to Firestore.
explain_step          - Claude re-explains one solution step in the style the student picks.
get_account           - The signed-in student's plan, usage and status (creates the account on first call).
admin_list_accounts   - Admin only: every sign-in with its plan, usage, status and access code.
admin_update_account  - Admin only: change one account's plan, status or access code, or reset its deck count.
admin_delete_account  - Admin only: delete an account's sign-in, decks, practice history and settings for good.
request_upgrade       - A student asks the admin for a bigger plan, with an optional note.
list_upgrade_requests - The student's own requests and replies, or every request for the admin.
admin_reply_upgrade   - Admin only: reply to a request, and optionally move the account to the requested plan.
reply_upgrade         - A student writes back on one of their requests, which puts it back in the admin's queue.
record_activity       - One heartbeat per active minute, so the admin can see how long each person spends in the app.
create_invite         - A student invites a friend's email and gets a link to share; a friend who joins earns them a deck.
list_invites          - The student's own invites and whether each friend has joined.
list_groups, save_group, delete_group - Pro and Pro Max: contact groups of emails.
assign_test           - Pro and Pro Max: assign a deck to a group, with a link and access code for each member.
list_tests, get_test_results, reset_test_link, delete_test - the owner's assigned tests and each member's result.
open_test, submit_test - No sign-in: a group member opens their test with the link and code, and gets their own result.
delete_deck           - The owner deletes one of their decks with its questions and practice history. The plan count stays.
report_problem, list_reports, reply_report - A signed-in user reports a problem; the user and admin write back and forth.
admin_reply_report    - Admin only: answer a problem report, optionally marking it resolved.
admin_offer_promotion, admin_end_promotion - Admin only: offer a bigger plan for some months, or end it early.
respond_promotion     - The user accepts or declines an offer; an accepted plan lasts for its term, then the old plan is back.
create_challenge      - A student turns a finished practice session into a link that challenges a friend to beat their score.
open_challenge, submit_challenge - No sign-in: a friend plays the same questions, graded here, and sees both results.
claim_challenge       - A friend who signs up after playing saves their result to their new account.
list_challenges       - The challenges a student sent, with every friend's result, and the ones they played and saved.
challenge_page        - Serves /c/TOKEN with link-preview tags for Facebook and others, and /c/TOKEN/card.png, the score card.
"""

from __future__ import annotations

import logging
import os
import time
import urllib.request

from firebase_admin import auth, firestore, initialize_app
from firebase_functions import https_fn, options

import accounts
import cards
import challenges
import groups
from accounts import AccessDenied

initialize_app()
options.set_global_options(region="us-central1", max_instances=10)

DIFFICULTIES = {"Easy", "Medium", "Hard", "Mixed"}

log = logging.getLogger(__name__)


def _require_user(req: https_fn.CallableRequest) -> str:
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Sign in to create decks.")
    return req.auth.uid


def _require_admin(req: https_fn.CallableRequest) -> str:
    uid = _require_user(req)
    if not accounts.is_admin(req.auth.token):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Only the admin can manage accounts.")
    return uid


def _clean(text, limit: int) -> str:
    return str(text or "").strip()[:limit]


def _denied(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, message)


def _account_ref(db, uid: str):
    return db.collection("accounts").document(uid)


def _load_account(db, req: https_fn.CallableRequest) -> dict:
    """Reads the caller's account, creating it with the default plan the first time they show up."""
    ref = _account_ref(db, req.auth.uid)
    snap = ref.get()
    if snap.exists:
        return snap.to_dict()
    token = req.auth.token or {}
    account = accounts.new_account(token.get("email", ""), token.get("name", ""))
    ref.set({**account, "createdAt": firestore.SERVER_TIMESTAMP})
    # A brand new account: if a friend invited this email, credit them.
    _claim_invite(db, req.auth.uid, token.get("email", ""), (req.data or {}).get("invite") if isinstance(req.data, dict) else None)
    return account


def _claim_invite(db, uid: str, email: str, invite_token) -> None:
    """Gives one bonus deck to whoever invited this new sign-in's email. Only sign-ins made after the invite count."""
    email = (email or "").strip().lower()
    if not email:
        return
    invites = db.collection("invites")
    found = []
    if isinstance(invite_token, str) and 0 < len(invite_token) <= 64:
        snap = invites.document(invite_token).get()
        if snap.exists:
            found.append(snap)
    found += sorted(invites.where("email", "==", email).stream(), key=lambda s: _ms(s.get("createdAt")) or 0)
    try:
        joined_ms = auth.get_user(uid).user_metadata.creation_timestamp
    except auth.UserNotFoundError:
        return
    for snap in found:
        r = snap.to_dict()
        invited_ms = _ms(r.get("createdAt")) or 0
        if r.get("email") != email or r.get("status") != "invited" or r.get("inviterUid") == uid:
            continue
        if joined_ms and joined_ms + 60_000 < invited_ms:  # this person had signed up before the invite
            continue

        @firestore.transactional
        def run(transaction, ref=snap.reference, inviter=r["inviterUid"]) -> bool:
            if _txn_data(transaction, ref).get("status") != "invited":
                return False
            transaction.update(ref, {"status": "joined", "joinedUid": uid, "joinedAt": firestore.SERVER_TIMESTAMP})
            transaction.set(_account_ref(db, inviter), {"bonusDecks": firestore.Increment(1)}, merge=True)
            return True

        if run(db.transaction()):
            return


def _txn_data(transaction, ref) -> dict:
    snap = ref.get(transaction=transaction)
    return snap.to_dict() if snap.exists else {}


def _reserve_deck(db, req: https_fn.CallableRequest, count: int, admin: bool, code_valid: bool, given_code: object) -> None:
    """Checks the plan and access code and takes one deck from the plan atomically, so two tabs can't both use the last deck
    (or the last deck that needs no code)."""

    ref = _account_ref(db, req.auth.uid)

    @firestore.transactional
    def run(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            account = snap.to_dict()
            accounts.check_can_generate(account, count, admin)
            accounts.check_code(account, code_valid, given_code, admin)
            transaction.update(ref, {"decksCreated": firestore.Increment(1)})
        else:
            token = req.auth.token or {}
            account = accounts.new_account(token.get("email", ""), token.get("name", ""))
            accounts.check_can_generate(account, count, admin)
            transaction.set(ref, {**account, "decksCreated": 1, "createdAt": firestore.SERVER_TIMESTAMP})

    run(db.transaction())


@https_fn.on_call(secrets=["ANTHROPIC_API_KEY", "DECK_ACCESS_CODE"], timeout_sec=1800, memory=options.MemoryOption.GB_1)
def generate_deck(req: https_fn.CallableRequest) -> dict:
    # Imported here, not at the top: anthropic and SymPy are slow to load, and Firebase gives a deploy
    # only 10 seconds to load this file and list its functions.
    from generator import DeckRequest, GenerationError

    uid = _require_user(req)
    admin = accounts.is_admin(req.auth.token)
    data = req.data or {}
    db = firestore.client()
    code_doc = db.collection("accessCodes").document(uid).get()
    account_code = code_doc.get("code") if code_doc.exists else None
    code_valid = accounts.code_ok(data.get("accessCode"), account_code, os.environ.get("DECK_ACCESS_CODE"), admin)
    topic = _clean(data.get("topic"), 200)
    if not topic:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Tell me what to practice.")
    try:
        count = max(accounts.MIN_QUESTIONS, min(accounts.MAX_QUESTIONS, int(data.get("count", 10))))
    except (TypeError, ValueError):
        count = 10
    try:
        _reserve_deck(db, req, count, admin, code_valid, data.get("accessCode"))
    except AccessDenied as e:
        raise _denied(str(e))
    difficulty = data.get("difficulty") if data.get("difficulty") in DIFFICULTIES else "Medium"
    request = DeckRequest(
        topic=topic,
        count=count,
        difficulty=difficulty,
        level=_clean(data.get("level"), 80) or "High school or college",
        notes=_clean(data.get("notes"), 600),
    )

    try:
        return _build_and_save(db, uid, topic, difficulty, request)
    except Exception as e:
        # A deck that never got saved shouldn't count against the plan.
        _account_ref(db, uid).update({"decksCreated": firestore.Increment(-1)})
        if isinstance(e, GenerationError):
            message = f"{e} ({e.detail})" if admin and e.detail else str(e)
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, message)
        # Anything else would reach the app as a bare "INTERNAL"; log the cause and say something useful instead.
        log.exception("generate_deck failed for topic %r", topic)
        detail = f" ({type(e).__name__}: {e})" if admin else ""
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INTERNAL, f"The deck couldn't be built. Try again.{detail}")


def _build_and_save(db, uid: str, topic: str, difficulty: str, request) -> dict:
    from figures import diagram_doc, figure_doc
    from generator import generate_deck as _generate

    result = _generate(request)
    deck_ref = db.collection("decks").document()
    batch = db.batch()
    batch.set(deck_ref, {
        "ownerId": uid,
        "title": result.deck.title,
        "topic": topic,
        "level": request.level,
        "difficulty": difficulty,
        "topics": result.deck.topics,
        "notes": request.notes,
        "questionCount": len(result.deck.questions),
        "source": "ai",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    for i, q in enumerate(result.deck.questions):
        batch.set(deck_ref.collection("questions").document(), {
            "order": i,
            "prompt": q.prompt,
            "math": q.math,
            "type": q.type,
            "choices": q.choices,
            "answerValues": q.answer_values,
            "answerChoice": q.answer_choice,
            "answerDisplay": q.answer_display,
            "tolerance": q.tolerance,
            "concept": q.concept,
            "difficulty": q.difficulty,
            "steps": [s.model_dump() for s in q.steps],
            "check": q.check.model_dump(),
            "verified": True,
            **({"figure": figure_doc(q.figure)} if q.figure else {}),
            **({"figure": diagram_doc(q.diagram)} if q.diagram else {}),
            **({"pair": True} if q.pair else {}),
        })
    batch.commit()

    return {"deckId": deck_ref.id, "questionCount": len(result.deck.questions), "dropped": result.dropped}


@https_fn.on_call(secrets=["ANTHROPIC_API_KEY"], timeout_sec=120)
def explain_step(req: https_fn.CallableRequest) -> dict:
    from generator import GenerationError, explain_step as _explain  # slow to load; see generate_deck

    uid = _require_user(req)
    data = req.data or {}
    db = firestore.client()
    account = _account_ref(db, uid).get()
    if account.exists and account.get("status") == "suspended":
        raise _denied("Your account is suspended.")
    deck_id, question_id = _clean(data.get("deckId"), 64), _clean(data.get("questionId"), 64)
    deck = db.collection("decks").document(deck_id).get()
    if not deck.exists or deck.get("ownerId") != uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Deck not found.")
    q = deck.reference.collection("questions").document(question_id).get()
    if not q.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Question not found.")
    step = data.get("step")
    step = int(step) if isinstance(step, (int, float)) else None
    try:
        text = _explain(q.to_dict(), step, _clean(data.get("style"), 20) or "simple")
    except GenerationError as e:
        message = f"{e} ({e.detail})" if accounts.is_admin(req.auth.token) and e.detail else str(e)
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, message)
    return {"explanation": text}


@https_fn.on_call()
def get_account(req: https_fn.CallableRequest) -> dict:
    _require_user(req)
    db = firestore.client()
    account = _load_account(db, req)
    token = req.auth.token or {}
    # Keep the email and name the admin sees in step with the sign-in.
    fresh = {k: v for k, v in {"email": token.get("email"), "displayName": token.get("name")}.items() if v and account.get(k) != v}
    if fresh:
        _account_ref(db, req.auth.uid).set(fresh, merge=True)
    has_code = db.collection("accessCodes").document(req.auth.uid).get().exists
    admin = accounts.is_admin(token)
    requests = db.collection("upgradeRequests")
    reports = db.collection("reports")
    if admin:
        upgrade = {"waiting": _count(requests.where("status", "==", "pending"))}
        report_counts = {"open": _count(reports.where("status", "==", "open"))}
    else:
        mine = [d.to_dict() for d in requests.where("uid", "==", req.auth.uid).stream()]
        upgrade = {
            "pendingPlan": next((r["requestedPlan"] for r in mine if _awaiting_plan(r)), None),
            "unreadReplies": sum(1 for r in mine if r.get("status") == "replied" and not r.get("userRead")),
        }
        report_counts = {"unread": sum(1 for r in reports.where("uid", "==", req.auth.uid).stream() if not r.to_dict().get("userRead", True))}
    offer = next(iter(_open_offers(db, req.auth.uid)), None)
    return {
        **accounts.summary(account, admin),
        "hasOwnCode": has_code,
        "upgrade": upgrade,
        "reports": report_counts,
        "offer": _offer_row(offer) if offer and not admin else None,
    }


def _awaiting_plan(r: dict) -> bool:
    """A request still waiting on a plan decision (not a follow-up message on one already approved)."""
    return r.get("status") == "pending" and not r.get("approved")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _thread(r: dict) -> list[dict]:
    """The messages on a request, oldest first. Requests made before threads existed keep their note and reply."""
    if "thread" in r:
        return list(r["thread"])
    out = []
    if r.get("message"):
        out.append({"from": "student", "text": r["message"], "at": _ms(r.get("createdAt"))})
    if r.get("status") == "replied" and (r.get("reply") or r.get("approved")):
        out.append({"from": "admin", "text": r.get("reply", ""), "at": _ms(r.get("repliedAt")), "approved": bool(r.get("approved"))})
    return out


def _count(query) -> int:
    return int(query.count().get()[0][0].value)


def _ms(dt) -> int | None:
    return int(dt.timestamp() * 1000) if dt else None


@https_fn.on_call()
def admin_list_accounts(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)
    db = firestore.client()
    stored = {d.id: d.to_dict() for d in db.collection("accounts").stream()}
    codes = {d.id: d.to_dict().get("code") for d in db.collection("accessCodes").stream()}
    offers = {d.get("uid"): _offer_row(d) for d in db.collection("promotions").where("status", "==", "offered").stream()}
    rows = []
    now = _now_ms()
    # Firebase Auth is the full list of sign-ins, including people who never opened the app after signing up.
    for user in auth.list_users().iterate_all():
        account = stored.get(user.uid) or accounts.new_account(user.email or "", user.display_name or "")
        token = {"email": user.email or "", "email_verified": user.email_verified}
        meta = user.user_metadata
        rows.append({
            "uid": user.uid,
            "email": user.email or account.get("email", ""),
            "displayName": user.display_name or account.get("displayName", ""),
            "accessCode": codes.get(user.uid),
            "createdAt": meta.creation_timestamp if meta else None,
            "lastSignInAt": meta.last_sign_in_timestamp if meta else None,
            "invitesJoined": accounts.bonus_decks(account),
            "offer": offers.get(user.uid),
            **accounts.activity_summary(account, now),
            **accounts.summary(account, accounts.is_admin(token)),
        })
    rows.sort(key=lambda r: (not r["isAdmin"], -(r["createdAt"] or 0)))
    return {"accounts": rows, "plans": {k: vars(p) for k, p in accounts.PLANS.items()}}


@https_fn.on_call()
def admin_update_account(req: https_fn.CallableRequest) -> dict:
    admin_uid = _require_admin(req)
    data = req.data or {}
    uid = _clean(data.get("uid"), 128)
    if not uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Pick an account.")
    try:
        user = auth.get_user(uid)
    except auth.UserNotFoundError:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "That account doesn't exist.")
    try:
        changes = accounts.clean_update(data)
    except ValueError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(e))
    if changes.get("status") == "suspended" and uid == admin_uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "You can't suspend your own account.")

    db = firestore.client()
    ref = _account_ref(db, uid)
    if not ref.get().exists:
        ref.set({**accounts.new_account(user.email or "", user.display_name or ""), "createdAt": firestore.SERVER_TIMESTAMP})
    if changes:
        ref.update({**changes, "updatedAt": firestore.SERVER_TIMESTAMP})
    if "status" in changes:
        # Disabling the sign-in stops new sessions; revoking ends the ones already open within the hour.
        suspended = changes["status"] == "suspended"
        auth.update_user(uid, disabled=suspended)
        if suspended:
            auth.revoke_refresh_tokens(uid)

    code_ref = db.collection("accessCodes").document(uid)
    if "accessCode" in data:
        code = data["accessCode"]
        if code is None or str(code).strip() == "":
            code_ref.delete()
        else:
            code = accounts.new_code() if code == "generate" else _clean(code, 64)
            if len(code) < 6:
                raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Use a code of at least 6 characters.")
            code_ref.set({"code": code, "updatedAt": firestore.SERVER_TIMESTAMP})
    return {"ok": True}


@https_fn.on_call(timeout_sec=300)
def admin_delete_account(req: https_fn.CallableRequest) -> dict:
    admin_uid = _require_admin(req)
    uid = _clean((req.data or {}).get("uid"), 128)
    if not uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Pick an account.")
    if uid == admin_uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "You can't delete your own account.")
    try:
        user = auth.get_user(uid)
        if accounts.is_admin({"email": user.email, "email_verified": user.email_verified}):
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "The admin account can't be deleted.")
    except auth.UserNotFoundError:
        user = None  # Sign-in already gone; still clean up whatever data is left.

    db = firestore.client()
    # Remove the sign-in first so the person can't keep writing while their data is deleted.
    if user is not None:
        auth.delete_user(uid)
    decks = list(db.collection("decks").where("ownerId", "==", uid).stream())
    for deck in decks:
        db.recursive_delete(deck.reference)  # the deck and its questions
    sessions = list(db.collection("sessions").where("ownerId", "==", uid).stream())
    writer = db.bulk_writer()
    for s in sessions:
        writer.delete(s.reference)
    for r in db.collection("upgradeRequests").where("uid", "==", uid).stream():
        writer.delete(r.reference)
    for r in db.collection("invites").where("inviterUid", "==", uid).stream():
        writer.delete(r.reference)
    for collection in ("reports", "promotions"):
        for r in db.collection(collection).where("uid", "==", uid).stream():
            writer.delete(r.reference)
    for collection in ("groups", "testTakers"):
        for r in db.collection(collection).where("ownerUid", "==", uid).stream():
            writer.delete(r.reference)
    for t in db.collection("tests").where("ownerUid", "==", uid).stream():
        db.recursive_delete(t.reference)  # the test and its copy of the questions
    for c in db.collection("challenges").where("challengerUid", "==", uid).stream():
        db.recursive_delete(c.reference)  # the challenge and its copy of the questions
    for field in ("challengerUid", "claimedUid"):
        for r in db.collection("challengeAttempts").where(field, "==", uid).stream():
            writer.delete(r.reference)
    for ref in (_account_ref(db, uid), db.collection("accessCodes").document(uid), db.collection("users").document(uid)):
        writer.delete(ref)
    writer.close()
    return {"ok": True, "decks": len(decks), "sessions": len(sessions)}


def _request_row(doc) -> dict:
    r = doc.to_dict()
    return {
        "id": doc.id,
        "uid": r.get("uid"),
        "email": r.get("email", ""),
        "displayName": r.get("displayName", ""),
        "currentPlan": r.get("currentPlan"),
        "requestedPlan": r.get("requestedPlan"),
        "message": r.get("message", ""),
        "status": r.get("status"),
        "reply": r.get("reply", ""),
        "thread": _thread(r),
        "updatedAt": _ms(r.get("updatedAt")) or _ms(r.get("repliedAt")) or _ms(r.get("createdAt")),
        "approved": bool(r.get("approved")),
        "userRead": bool(r.get("userRead")),
        "createdAt": _ms(r.get("createdAt")),
        "repliedAt": _ms(r.get("repliedAt")),
    }


@https_fn.on_call()
def request_upgrade(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    db = firestore.client()
    account = _load_account(db, req)
    if account.get("status") == "suspended":
        raise _denied("Your account is suspended.")
    requests = db.collection("upgradeRequests")
    has_pending = any(_awaiting_plan(d.to_dict()) for d in requests.where("uid", "==", uid).where("status", "==", "pending").stream())
    plan = data.get("plan")
    try:
        accounts.check_upgrade_request(account.get("plan", accounts.DEFAULT_PLAN), plan, has_pending, accounts.is_admin(req.auth.token))
    except AccessDenied as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
    token = req.auth.token or {}
    ref = requests.document()
    message = _clean(data.get("message"), accounts.MAX_MESSAGE)
    ref.set({
        "uid": uid,
        "email": token.get("email") or account.get("email", ""),
        "displayName": token.get("name") or account.get("displayName", ""),
        "currentPlan": account.get("plan", accounts.DEFAULT_PLAN),
        "requestedPlan": plan,
        "message": message,
        "thread": [{"from": "student", "text": message, "at": _now_ms()}] if message else [],
        "status": "pending",
        "userRead": False,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"id": ref.id}


@https_fn.on_call()
def list_upgrade_requests(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    db = firestore.client()
    requests = db.collection("upgradeRequests")
    if accounts.is_admin(req.auth.token):
        docs = list(requests.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(200).stream())
    else:
        docs = list(requests.where("uid", "==", uid).stream())
        # Opening the list is how a student reads the admin's replies.
        if (req.data or {}).get("markRead"):
            for d in docs:
                if d.get("status") == "replied" and not d.to_dict().get("userRead"):
                    d.reference.update({"userRead": True})
    rows = sorted((_request_row(d) for d in docs), key=lambda r: -(r["updatedAt"] or 0))
    return {"requests": rows}


@https_fn.on_call()
def admin_reply_upgrade(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)
    data = req.data or {}
    request_id = _clean(data.get("id"), 128)
    reply = _clean(data.get("reply"), accounts.MAX_MESSAGE)
    approve = bool(data.get("approve"))
    if not request_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Pick a request.")
    if not reply and not approve:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Write a reply first.")
    db = firestore.client()
    ref = db.collection("upgradeRequests").document(request_id)
    snap = ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "That request no longer exists.")
    r = snap.to_dict()
    approve = approve and not r.get("approved")
    if approve:
        account_ref = _account_ref(db, r["uid"])
        if not account_ref.get().exists:
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "That account no longer exists.")
        account_ref.update({"plan": r["requestedPlan"], "updatedAt": firestore.SERVER_TIMESTAMP})
    message = {"from": "admin", "text": reply, "at": _now_ms()}
    if approve:
        message["approved"] = True
    ref.update({
        "status": "replied",
        "reply": reply,
        "approved": approve or bool(r.get("approved")),
        "thread": _thread(r) + [message],
        "userRead": False,
        "repliedAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}


@https_fn.on_call()
def admin_delete_upgrade(req: https_fn.CallableRequest) -> dict:
    """Deletes a whole upgrade request, or with `index` and `at` just that one message. The student loses it too.
    A plan already approved stays as it is."""
    _require_admin(req)
    data = req.data or {}
    request_id = _clean(data.get("id"), 128)
    if not request_id:
        raise _invalid("Pick a request.")
    db = firestore.client()
    ref = db.collection("upgradeRequests").document(request_id)
    if "index" not in data:
        if not ref.get().exists:
            raise _not_found("That request no longer exists.")
        ref.delete()
        return {"ok": True}

    @firestore.transactional
    def run(transaction) -> None:
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            raise _not_found("That request no longer exists.")
        thread = _thread(snap.to_dict())
        i = data.get("index")
        # The time stamp guards against a message that moved because another one arrived or went.
        if not isinstance(i, int) or not 0 <= i < len(thread) or thread[i].get("at") != data.get("at"):
            raise _not_found("That message has changed. Reload the page and try again.")
        transaction.update(ref, {"thread": thread[:i] + thread[i + 1:], "updatedAt": firestore.SERVER_TIMESTAMP})

    run(db.transaction())
    return {"ok": True}


@https_fn.on_call()
def reply_upgrade(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    request_id = _clean(data.get("id"), 128)
    text = _clean(data.get("text"), accounts.MAX_MESSAGE)
    if not request_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Pick a request.")
    if not text:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Write a message first.")
    db = firestore.client()
    if _load_account(db, req).get("status") == "suspended":
        raise _denied("Your account is suspended.")
    ref = db.collection("upgradeRequests").document(request_id)
    snap = ref.get()
    # Someone else's request looks the same as a missing one.
    if not snap.exists or snap.to_dict().get("uid") != uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "That request no longer exists.")
    r = snap.to_dict()
    ref.update({
        "status": "pending",  # back in the admin's queue
        "thread": _thread(r) + [{"from": "student", "text": text, "at": _now_ms()}],
        "userRead": True,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}


@https_fn.on_call()
def record_activity(req: https_fn.CallableRequest) -> dict:
    _require_user(req)
    db = firestore.client()
    _load_account(db, req)  # creates the account on someone's first visit
    ref = _account_ref(db, req.auth.uid)

    @firestore.transactional
    def run(transaction) -> bool:
        snap = ref.get(transaction=transaction)
        account = snap.to_dict() or {}
        if account.get("status") == "suspended":
            return False
        changes = accounts.credit_activity(account, _now_ms())
        if changes:
            transaction.update(ref, changes)
        return bool(changes)

    return {"counted": run(db.transaction())}


def _invite_row(doc) -> dict:
    r = doc.to_dict()
    return {"token": doc.id, "email": r.get("email", ""), "status": r.get("status"), "createdAt": _ms(r.get("createdAt")), "joinedAt": _ms(r.get("joinedAt"))}


@https_fn.on_call()
def create_invite(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    db = firestore.client()
    account = _load_account(db, req)
    if account.get("status") == "suspended":
        raise _denied("Your account is suspended.")
    token = req.auth.token or {}
    try:
        email = accounts.clean_invite_email((req.data or {}).get("email"), token.get("email", ""))
    except AccessDenied as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, str(e))
    invites = db.collection("invites")
    mine = list(invites.where("inviterUid", "==", uid).stream())
    same = next((d for d in mine if d.get("email") == email), None)
    if same:
        return _invite_row(same)  # inviting the same friend again reuses their link
    try:
        auth.get_user_by_email(email)
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.ALREADY_EXISTS, "That person already has a MathSprint account.")
    except auth.UserNotFoundError:
        pass
    if len(mine) >= accounts.MAX_INVITES:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED, f"You can have up to {accounts.MAX_INVITES} invites.")
    ref = invites.document(accounts.new_invite_token())
    ref.set({
        "inviterUid": uid,
        "inviterName": token.get("name") or account.get("displayName", ""),
        "email": email,
        "status": "invited",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return _invite_row(ref.get())


@https_fn.on_call()
def list_invites(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    db = firestore.client()
    rows = [_invite_row(d) for d in db.collection("invites").where("inviterUid", "==", uid).stream()]
    rows.sort(key=lambda r: -(r["createdAt"] or 0))
    return {"invites": rows}


# Groups and group tests (Pro and Pro Max). A teacher keeps groups of emails, assigns a deck to a group, and each
# member gets their own link and access code. Students take the test without signing in; answers are graded here.


def _group_owner(db, req: https_fn.CallableRequest) -> tuple[str, dict]:
    """The caller's uid and account, if their plan includes groups."""
    uid = _require_user(req)
    account = _load_account(db, req)
    try:
        groups.check_can_use_groups(account, accounts.is_admin(req.auth.token))
    except AccessDenied as e:
        raise _denied(str(e))
    return uid, account


def _not_found(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, message)


def _invalid(message: str) -> https_fn.HttpsError:
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message)


def _owned(db, collection: str, doc_id: object, uid: str, missing: str):
    """A document the caller owns. Someone else's looks the same as a missing one."""
    doc_id = _clean(doc_id, 128)
    snap = db.collection(collection).document(doc_id).get() if doc_id else None
    if snap is None or not snap.exists or snap.to_dict().get("ownerUid", snap.to_dict().get("ownerId")) != uid:
        raise _not_found(missing)
    return snap


def _group_row(doc) -> dict:
    r = doc.to_dict()
    return {"id": doc.id, "name": r.get("name", ""), "emails": list(r.get("emails") or []), "updatedAt": _ms(r.get("updatedAt"))}


@https_fn.on_call()
def list_groups(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    rows = [_group_row(d) for d in db.collection("groups").where("ownerUid", "==", uid).stream()]
    rows.sort(key=lambda r: r["name"].lower())
    return {"groups": rows}


@https_fn.on_call()
def save_group(req: https_fn.CallableRequest) -> dict:
    """Creates a group, or replaces an existing group's name and emails."""
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    data = req.data or {}
    try:
        name, emails = groups.clean_group(data.get("name"), data.get("emails"))
    except AccessDenied as e:
        raise _invalid(str(e))
    if data.get("id"):
        ref = _owned(db, "groups", data["id"], uid, "That group no longer exists.").reference
        ref.update({"name": name, "emails": emails, "updatedAt": firestore.SERVER_TIMESTAMP})
    else:
        if _count(db.collection("groups").where("ownerUid", "==", uid)) >= groups.MAX_GROUPS:
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED, f"You can have up to {groups.MAX_GROUPS} groups.")
        ref = db.collection("groups").document()
        ref.set({"ownerUid": uid, "name": name, "emails": emails, "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP})
    return _group_row(ref.get())


@https_fn.on_call()
def delete_group(req: https_fn.CallableRequest) -> dict:
    """Tests already assigned to the group keep working; their links don't depend on the group."""
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    _owned(db, "groups", (req.data or {}).get("id"), uid, "That group no longer exists.").reference.delete()
    return {"ok": True}


def _new_taker(db, writer, test_id: str, uid: str, email: str) -> None:
    writer.set(db.collection("testTakers").document(groups.new_test_token()), {
        "testId": test_id,
        "ownerUid": uid,
        "email": email,
        "code": groups.new_test_code(),
        "status": "assigned",
        "wrongTries": 0,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })


@https_fn.on_call(timeout_sec=120)
def assign_test(req: https_fn.CallableRequest) -> dict:
    """Assigns a deck to a group. Assigning the same deck to the same group again adds links for emails added since."""
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    data = req.data or {}
    deck = _owned(db, "decks", data.get("deckId"), uid, "That deck no longer exists.")
    group = _owned(db, "groups", data.get("groupId"), uid, "That group no longer exists.")
    emails = list(group.get("emails") or [])
    if not emails:
        raise _invalid("Add some emails to the group first.")
    try:
        limit = max(0, min(6 * 3600, int(data.get("timeLimitSec") or 0)))
    except (TypeError, ValueError):
        limit = 0

    tests = db.collection("tests")
    existing = next((t for t in tests.where("ownerUid", "==", uid).stream()
                     if t.get("deckId") == deck.id and t.get("groupId") == group.id), None)
    writer = db.bulk_writer()
    if existing:
        have = {t.get("email") for t in db.collection("testTakers").where("testId", "==", existing.id).stream()}
        added = [e for e in emails if e not in have]
        for e in added:
            _new_taker(db, writer, existing.id, uid, e)
        writer.close()
        existing.reference.update({"groupName": group.get("name")})
        return {"id": existing.id, "added": len(added)}

    questions = sorted((q.to_dict() for q in deck.reference.collection("questions").stream()), key=lambda q: q.get("order", 0))
    if not questions:
        raise _invalid("That deck has no questions.")
    ref = tests.document()
    for i, q in enumerate(questions):
        q = {k: v for k, v in q.items() if k != "check"}  # the SymPy check isn't needed to grade
        writer.set(ref.collection("questions").document(f"{i:04d}"), {**q, "order": i})
    for e in emails:
        _new_taker(db, writer, ref.id, uid, e)
    writer.close()
    # Written last, so a test only shows up once its questions and links exist.
    ref.set({
        "ownerUid": uid,
        "ownerName": (req.auth.token or {}).get("name") or (req.auth.token or {}).get("email", ""),
        "deckId": deck.id,
        "deckTitle": deck.get("title"),
        "groupId": group.id,
        "groupName": group.get("name"),
        "questionCount": len(questions),
        "timeLimitSec": limit,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return {"id": ref.id, "added": len(emails)}


def _test_row(db, doc) -> dict:
    r = doc.to_dict()
    takers = db.collection("testTakers").where("testId", "==", doc.id)
    return {
        "id": doc.id,
        "deckId": r.get("deckId"),
        "deckTitle": r.get("deckTitle", ""),
        "groupId": r.get("groupId"),
        "groupName": r.get("groupName", ""),
        "questionCount": r.get("questionCount", 0),
        "timeLimitSec": r.get("timeLimitSec", 0),
        "createdAt": _ms(r.get("createdAt")),
        "assigned": _count(takers),
        "completed": _count(takers.where("status", "==", "completed")),
    }


@https_fn.on_call()
def list_tests(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    deck_id = (req.data or {}).get("deckId")
    docs = [d for d in db.collection("tests").where("ownerUid", "==", uid).stream() if not deck_id or d.get("deckId") == deck_id]
    rows = sorted((_test_row(db, d) for d in docs), key=lambda r: -(r["createdAt"] or 0))
    return {"tests": rows}


def _test_questions(test_ref) -> list[dict]:
    return sorted((q.to_dict() for q in test_ref.collection("questions").stream()), key=lambda q: q.get("order", 0))


def _taker_row(doc) -> dict:
    r = doc.to_dict()
    return {
        "token": doc.id,
        "email": r.get("email", ""),
        "code": r.get("code", ""),
        "status": r.get("status", "assigned"),
        "score": r.get("score"),
        "usedSec": r.get("usedSec"),
        "late": bool(r.get("late")),
        "locked": int(r.get("wrongTries", 0)) >= groups.MAX_LOCKOUT_TRIES,
        "startedAt": r.get("startedAtMs"),
        "completedAt": _ms(r.get("completedAt")),
        "answers": r.get("answers") or {},
        "results": r.get("results") or {},
        # Per-question detail; tests finished before this was recorded have none.
        "times": r.get("times"),
        "visits": r.get("visits"),
        "changes": r.get("changes"),
    }


@https_fn.on_call()
def get_test_results(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    test = _owned(db, "tests", (req.data or {}).get("id"), uid, "That test no longer exists.")
    questions = _test_questions(test.reference)
    takers = [_taker_row(d) for d in db.collection("testTakers").where("testId", "==", test.id).stream()]
    takers.sort(key=lambda t: t["email"])
    return {
        "test": _test_row(db, test),
        "questions": [{k: q.get(k) for k in ("prompt", "math", "type", "answerDisplay", "concept", "figure")} for q in questions],
        "takers": takers,
        "overall": groups.overall(takers, len(questions)),
    }


@https_fn.on_call()
def reset_test_link(req: https_fn.CallableRequest) -> dict:
    """Gives one member a new access code and clears their wrong tries, for a code that leaked or got locked."""
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    taker = _owned(db, "testTakers", (req.data or {}).get("token"), uid, "That link no longer exists.")
    taker.reference.update({"code": groups.new_test_code(), "wrongTries": 0})
    return _taker_row(taker.reference.get())


@https_fn.on_call(timeout_sec=120)
def delete_test(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    uid, _ = _group_owner(db, req)
    test = _owned(db, "tests", (req.data or {}).get("id"), uid, "That test no longer exists.")
    writer = db.bulk_writer()
    for t in db.collection("testTakers").where("testId", "==", test.id).stream():
        writer.delete(t.reference)
    writer.close()
    db.recursive_delete(test.reference)
    return {"ok": True}


# The student's side. No sign-in: the link's token and the access code are the key.


def _taker(db, token: object):
    token = _clean(token, 64)
    snap = db.collection("testTakers").document(token).get() if token else None
    if snap is None or not snap.exists:
        raise _not_found("This test link doesn't work. Ask the person who sent it for a new one.")
    test = db.collection("tests").document(snap.get("testId")).get()
    if not test.exists:
        raise _not_found("This test has been removed.")
    return snap, test


def _check_test_code(snap, given) -> None:
    r = snap.to_dict()
    if int(r.get("wrongTries", 0)) >= groups.MAX_LOCKOUT_TRIES:
        raise _denied("Too many wrong codes. Ask the person who sent the link for a new code.")
    if not groups.code_matches(given, r.get("code", "")):
        snap.reference.update({"wrongTries": firestore.Increment(1)})
        raise _denied("That access code isn't right.")


def _test_meta(test, taker: dict) -> dict:
    t = test.to_dict()
    return {
        "title": t.get("deckTitle", ""),
        "from": t.get("ownerName", ""),
        "groupName": t.get("groupName", ""),
        "email": taker.get("email", ""),
        "questionCount": t.get("questionCount", 0),
        "timeLimitSec": t.get("timeLimitSec", 0),
        "status": taker.get("status", "assigned"),
    }


def _own_result(questions: list[dict], taker: dict) -> dict:
    """Only this student's own answers and score."""
    answers, results = taker.get("answers") or {}, taker.get("results") or {}
    times = taker.get("times") or []
    return {
        "score": taker.get("score", 0),
        "total": len(questions),
        "usedSec": taker.get("usedSec", 0),
        "questions": [{
            "prompt": q.get("prompt", ""),
            "math": q.get("math", ""),
            "figure": q.get("figure"),
            "answer": answers.get(str(i), ""),
            "correct": bool(results.get(str(i))),
            "answerDisplay": q.get("answerDisplay", ""),
            "steps": q.get("steps") or [],
            "sec": times[i] if i < len(times) else None,
        } for i, q in enumerate(questions)],
    }


@https_fn.on_call()
def open_test(req: https_fn.CallableRequest) -> dict:
    """Without a code: what the test is. With the right code: starts the clock and returns the questions (no answers),
    or the student's result if they already finished."""
    db = firestore.client()
    data = req.data or {}
    snap, test = _taker(db, data.get("token"))
    taker = snap.to_dict()
    if "code" not in data:
        return _test_meta(test, taker)
    _check_test_code(snap, data.get("code"))
    questions = _test_questions(test.reference)
    now = _now_ms()
    if taker.get("status") == "assigned":
        snap.reference.update({"status": "started", "startedAtMs": now, "wrongTries": 0})
        taker = {**taker, "status": "started", "startedAtMs": now}
    meta = _test_meta(test, taker)
    if taker.get("status") == "completed":
        return {**meta, "result": _own_result(questions, taker)}
    limit = int(meta["timeLimitSec"] or 0)
    elapsed = (now - int(taker.get("startedAtMs") or now)) / 1000
    return {
        **meta,
        "elapsedSec": elapsed,
        "remainingSec": max(0, limit - elapsed) if limit else None,
        "questions": [{
            "prompt": q.get("prompt", ""),
            "math": q.get("math", ""),
            "figure": q.get("figure"),
            "type": q.get("type", "numeric"),
            "choices": q.get("choices") or [],
            "answerCount": len(q.get("answerValues") or []) or 1,
            "pair": bool(q.get("pair")),
        } for q in questions],
    }


@https_fn.on_call()
def submit_test(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    data = req.data or {}
    snap, test = _taker(db, data.get("token"))
    _check_test_code(snap, data.get("code"))
    questions = _test_questions(test.reference)
    ref = snap.reference

    @firestore.transactional
    def run(transaction) -> dict:
        taker = _txn_data(transaction, ref)
        if taker.get("status") == "completed":
            return taker  # a second tab or a retry: keep the first submission
        if taker.get("status") != "started":
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "Open the test before sending answers.")
        now = _now_ms()
        limit = int(test.get("timeLimitSec") or 0)
        used = (now - int(taker.get("startedAtMs") or now)) / 1000
        answers = groups.clean_answers(data.get("answers"), len(questions))
        graded = groups.grade(questions, answers)
        changes = {
            "status": "completed",
            "answers": answers,
            "results": graded["results"],
            "score": graded["score"],
            "usedSec": round(min(used, limit) if limit else used),
            "late": bool(limit) and used * 1000 > limit * 1000 + groups.LATE_GRACE_MS,
            "completedAt": firestore.SERVER_TIMESTAMP,
        }
        if isinstance(data.get("times"), list):  # a page loaded before timing was added sends none
            changes["times"] = groups.clean_times(data.get("times"), len(questions), used)
            changes["visits"] = groups.clean_counts(data.get("visits"), len(questions))
            changes["changes"] = groups.clean_counts(data.get("changes"), len(questions))
        transaction.update(ref, changes)
        return {**taker, **changes}

    taker = run(db.transaction())
    return {**_test_meta(test, taker), "result": _own_result(questions, taker)}


# Head-to-head challenges. The challenger is signed in; the friend who plays doesn't need to be.


def _challenge_row(doc) -> dict:
    r = doc.to_dict()
    return {
        "token": doc.id,
        "sessionId": r.get("sessionId"),
        "deckTitle": r.get("deckTitle", ""),
        "from": r.get("challengerName", ""),
        "score": r.get("score", 0),
        "total": r.get("total", 0),
        "usedSec": r.get("usedSec", 0),
        "timeLimitSec": r.get("timeLimitSec", 0),
        "brag": challenges.brag(r.get("challengerName", ""), r.get("score", 0), r.get("total", 0), r.get("usedSec", 0), r.get("deckTitle", "")),
        "createdAt": _ms(r.get("createdAt")),
    }


@https_fn.on_call(timeout_sec=60)
def create_challenge(req: https_fn.CallableRequest) -> dict:
    """Makes a challenge link from one of the caller's finished sessions, or returns the one already made for it.
    The session's answers are graded again here, since the browser wrote the session's score."""
    uid = _require_user(req)
    db = firestore.client()
    if _load_account(db, req).get("status") == "suspended":
        raise _denied("Your account is suspended.")
    session = _owned_by(db, "sessions", (req.data or {}).get("sessionId"), uid, "ownerId", "That practice session no longer exists.")
    s = session.to_dict()
    if s.get("status") != "completed":
        raise _invalid("Finish the session first.")
    existing = next(iter(db.collection("challenges").where("sessionId", "==", session.id).limit(1).stream()), None)
    if existing is not None:
        return _challenge_row(existing)

    deck = db.collection("decks").document(str(s.get("deckId") or "")).get()
    if not deck.exists:
        raise _not_found("That deck no longer exists.")
    by_id = {q.id: q.to_dict() for q in deck.reference.collection("questions").stream()}
    questions = [by_id[i] for i in (s.get("questionIds") or []) if i in by_id]
    if not questions:
        raise _invalid("That session has no questions.")
    graded = groups.grade(questions, groups.clean_answers(s.get("answers"), len(questions)))
    limit = max(0, int(s.get("timeLimitSec") or 0))
    who = req.auth.token or {}
    name = challenges.clean_name((who.get("name") or "").split(" ")[0] or (who.get("email") or "").split("@")[0])

    ref = db.collection("challenges").document(challenges.new_token())
    writer = db.bulk_writer()
    for i, q in enumerate(questions):
        q = {k: v for k, v in q.items() if k != "check"}
        writer.set(ref.collection("questions").document(f"{i:04d}"), {**q, "order": i})
    writer.close()
    ref.set({  # written last, so a link only works once its questions exist
        "challengerUid": uid,
        "challengerName": name,
        "sessionId": session.id,
        "deckTitle": s.get("deckTitle") or deck.get("title") or "",
        "total": len(questions),
        "score": graded["score"],
        "results": graded["results"],
        "usedSec": challenges.challenger_time(s.get("usedSec"), limit),
        "timeLimitSec": limit,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return _challenge_row(ref.get())


def _owned_by(db, collection: str, doc_id: object, uid: str, field: str, missing: str):
    doc_id = _clean(doc_id, 128)
    snap = db.collection(collection).document(doc_id).get() if doc_id else None
    if snap is None or not snap.exists or snap.get(field) != uid:
        raise _not_found(missing)
    return snap


def _challenge(db, token: object):
    token = _clean(token, 64)
    snap = db.collection("challenges").document(token).get() if token else None
    if snap is None or not snap.exists:
        raise _not_found("This challenge link doesn't work. Ask your friend for a new one.")
    return snap


def _attempt(db, challenge, attempt_token: object):
    attempt_token = _clean(attempt_token, 64)
    snap = db.collection("challengeAttempts").document(attempt_token).get() if attempt_token else None
    if snap is None or not snap.exists or snap.get("challengeId") != challenge.id:
        return None
    return snap


def _face_off(challenge, questions: list[dict], attempt: dict) -> dict:
    """Both results side by side, with the friend's own answers and the worked solutions."""
    c = challenge.to_dict()
    mine, theirs = attempt.get("results") or {}, c.get("results") or {}
    answers, times = attempt.get("answers") or {}, attempt.get("times") or []
    return {
        "outcome": challenges.outcome(attempt, c),
        "name": attempt.get("name", ""),
        "score": attempt.get("score", 0),
        "usedSec": attempt.get("usedSec", 0),
        "claimed": bool(attempt.get("claimedUid")),
        "share": attempt.get("shareId"),  # a public id for this result's card; the attempt token stays private
        "questions": [{
            "prompt": q.get("prompt", ""),
            "math": q.get("math", ""),
            "figure": q.get("figure"),
            "answer": answers.get(str(i), ""),
            "correct": bool(mine.get(str(i))),
            "theirsCorrect": bool(theirs.get(str(i))),
            "answerDisplay": q.get("answerDisplay", ""),
            "steps": q.get("steps") or [],
            "sec": times[i] if i < len(times) else None,
        } for i, q in enumerate(questions)],
    }


def _challenge_meta(challenge) -> dict:
    c = challenge.to_dict()
    return {
        "title": c.get("deckTitle", ""),
        "from": c.get("challengerName", ""),
        "score": c.get("score", 0),
        "total": c.get("total", 0),
        "usedSec": c.get("usedSec", 0),
        "timeLimitSec": c.get("timeLimitSec", 0),
    }


@https_fn.on_call()
def open_challenge(req: https_fn.CallableRequest) -> dict:
    """With just the link: who sent it and the score to beat. With start: begins a new attempt under the friend's name.
    With an attempt token: carries on that attempt, or shows its result if it's finished."""
    db = firestore.client()
    data = req.data or {}
    challenge = _challenge(db, data.get("token"))
    meta = _challenge_meta(challenge)
    attempt = _attempt(db, challenge, data.get("attempt"))
    if attempt is None and not data.get("start"):
        return meta
    questions = _test_questions(challenge.reference)
    now = _now_ms()
    if attempt is None:
        attempts = db.collection("challengeAttempts").where("challengeId", "==", challenge.id)
        if _count(attempts) >= challenges.MAX_ATTEMPTS:
            raise _denied("This challenge has been played as many times as it can. Ask your friend for a new one.")
        ref = db.collection("challengeAttempts").document(challenges.new_token())
        a = {
            "challengeId": challenge.id,
            "challengerUid": challenge.get("challengerUid"),
            "name": challenges.clean_name(data.get("name")),
            "status": "started",
            "startedAtMs": now,
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
        ref.set(a)
        attempt_id = ref.id
    else:
        a, attempt_id = attempt.to_dict(), attempt.id
    if a.get("status") == "completed":
        return {**meta, "attempt": attempt_id, "result": _face_off(challenge, questions, a)}
    limit = int(meta["timeLimitSec"] or 0)
    elapsed = (now - int(a.get("startedAtMs") or now)) / 1000
    return {
        **meta,
        "attempt": attempt_id,
        "name": a.get("name", ""),
        "elapsedSec": elapsed,
        "remainingSec": max(0, limit - elapsed) if limit else None,
        "questions": [{
            "prompt": q.get("prompt", ""),
            "math": q.get("math", ""),
            "figure": q.get("figure"),
            "type": q.get("type", "numeric"),
            "choices": q.get("choices") or [],
            "answerCount": len(q.get("answerValues") or []) or 1,
            "pair": bool(q.get("pair")),
        } for q in questions],
    }


@https_fn.on_call()
def submit_challenge(req: https_fn.CallableRequest) -> dict:
    db = firestore.client()
    data = req.data or {}
    challenge = _challenge(db, data.get("token"))
    attempt = _attempt(db, challenge, data.get("attempt"))
    if attempt is None:
        raise _not_found("This attempt no longer exists. Open the challenge link again.")
    questions = _test_questions(challenge.reference)
    ref = attempt.reference

    @firestore.transactional
    def run(transaction) -> dict:
        a = _txn_data(transaction, ref)
        if a.get("status") == "completed":
            return a  # a second tab or a retry: keep the first answers
        now = _now_ms()
        limit = int(challenge.get("timeLimitSec") or 0)
        used = (now - int(a.get("startedAtMs") or now)) / 1000
        answers = groups.clean_answers(data.get("answers"), len(questions))
        graded = groups.grade(questions, answers)
        changes = {
            "status": "completed",
            "answers": answers,
            "results": graded["results"],
            "score": graded["score"],
            "usedSec": round(min(used, limit) if limit else used),
            "times": groups.clean_times(data.get("times"), len(questions), used),
            "shareId": challenges.new_token(),
            "completedAt": firestore.SERVER_TIMESTAMP,
        }
        changes["outcome"] = challenges.outcome(changes, challenge.to_dict())
        transaction.update(ref, changes)
        return {**a, **changes}

    a = run(db.transaction())
    return {**_challenge_meta(challenge), "attempt": attempt.id, "result": _face_off(challenge, questions, a)}


@https_fn.on_call()
def claim_challenge(req: https_fn.CallableRequest) -> dict:
    """Saves a finished attempt to the signed-in account. An attempt is saved to one account only, and never to the
    challenger's own."""
    uid = _require_user(req)
    db = firestore.client()
    data = req.data or {}
    challenge = _challenge(db, data.get("token"))
    attempt = _attempt(db, challenge, data.get("attempt"))
    if attempt is None or attempt.get("status") != "completed":
        raise _not_found("That result no longer exists.")
    if challenge.get("challengerUid") == uid:
        return {"saved": False}
    ref = attempt.reference

    @firestore.transactional
    def run(transaction) -> bool:
        a = _txn_data(transaction, ref)
        if a.get("claimedUid"):
            return a.get("claimedUid") == uid
        transaction.update(ref, {"claimedUid": uid, "claimedAt": firestore.SERVER_TIMESTAMP})
        return True

    return {"saved": run(db.transaction()), "outcome": attempt.get("outcome")}


@https_fn.on_call()
def list_challenges(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    db = firestore.client()
    sent = []
    for c in db.collection("challenges").where("challengerUid", "==", uid).stream():
        row = _challenge_row(c)
        row["friends"] = sorted(({
            "name": a.get("name", ""),
            "status": a.get("status", "started"),
            "score": a.get("score"),
            "usedSec": a.get("usedSec"),
            "outcome": a.get("outcome"),
        } for a in (d.to_dict() for d in db.collection("challengeAttempts").where("challengeId", "==", c.id).stream())),
            key=lambda f: (f["status"] != "completed", -(f["score"] or 0), f["usedSec"] or 0))
        sent.append(row)
    sent.sort(key=lambda r: -(r["createdAt"] or 0))
    played = []
    for a in db.collection("challengeAttempts").where("claimedUid", "==", uid).stream():
        c = db.collection("challenges").document(a.get("challengeId")).get()
        if not c.exists:
            continue
        played.append({
            "token": c.id,
            "attempt": a.id,
            "deckTitle": c.get("deckTitle"),
            "from": c.get("challengerName"),
            "theirScore": c.get("score"),
            "theirSec": c.get("usedSec"),
            "score": a.get("score"),
            "usedSec": a.get("usedSec"),
            "total": c.get("total"),
            "outcome": a.get("outcome"),
            "playedAt": _ms(a.get("completedAt")),
        })
    played.sort(key=lambda r: -(r["playedAt"] or 0))
    return {"sent": sent, "played": played}


# Sharing. Hosting sends /c/** here (firebase.json), so a shared link shows the score card in its preview.
_SITE = f"{os.environ.get('GCLOUD_PROJECT') or 'mathsprint-2b113'}.web.app"
_index_cache: dict = {"html": "", "at": 0.0}


def _index_html() -> str:
    """The app's built index.html, from Hosting (its asset names change on every deploy), kept for five minutes."""
    if _index_cache["html"] and time.time() - _index_cache["at"] < 300:
        return _index_cache["html"]
    with urllib.request.urlopen(f"https://{_SITE}/index.html", timeout=5) as r:  # noqa: S310 - our own site
        page = r.read().decode("utf-8")
    _index_cache.update(html=page, at=time.time())
    return page


def _shared_attempt(db, challenge, share_id: str) -> dict | None:
    share_id = _clean(share_id, 64)
    if not share_id:
        return None
    for a in db.collection("challengeAttempts").where("shareId", "==", share_id).limit(1).stream():
        if a.get("challengeId") == challenge.id:
            return a.to_dict()
    return None


@https_fn.on_request(memory=options.MemoryOption.MB_512, timeout_sec=30)
def challenge_page(req: https_fn.Request) -> https_fn.Response:
    """/c/TOKEN: the app, with this challenge's preview tags. /c/TOKEN/card.png?r=SHARE&size=story: the score card,
    for the challenge or for one friend's shared result. ?r=SHARE on the page itself previews that result."""
    parts = [p for p in req.path.split("/") if p]
    rest = parts[parts.index("c") + 1:] if "c" in parts else []  # the emulator's URL has the function's name first
    token = rest[0] if rest else ""
    want_card = rest[1:] == ["card.png"]
    db = firestore.client()
    snap = db.collection("challenges").document(_clean(token, 64)).get() if token else None
    if snap is None or not snap.exists:
        if want_card:
            return https_fn.Response("Not found", status=404)
        snap = None
    c = snap.to_dict() if snap else None
    a = _shared_attempt(db, snap, req.args.get("r", "")) if snap else None
    host = challenges.public_host(req.headers.get("X-Forwarded-Host"), _SITE)

    if want_card:
        size = "story" if req.args.get("size") == "story" else "feed"
        png = cards.render(c, a, size, host)
        return https_fn.Response(png, mimetype="image/png", headers={"Cache-Control": "public, max-age=600, s-maxage=600"})

    try:
        page = _index_html()
    except Exception:  # Hosting unreachable: send the visitor to the same page without the preview
        return https_fn.Response(status=302, headers={"Location": f"/play/{token}"})
    if c is not None:
        share = f"?r={req.args.get('r')}" if a is not None else ""
        page = challenges.with_preview(
            page,
            cards.headline(c, a),
            challenges.preview_description(c, a),
            f"https://{host}/c/{token}{share}",
            f"https://{host}/c/{token}/card.png{share}",
        )
    return https_fn.Response(page, mimetype="text/html", headers={"Cache-Control": "public, max-age=0, s-maxage=300"})


# Problem reports. A signed-in user writes to the admin; either side can keep writing back.
MAX_OPEN_REPORTS = 10


def _report_row(doc) -> dict:
    r = doc.to_dict()
    return {
        "id": doc.id,
        "uid": r.get("uid"),
        "email": r.get("email", ""),
        "displayName": r.get("displayName", ""),
        "page": r.get("page", ""),
        "status": r.get("status", "open"),
        "thread": list(r.get("thread") or []),
        "userRead": bool(r.get("userRead", True)),
        "createdAt": _ms(r.get("createdAt")),
        "updatedAt": _ms(r.get("updatedAt")),
    }


@https_fn.on_call()
def report_problem(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    db = firestore.client()
    account = _load_account(db, req)
    if account.get("status") == "suspended":
        raise _denied("Your account is suspended.")
    text = _clean(data.get("message"), accounts.MAX_MESSAGE)
    if not text:
        raise _invalid("Tell us what went wrong.")
    reports = db.collection("reports")
    if sum(1 for r in reports.where("uid", "==", uid).stream() if r.get("status") != "resolved") >= MAX_OPEN_REPORTS:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED, "You have several reports open. Add to one of those instead.")
    token = req.auth.token or {}
    ref = reports.document()
    ref.set({
        "uid": uid,
        "email": token.get("email") or account.get("email", ""),
        "displayName": token.get("name") or account.get("displayName", ""),
        "page": _clean(data.get("page"), 200),
        "status": "open",
        "thread": [{"from": "student", "text": text, "at": _now_ms()}],
        "userRead": True,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return _report_row(ref.get())


@https_fn.on_call()
def list_reports(req: https_fn.CallableRequest) -> dict:
    """The user's own reports (markRead clears the reply notification), or every report for the admin."""
    uid = _require_user(req)
    db = firestore.client()
    reports = db.collection("reports")
    if accounts.is_admin(req.auth.token):
        docs = list(reports.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(200).stream())
    else:
        docs = list(reports.where("uid", "==", uid).stream())
        if (req.data or {}).get("markRead"):
            for d in docs:
                if not d.to_dict().get("userRead", True):
                    d.reference.update({"userRead": True})
    return {"reports": sorted((_report_row(d) for d in docs), key=lambda r: -(r["updatedAt"] or 0))}


@https_fn.on_call()
def reply_report(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    text = _clean(data.get("text"), accounts.MAX_MESSAGE)
    if not text:
        raise _invalid("Write a message first.")
    db = firestore.client()
    if _load_account(db, req).get("status") == "suspended":
        raise _denied("Your account is suspended.")
    snap = _owned_report(db, data.get("id"), uid)
    snap.reference.update({
        "status": "open",  # back in the admin's queue
        "thread": list(snap.get("thread") or []) + [{"from": "student", "text": text, "at": _now_ms()}],
        "userRead": True,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}


def _owned_report(db, report_id, uid: str | None):
    """A report by id; for a user, only their own. Someone else's looks the same as a missing one."""
    report_id = _clean(report_id, 128)
    snap = db.collection("reports").document(report_id).get() if report_id else None
    if snap is None or not snap.exists or (uid is not None and snap.get("uid") != uid):
        raise _not_found("That report no longer exists.")
    return snap


@https_fn.on_call()
def admin_reply_report(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)
    data = req.data or {}
    text = _clean(data.get("text"), accounts.MAX_MESSAGE)
    resolve = bool(data.get("resolve"))
    if not text and not resolve:
        raise _invalid("Write a reply first.")
    db = firestore.client()
    snap = _owned_report(db, data.get("id"), None)
    message = {"from": "admin", "text": text, "at": _now_ms(), **({"resolved": True} if resolve else {})}
    snap.reference.update({
        "status": "resolved" if resolve else "replied",
        "thread": list(snap.get("thread") or []) + [message],
        "userRead": False,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}


# Promotions. The admin offers a bigger plan for a few months; the user accepts it when they next sign in.


def _open_offers(db, uid: str) -> list:
    offers = db.collection("promotions").where("uid", "==", uid).where("status", "==", "offered").stream()
    return sorted(offers, key=lambda d: -(_ms(d.get("createdAt")) or 0))


def _offer_row(doc) -> dict:
    r = doc.to_dict()
    return {
        "id": doc.id,
        "plan": r.get("plan"),
        "planLabel": accounts.PLANS[r["plan"]].label if r.get("plan") in accounts.PLANS else r.get("plan"),
        "months": r.get("months"),
        "note": r.get("note", ""),
        "createdAt": _ms(r.get("createdAt")),
    }


def _withdraw_offers(db, uid: str) -> None:
    for d in _open_offers(db, uid):
        d.reference.update({"status": "withdrawn", "updatedAt": firestore.SERVER_TIMESTAMP})


@https_fn.on_call()
def admin_offer_promotion(req: https_fn.CallableRequest) -> dict:
    _require_admin(req)
    data = req.data or {}
    uid = _clean(data.get("uid"), 128)
    try:
        user = auth.get_user(uid) if uid else None
    except auth.UserNotFoundError:
        user = None
    if user is None:
        raise _not_found("That account doesn't exist.")
    if accounts.is_admin({"email": user.email, "email_verified": user.email_verified}):
        raise _invalid("The admin account has no limits to promote.")
    db = firestore.client()
    ref = _account_ref(db, uid)
    snap = ref.get()
    account = snap.to_dict() if snap.exists else accounts.new_account(user.email or "", user.display_name or "")
    if not snap.exists:
        ref.set({**account, "createdAt": firestore.SERVER_TIMESTAMP})
    try:
        plan, months = accounts.check_promotion(account, data.get("plan"), data.get("months"))
    except AccessDenied as e:
        raise _invalid(str(e))
    _withdraw_offers(db, uid)  # one offer at a time; a new one replaces the old
    offer = db.collection("promotions").document()
    offer.set({
        "uid": uid,
        "email": user.email or "",
        "plan": plan,
        "months": months,
        "note": _clean(data.get("note"), 300),
        "status": "offered",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return _offer_row(offer.get())


@https_fn.on_call()
def admin_end_promotion(req: https_fn.CallableRequest) -> dict:
    """Withdraws an offer that hasn't been accepted and ends a running promotion now."""
    _require_admin(req)
    uid = _clean((req.data or {}).get("uid"), 128)
    if not uid:
        raise _invalid("Pick an account.")
    db = firestore.client()
    _withdraw_offers(db, uid)
    ref = _account_ref(db, uid)
    snap = ref.get()
    promo = accounts.active_promo(snap.to_dict()) if snap.exists else None
    if promo:
        ref.update({"promo.endsAt": _now_ms(), "updatedAt": firestore.SERVER_TIMESTAMP})
        if promo.get("promotionId"):
            db.collection("promotions").document(promo["promotionId"]).set({"status": "ended", "endedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    return {"ok": True}


@https_fn.on_call()
def respond_promotion(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    accept = bool(data.get("accept"))
    db = firestore.client()
    if _load_account(db, req).get("status") == "suspended":
        raise _denied("Your account is suspended.")
    offer_id = _clean(data.get("id"), 128)
    if not offer_id:
        raise _invalid("Pick an offer.")
    offer_ref = db.collection("promotions").document(offer_id)
    account_ref = _account_ref(db, uid)

    @firestore.transactional
    def run(transaction) -> dict:
        offer = _txn_data(transaction, offer_ref)
        if offer.get("uid") != uid or offer.get("status") != "offered":
            raise _not_found("That offer is no longer available.")
        if not accept:
            transaction.update(offer_ref, {"status": "declined", "updatedAt": firestore.SERVER_TIMESTAMP})
            return {"accepted": False}
        now = _now_ms()
        ends = accounts.add_months(now, int(offer["months"]))
        transaction.update(account_ref, {
            "promo": {"plan": offer["plan"], "months": int(offer["months"]), "startedAt": now, "endsAt": ends, "promotionId": offer_id},
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        transaction.update(offer_ref, {"status": "accepted", "acceptedAt": firestore.SERVER_TIMESTAMP, "endsAt": ends, "updatedAt": firestore.SERVER_TIMESTAMP})
        return {"accepted": True, "endsAt": ends}

    return run(db.transaction())


@https_fn.on_call(timeout_sec=120)
def delete_deck(req: https_fn.CallableRequest) -> dict:
    """Deletes a deck, its questions and its practice sessions. decksCreated is left alone: a deleted deck still counts
    toward the plan. Tests already assigned from it keep working on their own copy of the questions."""
    uid = _require_user(req)
    db = firestore.client()
    if _load_account(db, req).get("status") == "suspended":
        raise _denied("Your account is suspended.")
    deck = _owned(db, "decks", (req.data or {}).get("deckId"), uid, "That deck no longer exists.")
    sessions = list(db.collection("sessions").where("ownerId", "==", uid).where("deckId", "==", deck.id).stream())
    writer = db.bulk_writer()
    for s in sessions:
        writer.delete(s.reference)
    writer.close()
    db.recursive_delete(deck.reference)
    return {"ok": True, "sessions": len(sessions)}
