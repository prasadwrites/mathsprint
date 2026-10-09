"""Access code that gates deck generation, so only people the owner shares it with can spend API credit."""

from __future__ import annotations

import hmac


def access_code_ok(given: object, expected: str | None) -> bool:
    """Constant-time comparison. Fails closed when no code is configured on the server."""
    expected = (expected or "").strip()
    if not expected:
        return False
    return hmac.compare_digest(str(given or "").strip().encode(), expected.encode())
