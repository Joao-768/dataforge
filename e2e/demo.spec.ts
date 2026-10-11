import { expect, test } from '@playwright/test'

test('a visitor explores the demo: schema, a saved query, data and a plan', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Draw the schema/ })).toBeVisible()
    await page.getByRole('button', { name: 'Explore the live demo' }).first().click()

    // Overview of a private, real database.
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: 'Storefront' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'order_items' })).toBeVisible()
    await expect(page.getByText('Sandbox ready').first()).toBeVisible()

    // Designer shows the tables and their relationships on the canvas.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Designer', exact: true })
        .click()
    await expect(page.locator('.react-flow__node')).toHaveCount(6)
    await expect(page.locator('.react-flow__edge')).toHaveCount(6)
    await page.locator('.react-flow__node').filter({ hasText: 'payments' }).click()
    await expect(page.getByLabel('Table name')).toHaveValue('payments')

    // SQL: run one of the saved example queries.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'SQL', exact: true })
        .click()
    await page.getByRole('tab', { name: 'Saved' }).click()
    await page.getByRole('button', { name: /^Revenue by month/ }).click()
    await page.getByRole('button', { name: 'Run all' }).click()
    await expect(page.getByRole('columnheader', { name: /revenue/ })).toBeVisible()
    await expect(page.getByText('ok', { exact: true })).toBeVisible()

    // EXPLAIN the same (single-statement) query: an estimated plan, labelled as such.
    await page.getByRole('button', { name: 'Explain' }).click()
    await page.getByRole('menuitem', { name: /EXPLAIN \(estimated plan\)/ }).click()
    await expect(page.getByText('Estimated plan · EXPLAIN')).toBeVisible()

    // Data explorer: filter on the server and inspect a row.
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Data', exact: true })
        .click()
    await page.getByRole('button', { name: /^products/ }).click()
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByLabel('Filter column').selectOption('price')
    await page.getByLabel('Operator').selectOption('gt')
    await page.getByLabel('Filter value').fill('1000')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText(/^\d+ rows$/)).toBeVisible()
    await page.locator('[role="row"][aria-rowindex="1"]').dblclick()
    await expect(page.getByRole('button', { name: 'Copy as JSON' })).toBeVisible()
})
