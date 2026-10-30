"""The daily Instagram Reel for tutors: a short, fun video about one everyday tutor headache that MathSprint takes care of.

A scheduled function makes one each morning (and the admin can ask for another). Claude writes the words: a hook, three
stresses that pile up while a "tutor stress meter" climbs to meltdown, three MathSprint fixes that bring it back to calm,
a punchline, and the post caption. reel_video.py animates it with music into an MP4.

Each day has a theme, a tutor headache with the MathSprint features that really solve it. Claude may only claim those
features, so a Reel never promises something the app doesn't do. Themes and colors rotate by date, so two days in a row
never look or read the same.
"""

from __future__ import annotations

import re
import secrets
import unicodedata
from datetime import date
from typing import List

import anthropic
from pydantic import BaseModel, Field

from credit import METER
from generator import MODEL, GenerationError, api_error

SITE = "mathsprint.org"
# Firestore keeps a document under 1 MiB, so a video is stored in parts of this size.
CHUNK_BYTES = 900_000
KEEP_REELS = 30
CORE_TAGS = ["MathSprint", "MathTutor"]
MAX_TAGS = 12

THEMES = [
    {
        "key": "grading",
        "pain": "Grading a stack of quizzes late at night",
        "facts": [
            "Assign a deck as a test to a group of students; each student gets their own link and access code",
            "Tests are graded automatically the moment a student submits",
            "Results show every student's score and the time they spent on each question",
        ],
    },
    {
        "key": "worksheets",
        "pain": "Making a new worksheet for every student and every topic",
        "facts": [
            "Type a topic (like 'factoring quadratics' or 'AP Calc limits') and AI builds a practice deck in about a minute",
            "Choose the difficulty and the number of questions",
            "Every question comes with step-by-step worked solutions",
        ],
    },
    {
        "key": "answer-keys",
        "pain": "Finding a wrong answer in an answer key in front of a student",
        "facts": [
            "Every math answer is checked by a computer algebra system (SymPy) before a deck is saved",
            "Questions that fail the check are rewritten and checked again",
            "If you edit a question, it's saved only when its answer checks out",
        ],
    },
    {
        "key": "parents",
        "pain": "A parent texting 'So how is my kid really doing?'",
        "facts": [
            "Results show accuracy and pace, not just a score",
            "You can see which topics a student is weakest in",
            "Results show where the student's time went, question by question",
        ],
    },
    {
        "key": "pdf",
        "pain": "Retyping textbook problems into practice sets",
        "facts": [
            "Upload a PDF, like a worksheet or a textbook chapter, and MathSprint builds a practice deck from it",
            "The answers are checked before the deck is saved",
            "Students practice it with worked solutions",
        ],
    },
    {
        "key": "explaining",
        "pain": "Explaining the same algebra step for the fifth time",
        "facts": [
            "Every question has step-by-step worked solutions",
            "A student who's stuck on a step can ask for it explained again in a different way",
            "Students can retry the questions they missed",
        ],
    },
    {
        "key": "test-prep",
        "pain": "SAT and ACT test day is close and students freeze under the clock",
        "facts": [
            "Timed practice sprints, one question at a time against the clock",
            "Results show pace as well as accuracy, so students learn where they lose time",
            "Practice the weakest topics next with one click",
        ],
    },
    {
        "key": "class",
        "pain": "Getting a whole class of 30 students onto one quiz",
        "facts": [
            "Share one class link; students sign in with Google (like their Google Classroom account)",
            "You can limit the link to your school's email domain and close it when you're done",
            "See every student's result with their name and email",
        ],
    },
    {
        "key": "homework",
        "pain": "Chasing students who 'forgot' to do their homework",
        "facts": [
            "Put students in a group and assign a test to the whole group at once",
            "Each student gets their own link and access code",
            "See who has finished and who hasn't, with each result",
        ],
    },
    {
        "key": "quick-check",
        "pain": "Needing a five-minute check for understanding before the lesson",
        "facts": [
            "Make a multiple-choice-only test from any deck in a click",
            "Students answer on their phone; it's graded instantly",
            "Results show which questions the group missed most",
        ],
    },
]

SYSTEM = f"""You write short, fun Instagram Reels for MathSprint ({SITE}), an AI math practice app. The audience is
independent math tutors and teachers in the US who teach high school and college students (SAT, ACT, AP, Algebra,
Geometry, Calculus). We speak as "we", the MathSprint team.

Each Reel is a 24-second animation with one story: a tutor's everyday stress piles up while a "tutor stress meter"
climbs to MELTDOWN, then MathSprint takes care of it and the meter drops back to calm. You write the words on screen and
the post caption.

Rules:
- Funny, warm and relatable. Laugh with tutors (coffee, late nights, piles of paper), never at students or parents.
- Only claim what MathSprint really does: use the facts given for today's theme and nothing else. No prices, no user
  counts, no statistics, no testimonials, no quotes from people, no names of real people or schools.
- On-screen text is plain words: no emoji, no hashtags, no quotation marks around the whole line.
- US spelling. Short, punchy, easy to read in two seconds.

Fields:
- hook: the first line on screen, at most 48 characters, a specific moment ("11:48 PM. Quiz number 23 of 30.").
- stresses: exactly 3 lines, at most 34 characters each, that pile up and get funnier.
- fixes: exactly 3 lines, at most 40 characters each, each one a real MathSprint feature from the facts, said as relief.
- punchline: at most 44 characters, a fun closing line about the tutor's evening or weekend.
- caption: 2 to 4 short paragraphs, under 600 characters in all, a few emoji are fine. End with a nudge to try it.
  Don't write hashtags or the web address; we add those.
- hashtags: 8 to 12 tags without the # sign, for math tutors, teachers and test prep."""


class ReelScript(BaseModel):
    hook: str = Field(description="First line on screen, at most 48 characters.")
    stresses: List[str] = Field(description="Exactly 3 lines, at most 34 characters each.")
    fixes: List[str] = Field(description="Exactly 3 lines, at most 40 characters each, real MathSprint features.")
    punchline: str = Field(description="Closing line, at most 44 characters.")
    caption: str = Field(description="The post caption without hashtags or the web address.")
    hashtags: List[str] = Field(description="8 to 12 hashtags without the # sign.")


def theme_for(day: date, made_today: int = 0) -> dict:
    """The day's theme. Another Reel the same day moves on to the next theme, so it isn't the same story again."""
    return THEMES[(day.toordinal() + made_today) % len(THEMES)]


def palette_for(day: date, made_today: int = 0, count: int = 1) -> int:
    """Which color set the video uses; it changes daily, on a different cycle from the themes."""
    return (day.toordinal() * 7 + made_today) % max(count, 1)


def new_token() -> str:
    return secrets.token_urlsafe(18)


# Pictographs, dingbats and the joiners that build emoji. Inter can't draw them, so they're left off the video.
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿︀-️‍⃣]")


def on_screen(text: object, limit: int) -> str:
    """Text the video can draw: no emoji or control characters, one line, cut at a word near `limit`."""
    text = _EMOJI.sub("", unicodedata.normalize("NFC", str(text or "")))
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C" or ch == " ")
    text = " ".join(text.replace("#", "").split())
    if len(text) > 2 * limit:  # Claude ran long; keep whole words
        text = text[: 2 * limit].rsplit(" ", 1)[0].rstrip(",;:-") + "…"
    return text


def clean_tags(tags: object) -> list[str]:
    """Hashtags without '#' or spaces, no repeats (ignoring case), with MathSprint's own tags first."""
    out: list[str] = []
    seen: set[str] = set()
    for tag in CORE_TAGS + list(tags if isinstance(tags, list) else []):
        tag = re.sub(r"[^0-9A-Za-z_]", "", str(tag or ""))
        if tag and tag.lower() not in seen:
            seen.add(tag.lower())
            out.append(tag)
    return out[:MAX_TAGS]


def tidy(script: ReelScript) -> dict:
    """The script as it's stored and drawn: three of each line, cleaned for the screen."""

    def three(lines: list, limit: int, fallback: list[str]) -> list[str]:
        kept = [on_screen(t, limit) for t in lines if on_screen(t, limit)]
        return (kept + fallback)[:3]

    caption = str(script.caption or "").strip()  # the caption may keep its emoji
    caption = re.sub(r"(?m)^\s*#\S+(\s+#\S+)*\s*$", "", caption).strip()  # a line of hashtags, if Claude wrote one
    return {
        "hook": on_screen(script.hook, 48) or "Another late night of tutoring.",
        "stresses": three(script.stresses, 34, ["Papers everywhere", "Coffee number three", "Still not done"]),
        "fixes": three(script.fixes, 40, ["AI builds the practice deck", "Answers checked for you", "Results in one place"]),
        "punchline": on_screen(script.punchline, 44) or "Your evenings are yours again.",
        "caption": caption[:1500],
        "hashtags": clean_tags(script.hashtags),
    }


def full_caption(script: dict) -> str:
    """What the admin pastes into Instagram: the caption, where to try it, and the hashtags."""
    tags = " ".join(f"#{t}" for t in script.get("hashtags") or CORE_TAGS)
    return f"{script.get('caption', '').strip()}\n\nTry it free at {SITE} (link in bio).\n\n{tags}".strip()


def _prompt(theme: dict, recent_hooks: list[str]) -> str:
    facts = "\n".join(f"- {f}" for f in theme["facts"])
    lines = [f"Today's tutor headache: {theme['pain']}.", "", "MathSprint facts you may use:", facts]
    recent = [h for h in recent_hooks if h][:14]
    if recent:
        lines += ["", "Recent hooks; don't repeat them or their jokes:", *[f"- {h}" for h in recent]]
    return "\n".join(lines)


def write_script(theme: dict, recent_hooks: list[str], client: anthropic.Anthropic | None = None) -> dict:
    """Claude writes the day's Reel for `theme`."""
    client = client or anthropic.Anthropic()
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=8000,
            system=SYSTEM,
            messages=[{"role": "user", "content": _prompt(theme, recent_hooks)}],
            output_format=ReelScript,
            output_config={"effort": "medium"},
            # If a request is declined by a safety classifier, retry on a fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        raise api_error(e) from e
    METER.add(response)
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise GenerationError("Claude couldn't write today's Reel. Try making another.")
    return tidy(response.parsed_output)


def chunks(data: bytes, size: int = CHUNK_BYTES) -> list[bytes]:
    return [data[i:i + size] for i in range(0, len(data), size)] or [b""]


def byte_range(header: str | None, total: int) -> tuple[int, int] | None:
    """The (first, last) bytes asked for by a Range header such as 'bytes=0-1023', or None for the whole file.

    Safari and iPhones play a video only when the server answers range requests, so the video link supports them.
    Raises ValueError when the range can't be satisfied.
    """
    m = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", header or "")
    if not m or total <= 0 or (m.group(1) == "" and m.group(2) == ""):
        return None
    if m.group(1) == "":  # the last N bytes
        n = int(m.group(2))
        if n == 0:
            raise ValueError("empty range")
        return max(total - n, 0), total - 1
    first = int(m.group(1))
    last = int(m.group(2)) if m.group(2) else total - 1
    if first >= total or last < first:
        raise ValueError("range not satisfiable")
    return first, min(last, total - 1)
