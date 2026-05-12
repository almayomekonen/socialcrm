import { notFound } from 'next/navigation'
import { requireAgencyUser } from '@/lib/requireUser'
import { isCopilotInspectorEnabled } from '@/lib/ai/flags'
import {
  getInspectorTotals,
  getLatencyByTaskKind,
  getMessagesColumnList,
  getProviderUsage,
  listRecentConversations,
  listRecentMessages,
  listRecentRuns,
  type InspectorWindow,
} from '@/db/aiInspector'

export const metadata = { title: 'AI Inspector' }

/**
 * Phase 1.5 internal inspector. Layered gates:
 *   1. ADMIN role (enforced by the admin_settings layout).
 *   2. AI_COPILOT_INSPECTOR=1 env flag (this page).
 *
 * Surface exposes provider/model identifiers and per-run cost — never enable
 * on a customer-facing deployment. Read-only; no actions are mounted here.
 */

type SP = { [key: string]: string | string[] | undefined }

function pickString(sp: SP, key: string): string | null {
  const raw = sp[key]
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length ? t : null
}

function parseWindow(raw: string | null): InspectorWindow {
  if (raw === '24h' || raw === '7d' || raw === '30d' || raw === 'all') return raw
  return '7d'
}

export default async function AiInspectorPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!isCopilotInspectorEnabled()) notFound()

  const sp = await searchParams
  const user = await requireAgencyUser()
  const leadIdRaw = pickString(sp, 'leadId')
  const leadId = leadIdRaw ? Number(leadIdRaw) : null
  const window = parseWindow(pickString(sp, 'window'))
  const statusFilter = pickString(sp, 'status')

  const [totals, latency, providerUsage, conversations, messages, runs, columns] = await Promise.all([
    getInspectorTotals({ agencyId: user.agencyId, window }),
    getLatencyByTaskKind({ agencyId: user.agencyId, window }),
    getProviderUsage({ agencyId: user.agencyId, window }),
    listRecentConversations({ agencyId: user.agencyId, leadId, limit: 25 }),
    listRecentMessages({ agencyId: user.agencyId, leadId, status: statusFilter, window, limit: 50 }),
    listRecentRuns({ agencyId: user.agencyId, leadId, window, limit: 50 }),
    getMessagesColumnList(),
  ])

  const hasProviderColumn = columns.includes('provider')
  const hasModelColumn = columns.includes('model')
  const doctrineHeld = !hasProviderColumn && !hasModelColumn

  return (
    <div dir='ltr' className='mb-12 space-y-8 font-mono text-sm'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold'>AI Conversation Inspector</h1>
        <p className='text-gray-500'>
          Phase 1.5 read-only validation surface. agencyId={user.agencyId}, window={window}
          {leadId ? `, leadId=${leadId}` : ''}
          {statusFilter ? `, status=${statusFilter}` : ''}
        </p>
        <FilterBar window={window} leadId={leadId} status={statusFilter} />
      </header>

      <DoctrineCheck columns={columns} held={doctrineHeld} />

      <Totals totals={totals} window={window} />

      <Section title={`Latency by taskKind (success only, window=${window})`}>
        {latency.length === 0 ? (
          <Empty text='No runs yet for this window.' />
        ) : (
          <Table
            headers={['taskKind', 'count', 'p50 ms', 'p95 ms', 'avg ms']}
            rows={latency.map((b) => [
              b.taskKind,
              b.count,
              b.p50Ms ?? '—',
              b.p95Ms ?? '—',
              b.avgMs ?? '—',
            ])}
          />
        )}
      </Section>

      <Section title={`Provider / model usage (window=${window})`}>
        {providerUsage.length === 0 ? (
          <Empty text='No provider-attributed runs yet.' />
        ) : (
          <Table
            headers={['provider', 'model', 'count', 'success', 'cost USD']}
            rows={providerUsage.map((p) => [
              p.provider,
              p.model,
              p.count,
              p.successCount,
              p.costUsd.toFixed(6),
            ])}
          />
        )}
      </Section>

      <Section title='Recent conversations (max 25)'>
        {conversations.length === 0 ? (
          <Empty text='No conversations recorded yet. Verify AI_COPILOT_PERSIST=1 and trigger an action.' />
        ) : (
          <Table
            headers={['id', 'leadId', 'createdByUserId', 'state', 'messages', 'lastMessageAt', 'createdAt']}
            rows={conversations.map((c) => [
              c.id,
              c.leadId,
              c.createdByUserId,
              c.state,
              c.messageCount,
              fmtIso(c.lastMessageAt),
              fmtIso(c.createdAt),
            ])}
          />
        )}
      </Section>

      <Section title={`Recent messages (max 50, window=${window})`}>
        {messages.length === 0 ? (
          <Empty text='No messages in this window.' />
        ) : (
          <Table
            headers={[
              'id',
              'conv',
              'parent',
              'role',
              'status',
              'actionId',
              'taskKind',
              'mode',
              'seq',
              'payload?',
              'errorReason',
              'text preview',
              'createdAt',
            ]}
            rows={messages.map((m) => [
              m.id,
              m.conversationId,
              m.parentMessageId ?? '—',
              m.role,
              m.status,
              m.actionId ?? '—',
              m.taskKind ?? '—',
              m.mode ?? '—',
              m.sequence,
              m.hasStructuredPayload ? 'yes' : 'no',
              m.errorReason ?? '—',
              m.textPreview,
              fmtIso(m.createdAt),
            ])}
          />
        )}
      </Section>

      <Section title={`Recent runs (max 50, window=${window})`}>
        {runs.length === 0 ? (
          <Empty text='No runs in this window.' />
        ) : (
          <Table
            headers={[
              'id',
              'msg',
              'taskKind',
              'role',
              'mode',
              'provider',
              'model',
              'chain',
              'ok',
              'inTok',
              'outTok',
              'cost USD',
              'latencyMs',
              'errorCode',
              'startedAt',
            ]}
            rows={runs.map((r) => [
              r.id,
              r.messageId ?? '—',
              r.taskKind,
              r.role,
              r.mode ?? '—',
              r.provider ?? '—',
              r.model ?? '—',
              r.chainIndex ?? '—',
              r.success ? 'yes' : 'no',
              r.inputTokens,
              r.outputTokens,
              r.costUsd.toFixed(6),
              r.latencyMs ?? '—',
              r.errorCode ?? '—',
              fmtIso(r.startedAt),
            ])}
          />
        )}
      </Section>
    </div>
  )
}

function FilterBar({
  window,
  leadId,
  status,
}: {
  window: InspectorWindow
  leadId: number | null
  status: string | null
}) {
  return (
    <form className='flex flex-wrap items-end gap-3 pt-3' method='get'>
      <label className='flex flex-col gap-1'>
        <span className='text-xs text-gray-500'>window</span>
        <select name='window' defaultValue={window} className='border px-2 py-1 rounded'>
          <option value='24h'>24h</option>
          <option value='7d'>7d</option>
          <option value='30d'>30d</option>
          <option value='all'>all</option>
        </select>
      </label>
      <label className='flex flex-col gap-1'>
        <span className='text-xs text-gray-500'>leadId</span>
        <input
          type='number'
          name='leadId'
          defaultValue={leadId ?? ''}
          placeholder='all leads'
          className='border px-2 py-1 rounded w-32'
        />
      </label>
      <label className='flex flex-col gap-1'>
        <span className='text-xs text-gray-500'>message status</span>
        <select name='status' defaultValue={status ?? ''} className='border px-2 py-1 rounded'>
          <option value=''>any</option>
          <option value='pending'>pending</option>
          <option value='streaming'>streaming</option>
          <option value='complete'>complete</option>
          <option value='failed'>failed</option>
          <option value='aborted'>aborted</option>
        </select>
      </label>
      <button type='submit' className='border px-3 py-1 rounded bg-gray-100 hover:bg-gray-200'>
        Apply
      </button>
    </form>
  )
}

function DoctrineCheck({ columns, held }: { columns: string[]; held: boolean }) {
  return (
    <div
      className={`rounded border p-3 ${held ? 'border-green-400 bg-green-50' : 'border-red-500 bg-red-50'}`}
    >
      <h2 className='font-semibold mb-1'>Doctrine probe: ai_messages columns</h2>
      <p className='text-xs mb-2'>
        Expectation: `provider` and `model` are absent from ai_messages — those live only on
        ai_runs. A failure here means the abstraction boundary has regressed.
      </p>
      <p className='text-xs mb-2'>
        Status: <strong>{held ? 'HELD' : 'BROKEN'}</strong>
      </p>
      <p className='text-xs break-all'>columns: {columns.join(', ')}</p>
    </div>
  )
}

function Totals({ totals, window }: { totals: Awaited<ReturnType<typeof getInspectorTotals>>; window: InspectorWindow }) {
  const successRate = totals.runs > 0 ? ((totals.runsSuccess / totals.runs) * 100).toFixed(1) : '—'
  return (
    <Section title={`Totals (window=${window})`}>
      <Table
        headers={['metric', 'value']}
        rows={[
          ['conversations (all-time)', totals.conversations],
          ['messages in window', totals.messages],
          ['runs in window', totals.runs],
          ['runs success', totals.runsSuccess],
          ['runs fail', totals.runsFail],
          ['success rate %', successRate],
          ['total input tokens', totals.totalInputTokens],
          ['total output tokens', totals.totalOutputTokens],
          ['total cost USD', totals.totalCostUsd.toFixed(6)],
        ]}
      />
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='space-y-2'>
      <h2 className='font-semibold text-base'>{title}</h2>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <div className='text-gray-500 text-xs italic border border-dashed rounded p-3'>{text}</div>
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className='overflow-x-auto'>
      <table className='min-w-full text-xs border-collapse'>
        <thead>
          <tr className='bg-gray-100'>
            {headers.map((h) => (
              <th key={h} className='border px-2 py-1 text-left whitespace-nowrap'>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className='odd:bg-white even:bg-gray-50'>
              {r.map((cell, j) => (
                <td key={j} className='border px-2 py-1 align-top whitespace-nowrap max-w-md truncate'>
                  {String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtIso(iso: string | null): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace('Z', '').slice(0, 19)
}
