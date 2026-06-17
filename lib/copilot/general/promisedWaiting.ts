/**
 * Deterministic operator sentence for the "promised → still waiting" save.
 * No model, no template engine — pure string from the true count. Singular and
 * plural are handled explicitly for natural Hebrew. Callers only render this when
 * total > 0 (the save is never framed as "0 waiting").
 */
export function promisedWaitingSentence(total: number): string {
  if (total === 1) {
    return 'ליד אחד שהבטחת לחזור אליו גם כתב לך בינתיים — והוא עדיין מחכה.'
  }
  return `${total} לידים שהבטחת לחזור אליהם גם כתבו לך בינתיים — והם עדיין מחכים.`
}
