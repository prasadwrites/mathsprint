import { useState } from "react";
import { dismissOfferSend, redeemOfferCode } from "../lib/db";
import { shortDate } from "../lib/offerCode";
import type { SharedOffer } from "../lib/types";

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
const phone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const openTab = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/** An offer code the admin sent: use it on this account, and pass it on through a messaging app or email. */
export default function SharedOfferCard({ offer, onDone }: { offer: SharedOffer; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [redeemed, setRedeemed] = useState<string>("");
  const message = `${offer.shareText} ${offer.link}`;
  const subject = `MathSprint ${offer.planLabel} free for ${months(offer.months)}`;

  /** Every button copies the message first, so it can be pasted if the app opens without it. */
  const copyMessage = () =>
    navigator.clipboard?.writeText(message).then(
      () => true,
      () => false,
    ) ?? Promise.resolve(false);

  const shareTo = (url: string, where: string, sameTab = false) => {
    const copied = copyMessage();
    if (sameTab) window.location.href = url;
    else openTab(url);
    copied.then((ok) => setNote(ok ? `The message and link are copied too, in case ${where} opens empty.` : ""));
  };

  const copy = async () => {
    setNote((await copyMessage()) ? "Copied. Paste it into any chat or email." : `Couldn't copy. Copy this yourself: ${message}`);
  };

  const redeem = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await redeemOfferCode(offer.code);
      setRedeemed(`You're on ${r.planLabel} until ${shortDate(r.endsAt)}. Then your account goes back to ${r.basePlanLabel}.`);
      onDone(); // the plan on the page updates; this card stays with the share buttons
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hide = async () => {
    setBusy(true);
    try {
      await dismissOfferSend(offer.id);
    } catch {
      // It goes away for now either way; it comes back next visit if the server didn't hear.
    }
    onDone();
  };

  const canRedeem = !offer.redeemed && !offer.redeemHint && !redeemed;
  const sms = `sms:${/iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(message)}`;

  return (
    <section className="offer shared-offer" aria-label="Offer code for you and your friends">
      <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
        <b>
          We sent you an offer: {offer.planLabel} free for {months(offer.months)}.
        </b>
        {offer.note && <span>{offer.note}</span>}
        <span className="row" style={{ gap: 8 }}>
          <span className="small muted">Code</span>
          <span className="code">{offer.code}</span>
          <span className="small muted">· use by {shortDate(offer.redeemBy)}</span>
        </span>
        {redeemed ? (
          <span className="small" role="status">
            {redeemed}
          </span>
        ) : canRedeem ? (
          <span className="small muted">Use it on your account, and share it with friends so they can sign up with it too.</span>
        ) : (
          <span className="small muted">{offer.redeemed ? "You've already used this code. Share it with your friends so they can sign up with it." : `${offer.redeemHint} You can still share it with friends.`}</span>
        )}
        {error && <span className="error">{error}</span>}
      </div>
      <div className="stack" style={{ gap: 10, flex: "1 1 320px" }}>
        {canRedeem && (
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={redeem}>
            {busy ? "Working…" : "Use it on my account"}
          </button>
        )}
        <div className="row spread" style={{ gap: 8 }}>
          <span className="small muted">Share with friends:</span>
          <button className="btn-link" style={{ fontSize: 14 }} disabled={busy} onClick={hide}>
            Hide
          </button>
        </div>
        <div className="share-buttons">
          <button className="btn" onClick={() => shareTo(`https://wa.me/?text=${encodeURIComponent(message)}`, "WhatsApp")}>
            WhatsApp
          </button>
          {phone() && (
            <button className="btn" onClick={() => shareTo(sms, "Messages", true)}>
              Text message
            </button>
          )}
          {phone() && (
            <button className="btn" onClick={() => shareTo(`fb-messenger://share/?link=${encodeURIComponent(offer.link)}`, "Messenger", true)}>
              Messenger
            </button>
          )}
          <button className="btn" onClick={() => shareTo(`https://t.me/share/url?url=${encodeURIComponent(offer.link)}&text=${encodeURIComponent(offer.shareText)}`, "Telegram")}>
            Telegram
          </button>
          <button className="btn" onClick={() => shareTo(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`, "your email app", true)}>
            Email
          </button>
          <button className="btn" onClick={copy}>
            Copy message
          </button>
          {typeof navigator.share === "function" && (
            <button
              className="btn"
              onClick={() => {
                copyMessage();
                navigator.share({ title: subject, text: offer.shareText, url: offer.link }).catch(() => {});
              }}
            >
              More…
            </button>
          )}
        </div>
        {note && (
          <p className="muted" role="status" style={{ fontSize: 14, margin: 0 }}>
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
