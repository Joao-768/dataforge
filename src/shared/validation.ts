import { z } from 'zod'

// Input schemas shared by API routes and client forms, so both sides reject
// the same input with the same message.

export const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Enter your email address.')
    .max(254, 'That email address is too long.')
    .pipe(z.email('Enter a valid email address.'))

export const passwordSchema = z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(200, 'Use at most 200 characters.')

export const nameSchema = z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(80, 'Use at most 80 characters.')

export const registerSchema = z.object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
})

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Enter your password.').max(200),
})

export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z.object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
})

export const profileSchema = z.object({
    name: nameSchema,
    email: emailSchema,
})

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(200),
    newPassword: passwordSchema,
})

export const deleteAccountSchema = z.object({
    password: z.string().max(200).optional(),
    confirm: z.literal('delete my account', {
        error: 'Type "delete my account" to confirm.',
    }),
})

export const settingsSchema = z.object({
    editorFontSize: z.number().int().min(10).max(22),
    defaultRowLimit: z.number().int().min(10).max(1000),
    confirmWriteQueries: z.boolean(),
})

export const projectNameSchema = z
    .string()
    .trim()
    .min(1, 'Give the project a name.')
    .max(80, 'Use at most 80 characters.')

export const projectSchema = z.object({
    name: projectNameSchema,
    description: z.string().trim().max(500, 'Use at most 500 characters.').default(''),
})

export const projectUpdateSchema = projectSchema.partial()

export const uuidSchema = z.uuid('Invalid id.')
