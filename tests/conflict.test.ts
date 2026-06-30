import { describe, expect, it } from 'vitest';
import { CONTROLLER_ACTIONS, actionKey } from '../src/core/controller-actions';
import { inProfileConflict, normalizeProfilesState, validateBindPlan } from '../src/core/profiles';
import type { Globals, Profile, ProfilesState } from '../src/core/profiles';
import type { Bindings } from '../src/core/types';

function baseState(): ProfilesState {
	return normalizeProfilesState(undefined); // one fully-bound "Default", globals F8/F9
}

function draftFrom(state: ProfilesState, bindings: Bindings): Profile {
	return { ...state.profiles[0], bindings };
}

describe('validateBindPlan global-collision', () => {
	it('flags an inputId equal to the toggle combo code (F8) as comboKind toggle', () => {
		const s = baseState();
		const globals: Globals = s.globals; // toggle F8 / help F9
		const draft = draftFrom(s, { ...s.profiles[0].bindings, F8: { t: 'b', i: 0 } });
		const issues = validateBindPlan(s, globals, draft);
		expect(issues).toContainEqual({ kind: 'global-collision', inputId: 'F8', comboKind: 'toggle' });
	});

	it('flags an inputId equal to the help combo code (F9) as comboKind help', () => {
		const s = baseState();
		const draft = draftFrom(s, { ...s.profiles[0].bindings, F9: { t: 'b', i: 1 } });
		const issues = validateBindPlan(s, s.globals, draft);
		expect(issues).toContainEqual({ kind: 'global-collision', inputId: 'F9', comboKind: 'help' });
	});
});

describe('validateBindPlan unmapped', () => {
	it('reports an unmapped action when its only input is removed', () => {
		const s = baseState();
		const bindings = { ...s.profiles[0].bindings };
		delete bindings.Space; // Space is the sole input for btn.a (b:0)
		const draft = draftFrom(s, bindings);
		const issues = validateBindPlan(s, s.globals, draft);
		expect(issues).toContainEqual({ kind: 'unmapped', actionKey: 'b:0' });
	});

	it('yields no unmapped issues for a fully-bound default profile', () => {
		const s = baseState();
		const issues = validateBindPlan(s, s.globals, s.profiles[0]);
		expect(issues.some((i) => i.kind === 'unmapped')).toBe(false);
	});
});

describe('validateBindPlan invariants', () => {
	it("never returns an 'in-profile' issue", () => {
		const s = baseState();
		const bindings: Bindings = { ...s.profiles[0].bindings, F8: { t: 'b', i: 0 } };
		delete bindings.Space;
		const issues = validateBindPlan(s, s.globals, draftFrom(s, bindings));
		expect(issues.some((i) => i.kind === 'in-profile')).toBe(false);
	});
});

describe('inProfileConflict', () => {
	const bindings: Bindings = { KeyW: { t: 'a', a: 1, v: -1 }, Space: { t: 'b', i: 0 } };

	it('returns the current action key when the input is bound to a different action', () => {
		const r = inProfileConflict(bindings, 'Space', actionKey({ t: 'b', i: 7 }));
		expect(r).toEqual({ currentActionKey: 'b:0' });
	});

	it('returns null when the input is unbound', () => {
		expect(inProfileConflict(bindings, 'KeyZ', 'b:0')).toBeNull();
	});

	it('returns null when the input already drives the same action', () => {
		expect(inProfileConflict(bindings, 'Space', 'b:0')).toBeNull();
	});
});

// Sanity: registry has the actions referenced above.
describe('registry sanity for conflict tests', () => {
	it('btn.a maps to b:0', () => {
		const btnA = CONTROLLER_ACTIONS.find((a) => a.id === 'btn.a')!;
		expect(actionKey(btnA.action)).toBe('b:0');
	});
});
