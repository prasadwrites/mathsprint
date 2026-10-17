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
"""

from __future__ import annotations

import os
import time

from firebase_admin import auth, firestore, initialize_app
from firebase_functions import https_fn, options

import accounts
from accounts import AccessDenied
from generator import DeckRequest, GenerationError, explain_step as _explain, generate_deck as _generate

initialize_app()
options.set_global_options(region="us-central1", max_instances=10)

DIFFICULTIES = {"Easy", "Medium", "Hard", "Mixed"}


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
        result = _generate(request)
    except Exception as e:
        # A deck that never got saved shouldn't count against the plan.
        _account_ref(db, uid).update({"decksCreated": firestore.Increment(-1)})
        if isinstance(e, GenerationError):
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
        raise

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
        })
    batch.commit()

    return {"deckId": deck_ref.id, "questionCount": len(result.deck.questions), "dropped": result.dropped}


@https_fn.on_call(secrets=["ANTHROPIC_API_KEY"], timeout_sec=120)
def explain_step(req: https_fn.CallableRequest) -> dict:
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
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
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
    if admin:
        upgrade = {"waiting": _count(requests.where("status", "==", "pending"))}
    else:
        mine = [d.to_dict() for d in requests.where("uid", "==", req.auth.uid).stream()]
        upgrade = {
            "pendingPlan": next((r["requestedPlan"] for r in mine if _awaiting_plan(r)), None),
            "unreadReplies": sum(1 for r in mine if r.get("status") == "replied" and not r.get("userRead")),
        }
    return {**accounts.summary(account, admin), "hasOwnCode": has_code, "upgrade": upgrade}


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
