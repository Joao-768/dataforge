import { expect, test } from '@playwright/test'

test('a new user designs a table, migrates, inserts a row and queries it', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`
    await page.goto('/register')
    await page.getByLabel('Name').fill('End To End')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery')
    await page.getByLabel('Confirm password').fill('correct-horse-battery')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()

    // Create a project with an empty sandbox.
    await page.getByRole('button', { name: 'New project' }).click()
    await page.getByLabel('Name').fill('Library')
    await page.getByText('Empty sandbox').click()
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()

    // Design: add a table, rename it, add a column.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Designer', exact: true })
        .click()
    await expect(page.getByText('In sync with the database')).toBeVisible()
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    const tableName = page.getByLabel('Table name')
    await tableName.fill('books')
    await tableName.press('Enter')
    await page.getByRole('button', { name: 'Add', exact: true }).first().click()
    const columnName = page.getByLabel('Column name')
    await columnName.fill('title')
    await columnName.press('Enter')
    await expect(page.locator('.react-flow__node').filter({ hasText: 'books' })).toContainText(
        'title',
    )
    await expect(page.getByText('Draft saved')).toBeVisible()

    // Review the generated SQL and create the migration.
    await page.getByRole('button', { name: 'Review migration' }).click()
    await expect(page.locator('pre').getByText(/CREATE TABLE public\.books/)).toBeVisible()
    await page.getByRole('button', { name: 'Create migration' }).click()

    // Apply it.
    await expect(page).toHaveURL(/\/migrations\?migration=/)
    await page.getByRole('button', { name: 'Apply' }).click()
    await page.getByRole('button', { name: 'Apply migration' }).click()
    await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible()

    // Insert a row through the data explorer.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Data', exact: true })
        .click()
    await page.getByRole('button', { name: 'Row', exact: true }).click()
    await page.getByLabel('title', { exact: true }).fill('Designing Data-Intensive Applications')
    await page.getByRole('button', { name: 'Insert row' }).click()
    await expect(
        page.getByRole('gridcell', { name: 'Designing Data-Intensive Applications' }),
    ).toBeVisible()

    // Query it from the SQL editor.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'SQL', exact: true })
        .click()
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('select count(*) as books from books')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(page.getByRole('columnheader', { name: /books/ })).toBeVisible()
    await expect(page.getByRole('gridcell', { name: '1', exact: true })).toBeVisible()
})
