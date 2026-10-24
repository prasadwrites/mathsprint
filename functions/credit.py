"""An estimate of the Anthropic API credit left, for the admin's profile menu.

The Anthropic API has no endpoint that returns a prepaid credit balance (the Admin API's cost report needs an
organization and an Admin API key, and still reports spend, not what is left). So the admin types in the balance shown
on console.anthropic.com, every Claude call made here adds its cost from the token counts in the response, and the
estimate is that balance minus what was spent since. Spending outside this app with the same account isn't seen.
"""

from __future__ import annotations

import threading

# US dollars per million tokens: (input, output). Fallback models are here because a declined request can be
# answered by another model. Cache reads are 0.1x input (Opus 5.5 lists $0.20) and 5-minute cache writes 1.25x.
PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-fable-5-1": (10.0, 50.0),
    "claude-fable-5": (10.0, 50.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-5-5": (0.1, 0.5),
    "claude-haiku-4-5": (1.0, 5.0),
}
# A model not in the table is priced like the most expensive one, so the estimate errs low rather than high.
UNKNOWN = (10.0, 50.0)

CONSOLE_URL = "https://console.anthropic.com/settings/billing"


def _price(model: str) -> tuple[float, float]:
    model = model or ""
    # Longest match first, so "claude-opus-5-5-..." isn't priced as "claude-opus-5".
    for name in sorted(PRICES, key=len, reverse=True):
        if model == name or model.startswith(name + "-") or model.startswith(name + "@"):
            return PRICES[name]
    return UNKNOWN


def _tokens(usage, key: str) -> int:
    value = usage.get(key) if isinstance(usage, dict) else getattr(usage, key, None)
    return value if isinstance(value, int) else 0


def cost_usd(model: str, usage) -> float:
    """What one response cost, from its `usage` (an SDK object or a dict)."""
    if usage is None:
        return 0.0
    price_in, price_out = _price(model)
    tokens_in = (
        _tokens(usage, "input_tokens")
        + _tokens(usage, "cache_read_input_tokens") * 0.1
        + _tokens(usage, "cache_creation_input_tokens") * 1.25
    )
    return (tokens_in * price_in + _tokens(usage, "output_tokens") * price_out) / 1_000_000


class Meter:
    """Adds up the cost of Claude calls; the deck pipeline makes them from several threads at once."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._usd = 0.0
        self._calls = 0

    def add(self, response) -> None:
        cost = cost_usd(getattr(response, "model", ""), getattr(response, "usage", None))
        with self._lock:
            self._usd += cost
            self._calls += 1

    def take(self) -> tuple[float, int]:
        """The cost and number of calls since the last take, and starts again from zero."""
        with self._lock:
            spent, calls = self._usd, self._calls
            self._usd, self._calls = 0.0, 0
        return spent, calls


METER = Meter()


def summary(doc: dict | None) -> dict:
    """What the profile menu shows: the balance the admin entered, the spend since, and the estimate left."""
    doc = doc or {}
    balance = doc.get("balanceUsd")
    spent = float(doc.get("spentUsd") or 0)
    entered = isinstance(balance, (int, float))
    return {
        "balanceUsd": float(balance) if entered else None,
        "spentUsd": round(spent, 4),
        "calls": int(doc.get("calls") or 0),
        "remainingUsd": round(float(balance) - spent, 2) if entered else None,
        "setAt": doc.get("setAt"),
        "consoleUrl": CONSOLE_URL,
    }


def parse_balance(value) -> float:
    """The balance the admin typed, in dollars."""
    if isinstance(value, str):
        value = value.strip().lstrip("$").replace(",", "")
    try:
        balance = float(value)
    except (TypeError, ValueError):
        raise ValueError("Enter the balance in dollars, like 42.50.")
    if not 0 <= balance <= 1_000_000:
        raise ValueError("Enter the balance in dollars, like 42.50.")
    return round(balance, 2)
