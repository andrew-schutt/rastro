// packages/react/src/forms.test.ts
import { describe, expect, it } from 'vitest';
import { createFormTracker } from './forms.js';

// Opaque tokens — the tracker never looks inside, which is what makes it DOM-free.
const formA = { id: 'a' };
const formB = { id: 'b' };

describe('createFormTracker', () => {
  it('reports nothing when focus first enters a form', () => {
    const tracker = createFormTracker();

    expect(tracker.focusEntered(formA, 0)).toBeNull();
  });

  it('ignores focus moving between fields of the same form', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);

    expect(tracker.focusEntered(formA, 500)).toBeNull();
  });

  it('emits form_submit with time-to-complete', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 1_000);

    expect(tracker.submitted(formA, 5_200)).toEqual({
      kind: 'form_submit',
      form: formA,
      activeMs: 4_200,
    });
  });

  it('emits form_abandon when focus leaves for a different form', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);

    expect(tracker.focusEntered(formB, 3_000)).toEqual({
      kind: 'form_abandon',
      form: formA,
      activeMs: 3_000,
    });
  });

  it('emits form_abandon when focus leaves every form', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);

    expect(tracker.focusEntered(null, 900)).toEqual({
      kind: 'form_abandon',
      form: formA,
      activeMs: 900,
    });
  });

  it('does not abandon a form that was already submitted', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);
    tracker.submitted(formA, 1_000);

    expect(tracker.focusEntered(null, 2_000)).toBeNull();
  });

  it('emits form_abandon on page hide — the signal §4.4 warns dies on unload', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);

    expect(tracker.pageHidden(2_500)).toEqual({
      kind: 'form_abandon',
      form: formA,
      activeMs: 2_500,
    });
  });

  it('does not double-emit if page hide fires twice', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);
    tracker.pageHidden(1_000);

    expect(tracker.pageHidden(1_100)).toBeNull();
  });

  it('reports nothing on page hide when no form was focused', () => {
    expect(createFormTracker().pageHidden(500)).toBeNull();
  });

  it('omits activeMs when focus was never seen entering the form', () => {
    // A programmatic submit. 0 would claim it was completed instantly; absent says unknown.
    const outcome = createFormTracker().submitted(formA, 800);

    expect(outcome).toEqual({ kind: 'form_submit', form: formA });
    expect(outcome && 'activeMs' in outcome).toBe(false);
  });

  describe('interactionOutside', () => {
    it('abandons the form when a click lands outside it', () => {
      const tracker = createFormTracker();
      tracker.focusEntered(formA, 0);

      expect(tracker.interactionOutside(null, 1_500)).toEqual({
        kind: 'form_abandon',
        form: formA,
        activeMs: 1_500,
      });
    });

    it('does NOT abandon when the click is inside the form — the submit-button case', () => {
      // Clicking submit blurs the field first. A focusout-only rule would fire a false
      // abandon here, immediately before the form_submit.
      const tracker = createFormTracker();
      tracker.focusEntered(formA, 0);

      expect(tracker.interactionOutside(formA, 900)).toBeNull();
      expect(tracker.submitted(formA, 1_000)).toEqual({
        kind: 'form_submit',
        form: formA,
        activeMs: 1_000,
      });
    });

    it('never STARTS an episode — a click is not evidence of filling anything in', () => {
      const tracker = createFormTracker();

      expect(tracker.interactionOutside(formA, 500)).toBeNull();
      // Had the click started the episode, this would claim a 0ms time-to-complete.
      const outcome = tracker.submitted(formA, 500);

      expect(outcome && 'activeMs' in outcome).toBe(false);
    });

    it('reports nothing when no form is active', () => {
      expect(createFormTracker().interactionOutside(null, 100)).toBeNull();
    });

    it('abandons only once for a run of outside clicks', () => {
      const tracker = createFormTracker();
      tracker.focusEntered(formA, 0);
      tracker.interactionOutside(null, 100);

      expect(tracker.interactionOutside(null, 200)).toBeNull();
    });
  });

  it('tracks a second form after the first is submitted', () => {
    const tracker = createFormTracker();
    tracker.focusEntered(formA, 0);
    tracker.submitted(formA, 100);
    tracker.focusEntered(formB, 200);

    expect(tracker.submitted(formB, 900)).toEqual({
      kind: 'form_submit',
      form: formB,
      activeMs: 700,
    });
  });
});
