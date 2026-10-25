/** "Multiple choice only" when making a test: typed-answer questions become four-option questions, so nobody types an
 * answer. Hidden when every question in the deck is already multiple choice. */
export default function ChoicesOnly({ id, typed, checked, disabled, onChange }: { id: string; typed: number; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  if (!typed) return null;
  return (
    <div>
      <label className="radio" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> Multiple choice only
      </label>
      <p className="muted small">
        {checked
          ? `The ${typed === 1 ? "question that needs" : `${typed} questions that need`} a typed answer ${typed === 1 ? "gets" : "get"} four options instead: the checked answer and three wrong ones. Any that can't be done reliably are left out of the test.`
          : `${typed === 1 ? "1 question asks" : `${typed} questions ask`} for a typed answer. Turn this on so every answer is a pick from four options.`}
      </p>
    </div>
  );
}

/** "Multiple choice only", with how many questions it left out, for a test's summary line. */
export function choicesNote(t: { choicesOnly?: boolean; leftOut?: number }) {
  if (!t.choicesOnly) return "";
  return ` · multiple choice only${t.leftOut ? ` (${t.leftOut} left out)` : ""}`;
}
