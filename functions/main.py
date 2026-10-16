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
"""

from __future__ import annotations

import os

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
    return account


def _reserve_deck(db, req: https_fn.CallableRequest, count: int, admin: bool) -> None:
    """Checks the plan and takes one deck from it atomically, so two tabs can't both use the last deck."""

    ref = _account_ref(db, req.auth.uid)

    @firestore.transactional
    def run(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            account = snap.to_dict()
            accounts.check_can_generate(account, count, admin)
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
    if not accounts.code_ok(data.get("accessCode"), account_code, os.environ.get("DECK_ACCESS_CODE"), admin):
        raise _denied("That access code isn't right.")
    topic = _clean(data.get("topic"), 200)
    if not topic:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Tell me what to practice.")
    try:
        count = max(accounts.MIN_QUESTIONS, min(accounts.MAX_QUESTIONS, int(data.get("count", 10))))
    except (TypeError, ValueError):
        count = 10
    try:
        _reserve_deck(db, req, count, admin)
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
            "pendingPlan": next((r["requestedPlan"] for r in mine if r.get("status") == "pending"), None),
            "unreadReplies": sum(1 for r in mine if r.get("status") == "replied" and not r.get("userRead")),
        }
    return {**accounts.summary(account, admin), "hasOwnCode": has_code, "upgrade": upgrade}


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
    has_pending = _count(requests.where("uid", "==", uid).where("status", "==", "pending")) > 0
    plan = data.get("plan")
    try:
        accounts.check_upgrade_request(account.get("plan", accounts.DEFAULT_PLAN), plan, has_pending, accounts.is_admin(req.auth.token))
    except AccessDenied as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
    token = req.auth.token or {}
    ref = requests.document()
    ref.set({
        "uid": uid,
        "email": token.get("email") or account.get("email", ""),
        "displayName": token.get("name") or account.get("displayName", ""),
        "currentPlan": account.get("plan", accounts.DEFAULT_PLAN),
        "requestedPlan": plan,
        "message": _clean(data.get("message"), accounts.MAX_MESSAGE),
        "status": "pending",
        "userRead": False,
        "createdAt": firestore.SERVER_TIMESTAMP,
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
    rows = sorted((_request_row(d) for d in docs), key=lambda r: -(r["createdAt"] or 0))
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
    if approve:
        account_ref = _account_ref(db, r["uid"])
        if not account_ref.get().exists:
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "That account no longer exists.")
        account_ref.update({"plan": r["requestedPlan"], "updatedAt": firestore.SERVER_TIMESTAMP})
    ref.update({
        "status": "replied",
        "reply": reply,
        "approved": approve,
        "userRead": False,
        "repliedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"ok": True}
