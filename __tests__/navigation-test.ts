import { initialNavigationState, navigationReducer, type NavigationState } from '../src/navigation';

const onHomeWithEditor: NavigationState = {
  ...initialNavigationState,
  activeTab: 'home',
  editor: { caseId: null },
};

describe('navigationReducer', () => {
  it('returns to My Cases with a confirmation after a successful save', () => {
    const next = navigationReducer(onHomeWithEditor, { type: 'caseSaved', message: 'Draft saved.' });

    expect(next.editor).toBeNull();
    expect(next.activeTab).toBe('cases');
    expect(next.notice?.message).toBe('Draft saved.');
  });

  it('returns to the original tab when the editor is closed without saving', () => {
    const next = navigationReducer(onHomeWithEditor, { type: 'closeEditor' });

    expect(next.editor).toBeNull();
    expect(next.activeTab).toBe('home');
    expect(next.notice).toBeNull();
  });

  it('opens the editor for a new or existing case', () => {
    expect(navigationReducer(initialNavigationState, { type: 'openNewCase' }).editor).toEqual({ caseId: null });
    expect(navigationReducer(initialNavigationState, { type: 'openCase', caseId: 'abc' }).editor).toEqual({ caseId: 'abc' });
  });

  it('dismisses only the notice its timer was started for', () => {
    const first = navigationReducer(onHomeWithEditor, { type: 'caseSaved', message: 'Draft saved.' });
    const reopened = navigationReducer(first, { type: 'openNewCase' });
    const second = navigationReducer(reopened, { type: 'caseSaved', message: 'Changes saved.' });

    expect(navigationReducer(second, { type: 'dismissNotice', id: first.notice!.id }).notice).toEqual(second.notice);
    expect(navigationReducer(second, { type: 'dismissNotice', id: second.notice!.id }).notice).toBeNull();
  });
});
