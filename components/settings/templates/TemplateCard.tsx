'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Icon from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { uninstallTemplate } from '@/actions/automations/templates'
import type { TemplateView } from '@/lib/automations/templates/overview'
import TemplateArt from './TemplateArt'
import TemplateInstallDialog from './TemplateInstallDialog'
import { errorMessage } from './copy'

/**
 * ONE card for every template: the scene, then the name, then one line, then
 * the action.
 *
 * The illustration leads because it answers "what does this do?" before the
 * title has been read — a picture of a lead arriving and a message going out
 * lands faster than a sentence describing it.
 *
 * A locked template is SHOWN with the requirement's own CTA rather than
 * hidden: someone browsing the gallery is deciding what to connect, and hiding
 * the reason to connect makes that decision impossible.
 *
 * The card face carries only those four things. What installing creates, and
 * the notice that a newer version exists, live in the install dialog — the
 * moment they actually bear on a decision. Removal lives in the row menu,
 * which is where every other list in the product puts it.
 */
export default function TemplateCard({ view, onChanged }: { view: TemplateView; onChanged: () => void }) {
  const [installing, setInstalling] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [pending, start] = useTransition()

  /*
    Anchored to the card rather than to the viewport.

    The shared floating-menu hook places against the viewport using the
    Follow-Up menu's dimensions — 224px wide and a 248px height estimate — so a
    one-item menu got flipped and clamped, and landed nowhere near the button
    that opened it. A menu positioned inside the card cannot drift: it is laid
    out against the trigger and travels with the card.
  */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      // Escape hands the focus back, or the keyboard user is left nowhere.
      triggerRef.current?.focus()
    }
    // Pressing another card's trigger is an outside press here, so opening one
    // menu closes any other: only one is ever open.
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const { template, availability, installed, updateAvailable } = view
  const locked = availability.state === 'locked' ? availability.requirement : null

  function remove() {
    start(async () => {
      const res = await uninstallTemplate(template.key)
      setConfirmRemove(false)
      if (res.ok === false) return toast('error', errorMessage(res.reason))
      toast('success', 'התבנית הוסרה')
      onChanged()
    })
  }

  const countLabel = installed === 0 ? 'לא מותקן' : installed === 1 ? 'מותקנת אחת' : `${installed} מותקנות`

  return (
    <div
      className={`group/card relative flex flex-col rounded-2xl bg-white p-3 pb-4 shadow-[0_0_0_1px_rgba(16,24,64,.05),0_1px_1px_rgba(16,24,64,.04),0_6px_16px_-12px_rgba(16,24,64,.18)] transition-all duration-180 ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(16,24,64,.09),0_2px_3px_rgba(16,24,64,.05),0_18px_34px_-18px_rgba(16,24,64,.26)] active:translate-y-0 ${
        // Cards later in the grid paint over earlier ones, so the open card
        // has to be lifted or its menu slides under its neighbour.
        menuOpen ? 'z-20' : ''
      }`}
    >
      <div className='relative flex h-48 items-center justify-center overflow-hidden rounded-[11px] bg-[#f7f8fa] transition-[transform,background-color] duration-280 ease-[cubic-bezier(.2,.7,.3,1)] group-hover/card:scale-[1.035] group-hover/card:bg-[#f5f6f9]'>
        <TemplateArt templateKey={template.key} />

        {/*
          Installed and locked are the two states the gallery has data for, so
          they are the two badges drawn. Nothing marks a template "popular":
          there is no popularity to read, and a badge that means nothing is
          worse than no badge.
        */}
        {installed > 0 && (
          <span className='absolute bottom-3 start-3 flex items-center gap-1.5 rounded-full bg-[#eff9f3] px-2.5 py-1'>
            <Icon name='check' type='sol' className='size-3 bg-[#1f7a4a]' />
            <span className='text-xs font-semibold text-[#1f7a4a]'>מותקן</span>
          </span>
        )}
        {locked && (
          <span
            className='absolute bottom-3 start-3 flex items-center gap-1.5 rounded-full bg-[#fdf6ea] px-2.5 py-1'
            title='התבנית הזו דורשת חיבור שעדיין לא קיים בחשבון.'
          >
            <Icon name='triangle-exclamation' type='reg' className='size-3 bg-[#a3701a]' />
            <span className='text-xs font-semibold text-[#a3701a]'>דורש חיבור</span>
          </span>
        )}
      </div>

      {/*
        Sits on the card, not inside the illustration well: the well clips its
        overflow and scales on hover, which would crop the menu and swell the
        button. `top-6 end-6` lands it on the same spot the well's `top-3 end-3`
        did, 12px inside the scene.
      */}
      {installed > 0 && (
        <div className='absolute top-6 end-6'>
          {/*
            Hidden until the card is hovered or the button is focused, so the
            scene stays clean at rest. Labelled, never icon-only-without-name.
          */}
          <button
            ref={triggerRef}
            type='button'
            aria-label={`פעולות · ${template.title}`}
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            disabled={pending}
            onClick={() => setMenuOpen((o) => !o)}
            className='flex size-7 items-center justify-center rounded-md bg-white/80 opacity-0 shadow-[0_0_0_1px_rgba(16,24,64,.06)] transition-opacity duration-150 hover:bg-white focus-visible:opacity-100 group-hover/card:opacity-100 aria-expanded:opacity-100'
          >
            <Icon name='ellipsis' type='reg' className='size-4 bg-[#8b98a8]' />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              role='menu'
              className='anim-popanchor-in absolute end-0 top-full z-20 mt-1.5 flex w-40 flex-col gap-0.5 rounded-xl border border-border bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
            >
              <button
                type='button'
                role='menuitem'
                onClick={() => (setMenuOpen(false), setConfirmRemove(true))}
                className='rounded-md px-3 py-2 text-start text-[13px] text-error hover:bg-[#f7f8fa]'
              >
                הסרה
              </button>
            </div>
          )}
        </div>
      )}

      <div className='flex flex-col gap-1.5 px-2.5 pt-6.5'>
        {/* h3, not h2: the category heading above owns the h2 on this page. */}
        <h3 className='text-lg font-semibold tracking-[-0.015em] text-[#08203a]'>
          {template.title}
          {updateAvailable && (
            <>
              {/* The offer, not an alarm: a newer version exists, and the
                  dialog explains that installing it leaves what you already
                  have untouched. */}
              <span
                aria-hidden='true'
                title='קיימת גרסה חדשה של התבנית'
                className='mb-1.5 ms-2 inline-block size-1.5 rounded-full bg-[#5e6ad2] align-middle'
              />
              <span className='sr-only'> — קיימת גרסה חדשה של התבנית</span>
            </>
          )}
        </h3>
        <p className='line-clamp-1 text-[14.5px] leading-[1.6] text-[#8b98a8]' title={template.description}>
          {template.description}
        </p>
      </div>

      {/*
        `mt-auto` keeps the action row aligned across cards whose descriptions
        differ in length. Install stays the primary action only while nothing
        is installed; once something is, a second copy is a lesser choice and
        the button says so.
      */}
      <div className='mt-auto flex items-center justify-between gap-3 px-2.5 pt-4.5'>
        {locked && locked.cta ? (
          <Btn
            variant='outline'
            lbl={locked.cta.label}
            href={locked.cta.href}
            className='h-10 min-w-34 rounded-[10px] border-0 px-4.5 text-sm font-medium text-[#3f4d5e] shadow-[0_0_0_1px_rgba(16,24,64,.08)] hover:bg-[#f7f8fa] hover:text-[#08203a] hover:shadow-[0_0_0_1px_rgba(16,24,64,.2)]'
          />
        ) : (
          <Btn
            variant={installed > 0 ? 'outline' : 'solid'}
            lbl={installed > 0 ? 'התקנה נוספת' : 'התקנה'}
            disabled={Boolean(locked) || pending}
            onClick={() => setInstalling(true)}
            className={
              installed > 0
                ? 'h-10 min-w-34 rounded-[10px] border-0 px-4.5 text-sm font-medium text-[#3f4d5e] shadow-[0_0_0_1px_rgba(16,24,64,.08)] hover:bg-[#f7f8fa] hover:text-[#08203a] hover:shadow-[0_0_0_1px_rgba(16,24,64,.2)]'
                : 'h-10 min-w-34 rounded-[10px] bg-[#08203a] px-4.5 text-sm font-medium shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(10,37,64,.28)] hover:bg-[#0d2b4e] hover:shadow-[inset_0_1px_0_rgba(255,255,255,.14),0_4px_12px_-4px_rgba(10,37,64,.45)] active:translate-y-px'
            }
          />
        )}
        <span className='text-[13px] text-[#8b98a8]'>{countLabel}</span>
      </div>

      {installing && (
        <TemplateInstallDialog
          view={view}
          onClose={() => setInstalling(false)}
          onDone={() => {
            setInstalling(false)
            onChanged()
          }}
        />
      )}

      <ConfirmPop
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        msg={`הסרת "${template.title}" תמחק ${installed === 1 ? 'את האוטומציה שנוצרה ממנה' : `את ${installed} האוטומציות שנוצרו ממנה`}. אוטומציות שיצרתם בעצמכם לא ייגעו.`}
        confirmLbl='הסרה'
        destructive
      />
    </div>
  )
}
