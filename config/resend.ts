import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND)

export default resend
