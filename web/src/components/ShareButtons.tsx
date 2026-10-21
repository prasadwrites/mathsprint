import { useState } from "react";

const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer,width=640,height=640");

function Facebook() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M14 8.5V6.8c0-.8.5-1 .9-1H17V2h-3c-3.3 0-4 2.4-4 4v2.5H8V12h2v10h4V12h2.7l.4-3.5z" />
    </svg>
  );
}

function Instagram() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Sharing for a challenge or a friend's result. `link` is the page to share (its preview shows the score card);
 * `card` is the card image's address without a size, used for Instagram, which takes pictures, not links.
 */
export default function ShareButtons({ link, text, card }: { link: string; text: string; card: string }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const message = `${text} ${link}`;

  /** Every button copies the message with its link first, so it can be pasted into the post, caption or story.
   * Started before anything else in the click, while the browser still allows it. */
  const copyMessage = () =>
    navigator.clipboard?.writeText(message).then(
      () => true,
      () => false,
    ) ?? Promise.resolve(false);

  const shareTo = (url: string, where: string) => {
    const copied = copyMessage();
    open(url);
    copied.then((ok) => setNote(ok ? `Your message and link are copied. Paste them into your ${where} post.` : `Copy this into your ${where} post: ${message}`));
  };

  const copy = async () => {
    setNote((await copyMessage()) ? "Your message and link are copied. Paste them in a text or group chat." : `Couldn't copy. Copy this yourself: ${message}`);
  };

  // Instagram has no share link on the web. On a phone, hand the story-sized card to the share sheet, which lists
  // Instagram; elsewhere save the card so it can be posted from the phone.
  const instagram = async () => {
    const copied = copyMessage();
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${card}${card.includes("?") ? "&" : "?"}size=story`);
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], "mathsprint-challenge.png", { type: "image/png" });
      const ok = await copied;
      const paste = ok ? "Your message and link are copied: paste them as the caption, or add a Link sticker to your story and paste the link." : `Add this to your post: ${message}`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message }).catch(() => {});
        setNote(`Pick Instagram. ${paste}`);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(a.href);
        setNote(`Saved the picture. Post it to Instagram from your phone. ${paste}`);
      }
    } catch {
      setNote("Couldn't get the picture right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="share-buttons">
        <button className="btn share-fb" onClick={() => shareTo(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, "Facebook")}>
          <Facebook /> Facebook
        </button>
        <button className="btn share-ig" onClick={instagram} disabled={busy}>
          <Instagram /> {busy ? "Getting picture…" : "Instagram"}
        </button>
        <button className="btn" onClick={() => shareTo(`https://wa.me/?text=${encodeURIComponent(message)}`, "WhatsApp")}>WhatsApp</button>
        <button className="btn" onClick={() => shareTo(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, "X")}>X</button>
        <button className="btn" onClick={copy}>
          Copy message
        </button>
        {typeof navigator.share === "function" && (
          <button className="btn" onClick={() => {
              copyMessage();
              navigator.share({ title: "MathSprint challenge", text, url: link }).catch(() => {});
            }}>
            More…
          </button>
        )}
      </div>
      {note && (
        <p className="muted" role="status" style={{ fontSize: 14 }}>
          {note}
        </p>
      )}
    </div>
  );
}
