import type { PlanId } from "../lib/types";

/** Square payment links for each paid plan, from the embed codes Square generated. */
export const PAY_LINKS: Partial<Record<PlanId, string>> = {
  pro: "https://square.link/u/zfoPN700?src=embed",
  promax: "https://square.link/u/F0xpDWaS?src=embed",
};

/** Opens Square checkout in a centered popup, the way Square's embed script does; falls back to a new tab. */
function openCheckout(url: string) {
  const top = window.top ?? window;
  const width = top.innerWidth || document.documentElement.clientWidth || screen.width;
  const height = top.innerHeight || document.documentElement.clientHeight || screen.height;
  const zoom = width / top.screen.availWidth;
  const w = 500;
  const h = height * 0.75;
  const left = (width - w) / 2 / zoom + (top.screenLeft ?? top.screenX);
  const topPos = (height - h) / 2 / zoom + (top.screenTop ?? top.screenY);
  const popup = window.open(url, "Square Payment Links", `scrollbars=yes, width=${w / zoom}, height=${h / zoom}, top=${topPos}, left=${left}`);
  if (popup) popup.focus();
  return !!popup;
}

/** Square's "Pay now" card for one plan. */
export default function SquarePay({ plan }: { plan: PlanId }) {
  const url = PAY_LINKS[plan];
  if (!url) return null;
  return (
    <div className="square-pay">
      <a
        className="square-pay-button"
        href={url}
        target="_blank"
        rel="noopener"
        onClick={(e) => {
          if (openCheckout(url)) e.preventDefault(); // popup blocked: let the link open a tab
        }}
      >
        Pay now
      </a>
    </div>
  );
}
