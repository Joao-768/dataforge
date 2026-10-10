import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '@/server/config'
import { log } from '@/server/logger'

// Outgoing email. Locally, Docker Compose runs Mailpit and SMTP_URL points at
// it, so reset links can be read at http://localhost:8025. Without SMTP the
// message is not sent: in development the link is logged so the flow can be
// completed; in production only the failure is logged.

let transport: Transporter | null | undefined

function transporter(): Transporter | null {
    if (transport !== undefined) return transport
    const url = config().SMTP_URL
    transport = url ? nodemailer.createTransport(url) : null
    return transport
}

export interface Mail {
    to: string
    subject: string
    text: string
}

export async function sendMail(mail: Mail): Promise<void> {
    const smtp = transporter()
    if (!smtp) {
        if (config().NODE_ENV === 'development') {
            log.warn(
                { to: mail.to, subject: mail.subject, body: mail.text },
                'SMTP not configured; mail printed instead',
            )
        } else {
            log.error({ subject: mail.subject }, 'SMTP not configured; mail not sent')
        }
        return
    }
    await smtp.sendMail({ from: config().MAIL_FROM, ...mail })
}
