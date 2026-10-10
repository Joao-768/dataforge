// Example queries saved into every demo project and offered to new e-commerce
// sandboxes. Each one is chosen to show something specific.

export const EXAMPLE_QUERIES: { name: string; sql: string }[] = [
    {
        name: 'Revenue by month',
        sql: `-- Monthly revenue from delivered and shipped orders
SELECT date_trunc('month', placed_at)::date AS month,
       count(*) AS orders,
       sum(total) AS revenue,
       round(avg(total), 2) AS average_order
FROM orders
WHERE status IN ('shipped', 'delivered')
GROUP BY 1
ORDER BY 1 DESC
LIMIT 12;`,
    },
    {
        name: 'Top customers',
        sql: `-- Customers ranked by lifetime spend
SELECT u.full_name,
       u.email,
       u.country,
       count(o.id) AS orders,
       sum(o.total) AS lifetime_value,
       rank() OVER (ORDER BY sum(o.total) DESC) AS rank
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY u.id
ORDER BY lifetime_value DESC
LIMIT 20;`,
    },
    {
        name: 'Best-selling products by category',
        sql: `-- Top three products in each category (window function)
WITH sales AS (
    SELECT c.name AS category,
           p.name AS product,
           sum(oi.quantity) AS units,
           row_number() OVER (PARTITION BY c.id ORDER BY sum(oi.quantity) DESC) AS position
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN categories c ON c.id = p.category_id
    GROUP BY c.id, c.name, p.id, p.name
)
SELECT category, product, units
FROM sales
WHERE position <= 3
ORDER BY category, position;`,
    },
    {
        name: 'Payment failure rate by provider',
        sql: `-- Share of failed payment attempts per provider
SELECT provider,
       count(*) AS attempts,
       count(*) FILTER (WHERE status = 'failed') AS failures,
       round(100.0 * count(*) FILTER (WHERE status = 'failed') / count(*), 2) AS failure_pct
FROM payments
GROUP BY provider
ORDER BY failure_pct DESC;`,
    },
    {
        name: 'Low stock, still selling',
        sql: `-- Active products under 20 units that sold in the last 90 days
SELECT p.sku, p.name, p.stock, sum(oi.quantity) AS sold_90d
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o ON o.id = oi.order_id
WHERE p.is_active
  AND p.stock < 20
  AND o.placed_at > now() - interval '90 days'
GROUP BY p.id
ORDER BY sold_90d DESC;`,
    },
    {
        name: 'JSON attributes',
        sql: `-- Query inside jsonb: products by colour and warranty
SELECT attributes ->> 'color' AS color,
       (attributes ->> 'warranty_months')::int AS warranty_months,
       count(*) AS products,
       round(avg(price), 2) AS average_price
FROM products
GROUP BY 1, 2
ORDER BY 1, 2;`,
    },
]
