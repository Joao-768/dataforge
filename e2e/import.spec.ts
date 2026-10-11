import { expect, test } from '@playwright/test'

test('imports a CSV with a bad row skipped and reported', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Explore the live demo' }).first().click()
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
    await page
        .getByRole('navigation', { name: 'Project sections' })
        .getByRole('link', { name: 'Import / Export', exact: true })
        .click()

    await page.getByLabel('CSV file').setInputFiles({
        name: 'categories.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('name,slug\nGarden,garden\nDuplicate,audio\nToys,toys\n'),
    })
    // The file name matches the table, so table and columns are mapped automatically.
    await expect(page.getByRole('combobox').first()).toHaveValue('public.categories')
    await expect(page.getByLabel('Source for slug')).toHaveValue('1')
    await page.getByText('Skip invalid rows').click()
    await page.getByRole('button', { name: /Import into categories/ }).click()
    await expect(page.getByText('Imported 2 of 3 rows')).toBeVisible()
    await expect(page.getByText(/categories_slug_key/)).toBeVisible()
})
