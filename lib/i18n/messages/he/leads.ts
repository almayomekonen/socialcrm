/**
 * Leads — Phase B covers only the shared lead widgets rendered ON the
 * dashboard (call-outcome control, mobile contact actions, add-lead control).
 * The rest of the leads area is Phase C. Hebrew copied verbatim.
 */
export const leads = {
  add: 'הוספת ליד',
  outcome: {
    noAnswer: 'לא ענה',
    reached: 'דיברנו',
    interested: 'מעוניין',
    notInterested: 'לא מעוניין',
    title: 'תוצאת שיחה',
    titleLabel: 'תוצאת שיחה:',
    logAria: 'תיעוד תוצאת שיחה',
    toast: {
      noAnswerOn: 'לא הצלחת להשיג את הליד. נזכיר לך לנסות שוב ב-{date}.',
      noAnswer: 'לא הצלחת להשיג את הליד. קבענו תזכורת לנסות שוב.',
      reachedOn: 'השיחה נשמרה. הליד יחזור לרשימת המעקב ב-{date}.',
      reached: 'השיחה נשמרה.',
      interestedOn: 'הליד סומן כמתעניין. נחזיר אותו למעקב ב-{date} כדי להתקדם לסגירה.',
      interested: 'הליד סומן כמתעניין.',
      notInterested: 'הליד סומן כלא רלוונטי והוסר מרשימת המעקב.',
    },
  },
  contact: {
    call: 'התקשר',
    callName: 'התקשר ל{name}',
    whatsapp: 'וואטסאפ',
    whatsappName: 'וואטסאפ ל{name}',
    opening: 'פותח…',
    noValidPhone: 'לליד אין מספר טלפון תקין לוואטסאפ',
  },
} as const
