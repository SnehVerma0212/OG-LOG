export type TabKey = 'home' | 'cases' | 'statistics' | 'settings';

export interface NavigationState {
  activeTab: TabKey;
  // null: editor closed. caseId null: a new case; otherwise the case being edited.
  editor: { caseId: string | null } | null;
  // Brief confirmation shown after returning from the editor.
  notice: { id: number; message: string } | null;
  // Gives each notice a unique id so an old dismiss timer cannot hide a newer one.
  nextNoticeId: number;
}

export type NavigationAction =
  | { type: 'selectTab'; tab: TabKey }
  | { type: 'openNewCase' }
  | { type: 'openCase'; caseId: string }
  | { type: 'closeEditor' }
  | { type: 'caseSaved'; message: string }
  | { type: 'dismissNotice'; id: number };

export const initialNavigationState: NavigationState = {
  activeTab: 'home',
  editor: null,
  notice: null,
  nextNoticeId: 1,
};

export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'selectTab':
      return { ...state, activeTab: action.tab };
    case 'openNewCase':
      return { ...state, editor: { caseId: null }, notice: null };
    case 'openCase':
      return { ...state, editor: { caseId: action.caseId }, notice: null };
    case 'closeEditor':
      // Cancel, Close and Delete return to the tab the editor was opened from.
      return { ...state, editor: null };
    case 'caseSaved':
      // A successful toolbar save returns to My Cases so the saved case is visible.
      return {
        ...state,
        editor: null,
        activeTab: 'cases',
        notice: { id: state.nextNoticeId, message: action.message },
        nextNoticeId: state.nextNoticeId + 1,
      };
    case 'dismissNotice':
      // Ignore timers left over from an earlier notice.
      return state.notice?.id === action.id ? { ...state, notice: null } : state;
  }
}
