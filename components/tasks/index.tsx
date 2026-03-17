'use client'

import TaskNotes from '@/components/tasks/TaskNotes'
import TaskHeader from '@/components/tasks/TaskHeader'
import TaskStepper from '@/components/tasks/TaskStepper'
import TaskFiles from '@/components/tasks/TaskFiles'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updateFullTask } from '@/actions/tasks'
import { TaskPageEvents } from './utils'

export default function TaskIndex({ task, user, users }) {
  const router = useRouter()

  let initIndex = task.tasks.findIndex((t) => !t.isCompleted)
  if (initIndex < 0) initIndex = task.tasks.length - 1

  return (
    <div className='paper my-4'>
      <div className='task_grid' key={Math.random()}>
        <TaskHeader task={task} users={users} />
        <TaskStepper task={task} initIndex={initIndex} />
        <TaskFiles task={task} />

        <TaskNotes notes={task.notes} userName={user.name} />

        <div style={{ gridArea: 'events' }}></div>
      </div>
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
