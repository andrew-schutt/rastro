// packages/react/src/forms.ts
// The form_submit / form_abandon lifecycle (SEMANTIC-CONVENTIONS.md "Events").
//
//   ux.form_submit   A form is submitted.                    ux.active_ms = time-to-complete
//   ux.form_abandon  Focus entered a form, then left         ux.active_ms
//                    without submitting.
//
// Deliberately a pure state machine over opaque form tokens rather than DOM nodes: the
// interesting behaviour is the transitions, and this way they are testable without a DOM.
// capture.ts supplies the tokens (the actual <form> elements) and turns the decisions into
// events.
//
// Abandonment is detected from focus AND from clicks landing outside the form, not from
// `focusout` alone. Two reasons. On macOS, clicking a non-focusable element blurs the field
// without focusing anything, so `focusin` never fires and a `focusout`-only rule would miss
// the departure entirely. And a `focusout`-only rule fires a false abandon on the way to
// submitting, because clicking the submit button blurs the field before `submit` arrives.
// Keying off the click's own target avoids both without needing a debounce timer.

/** What the tracker decided should be emitted. */
export interface FormOutcome {
  kind: 'form_submit' | 'form_abandon';
  /** The form it concerns. */
  form: object;
  /**
   * Time-to-complete, or time-before-abandoning: visible ms since focus entered the form.
   * Absent when focus was never seen to enter — omitting `ux.active_ms` says "unknown",
   * where a 0 would claim the form was completed instantly.
   */
  activeMs?: number;
}

export interface FormTracker {
  /**
   * Focus moved. `form` is the form containing the newly focused element, or null when focus
   * landed outside every form.
   */
  focusEntered(form: object | null, atMs: number): FormOutcome | null;
  /**
   * An interaction landed somewhere. `form` is the form containing it, or null.
   *
   * This can only ever END a form episode, never start one — a click is not evidence the
   * user began filling anything in, and treating it as such would report a form "completed"
   * in 0ms whenever focus events were missed.
   */
  interactionOutside(form: object | null, atMs: number): FormOutcome | null;
  /** A form was submitted. */
  submitted(form: object, atMs: number): FormOutcome | null;
  /** The page is going away — the last chance to salvage an abandonment (§4.4). */
  pageHidden(atMs: number): FormOutcome | null;
}

export function createFormTracker(): FormTracker {
  let activeForm: object | null = null;
  let enteredAtMs = 0;

  const leave = (atMs: number): FormOutcome | null => {
    if (activeForm === null) return null;

    const outcome: FormOutcome = {
      kind: 'form_abandon',
      form: activeForm,
      activeMs: atMs - enteredAtMs,
    };
    activeForm = null;
    return outcome;
  };

  return {
    focusEntered(form, atMs) {
      // Moving between fields of the same form is not a departure.
      if (form === activeForm) return null;

      // Focus reached a different form, or left forms entirely: the previous one was
      // abandoned. Note that focus landing outside every form (`form === null`) counts —
      // that is the "clicked something else on the page" case.
      const outcome = leave(atMs);

      if (form !== null) {
        activeForm = form;
        enteredAtMs = atMs;
      }

      return outcome;
    },

    interactionOutside(form, atMs) {
      if (activeForm === null) return null;
      if (form === activeForm) return null; // still inside — including on the submit button
      return leave(atMs);
    },

    submitted(form, atMs) {
      // A submit for a form we never saw focus enter still counts — forms get submitted
      // programmatically, and by a pointer that never focused a field. There is no entry
      // time to measure from, so the outcome carries no activeMs at all.
      const known = form === activeForm;
      const outcome: FormOutcome = {
        kind: 'form_submit',
        form,
        ...(known ? { activeMs: atMs - enteredAtMs } : {}),
      };

      activeForm = null;
      return outcome;
    },

    pageHidden(atMs) {
      // The signal §4.4 warns about: abandonment fires exactly as the page tears down, which
      // is where a normal fetch dies. transport.ts flushes on the same event.
      return leave(atMs);
    },
  };
}
