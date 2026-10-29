/**
 * Inbox namespace (Phase D) — the desktop WhatsApp inbox (`/inbox`). One file
 * per pane: list (page, toolbar, rows, empty, intelligence codes), thread
 * (header, bubbles, delivery, failures, media), composer (reply box, service
 * window, health notices), conversation (actions, ownership, analysis,
 * arrivals); then the Messenger and Comments inboxes (`messenger`, `comments`)
 * and the Meta permission notices they show (`metaNotice`); last, the copy only
 * the phone inbox has (`mobile`). Hebrew copied verbatim from the components it
 * came from.
 */
import { page, toolbar, channels, list, row, empty, intel } from './list'
import { header, conversation, status, failure, tooltip, reaction, quote, kind, media } from './thread'
import { draft, emoji, serviceWindow, connect, health, locked } from './composer'
import { menu, leadless, ownership, take, analysis, awareness } from './conversation'
import { messenger } from './messenger'
import { comments } from './comments'
import { metaNotice } from './metaNotices'
import { mobile } from './mobile'

export const inbox = {
  page,
  toolbar,
  channels,
  list,
  row,
  empty,
  intel,
  header,
  conversation,
  status,
  failure,
  tooltip,
  reaction,
  quote,
  kind,
  media,
  draft,
  emoji,
  serviceWindow,
  connect,
  health,
  locked,
  menu,
  leadless,
  ownership,
  take,
  analysis,
  awareness,
  messenger,
  comments,
  metaNotice,
  mobile,
} as const
