import { expect, test } from '@playwright/test'

test('protected pages redirect to sign-in', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/)
})

test('a wrong password gets a generic message', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
})

test('another user’s project is a 404', async ({ browser }) => {
    const owner = await browser.newContext()
    const ownerPage = await owner.newPage()
    await ownerPage.goto('/')
    await ownerPage.getByRole('button', { name: 'Explore the live demo' }).first().click()
    await expect(ownerPage).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    const url = new URL(ownerPage.url())

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await otherPage.goto('/register')
    await otherPage.getByLabel('Name').fill('Someone Else')
    await otherPage.getByLabel('Email').fill(`other-${Date.now()}@example.com`)
    await otherPage.getByLabel('Password').fill('correct-horse-battery')
    await otherPage.getByRole('button', { name: 'Create account' }).click()
    await expect(otherPage.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await otherPage.goto(url.pathname)
    await expect(otherPage.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
    const api = await otherPage.request.get(`/api${url.pathname}`)
    expect(api.status()).toBe(404)
    await owner.close()
    await other.close()
})
