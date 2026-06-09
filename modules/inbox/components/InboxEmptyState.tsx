/**
 * Shown in the workspace pane when no conversation is selected. Guides the user
 * to a next action (UX rule: no dead-end empty screens).
 */
export default function InboxEmptyState({ hasConversations }: { hasConversations: boolean }) {
  return (
    <div className='flex h-full items-center justify-center text-center text-gray-400'>
      <p className='text-base'>{hasConversations ? 'בחר שיחה מהרשימה כדי להתחיל' : 'אין שיחות עדיין'}</p>
    </div>
  )
}
