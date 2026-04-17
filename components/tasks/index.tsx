'use client'

import TaskNotes from '@/components/tasks/TaskNotes'
import TaskHeader from '@/components/tasks/TaskHeader'
import { TaskPageEvents } from './utils'

export default function TaskIndex({ task, user, users }) {
  return (
    <div className='paper my-4'>
      <TaskHeader task={task} users={users} />
      <TaskNotes task={task} userName={user?.name ?? ''} />
      <TaskPageEvents task={task} />
    </div>
  )
}

// // ------------------
// // USE EFFECT
// // ------------------
// useEffect(() => {
//   if (localStorage.needsRefresh) {
//     setTimeout(() => router.refresh(), 100)
//     localStorage.removeItem('needsRefresh')
//   }

//   window.addEventListener('pagehide', saveTaskOnExit)
//   window.addEventListener('visibilitychange', saveTaskOnExit)

//   return () => {
//     window.removeEventListener('pagehide', saveTaskOnExit)
//     window.removeEventListener('visibilitychange', saveTaskOnExit)
//     updateFullTask(task)
//   }
// }, [])

// function saveTaskOnExit(e) {
//   // localStorage.hasChanges &&
//   if (document.visibilityState === 'hidden') {
//     navigator.sendBeacon('/api/saveTask', JSON.stringify(task))
//     localStorage.needsRefresh = 'true'
//     localStorage.removeItem('hasChanges')
//   }
// }

// const onChanges = () => (localStorage.hasChanges = 'true')
