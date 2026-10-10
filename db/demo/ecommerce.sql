-- DataForge demo dataset: a small e-commerce store.
--
-- Loaded once into the demo template database. Every demo visitor gets a
-- private copy (CREATE DATABASE ... TEMPLATE), so nothing here is shared at
-- runtime. Values are generated with a fixed seed, so every copy is identical.

SELECT setseed(0.42);

-- ── schema ─────────────────────────────────────────────────────────────────

CREATE TABLE users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE,
    full_name varchar(120) NOT NULL,
    country char(2) NOT NULL DEFAULT 'US',
    marketing_opt_in boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS 'Customer accounts.';

CREATE TABLE categories (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(80) NOT NULL UNIQUE,
    slug varchar(80) NOT NULL UNIQUE,
    parent_id integer REFERENCES categories (id) ON DELETE SET NULL
);

COMMENT ON TABLE categories IS 'Product taxonomy. Top-level categories have no parent.';

CREATE TABLE products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id integer NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    sku varchar(32) NOT NULL UNIQUE,
    name varchar(160) NOT NULL,
    description text,
    price numeric(10, 2) NOT NULL CHECK (price >= 0),
    stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_category_idx ON products (category_id);

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status varchar(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded')),
    total numeric(12, 2) NOT NULL DEFAULT 0,
    placed_at timestamptz NOT NULL DEFAULT now(),
    shipped_on date
);

CREATE INDEX orders_user_idx ON orders (user_id);
CREATE INDEX orders_placed_at_idx ON orders (placed_at);

CREATE TABLE order_items (
    order_id bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(10, 2) NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    provider varchar(20) NOT NULL CHECK (provider IN ('card', 'paypal', 'bank_transfer', 'gift_card')),
    amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
    status varchar(20) NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'refunded')),
    paid_at timestamptz,
    metadata jsonb
);

CREATE INDEX payments_order_idx ON payments (order_id);

CREATE VIEW order_summaries AS
SELECT
    o.id,
    o.public_id,
    u.email,
    o.status,
    o.total,
    count(oi.product_id) AS line_count,
    o.placed_at
FROM orders o
JOIN users u ON u.id = o.user_id
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id, u.email;

-- ── data ───────────────────────────────────────────────────────────────────

-- Random picks are made in a subquery's select list: PostgreSQL never
-- flattens a subquery whose outputs call volatile functions, so random() runs
-- once per row instead of once per statement.

-- Customers: 600 accounts spread over the two years before the demo date.
INSERT INTO users (email, full_name, country, marketing_opt_in, created_at)
SELECT
    lower(fn) || '.' || lower(ln) || n || '@example.com',
    fn || ' ' || ln,
    country,
    opt_in,
    signed_up
FROM (
    SELECT
        n,
        (ARRAY[
            'Ava', 'Liam', 'Maya', 'Noah', 'Sofia', 'Ethan', 'Isla', 'Lucas', 'Zara', 'Mateo',
            'Chloe', 'Leo', 'Amara', 'Hugo', 'Nina', 'Omar', 'Elena', 'Kai', 'Ines', 'Theo',
            'Priya', 'Felix', 'Lena', 'Diego', 'Yuki', 'Jonas', 'Aisha', 'Marco', 'Freya', 'Ravi'
        ])[1 + floor(random() * 30)::int] AS fn,
        (ARRAY[
            'Silva', 'Chen', 'Novak', 'Okafor', 'Larsen', 'Moreau', 'Kowalski', 'Haddad', 'Rossi',
            'Tanaka', 'Fischer', 'Costa', 'Patel', 'Nguyen', 'Andersen', 'Garcia', 'Murphy',
            'Schmidt', 'Ivanova', 'Kim', 'Dubois', 'Mendes', 'Ali', 'Berg'
        ])[1 + floor(random() * 24)::int] AS ln,
        (ARRAY['US', 'US', 'US', 'GB', 'DE', 'FR', 'PT', 'ES', 'CA', 'NL', 'BR', 'JP'])[1 + floor(random() * 12)::int] AS country,
        random() < 0.35 AS opt_in,
        timestamptz '2024-10-01 09:00:00+00' + random() * interval '700 days' AS signed_up
    FROM generate_series(1, 600) AS n
) AS picked
ORDER BY signed_up;

INSERT INTO categories (name, slug) VALUES
    ('Electronics', 'electronics'),
    ('Home & Kitchen', 'home-kitchen'),
    ('Outdoors', 'outdoors'),
    ('Books', 'books');

INSERT INTO categories (name, slug, parent_id)
SELECT child.name, child.slug, parent.id
FROM (VALUES
    ('Audio', 'audio', 'electronics'),
    ('Computing', 'computing', 'electronics'),
    ('Cameras', 'cameras', 'electronics'),
    ('Cookware', 'cookware', 'home-kitchen'),
    ('Coffee', 'coffee', 'home-kitchen'),
    ('Camping', 'camping', 'outdoors'),
    ('Cycling', 'cycling', 'outdoors'),
    ('Fiction', 'fiction', 'books'),
    ('Technical', 'technical', 'books')
) AS child (name, slug, parent_slug)
JOIN categories parent ON parent.slug = child.parent_slug;

-- Products: 30 per leaf category, named from a per-category vocabulary.
INSERT INTO products (category_id, sku, name, description, price, stock, attributes, is_active, created_at)
SELECT
    category_id,
    upper(slug) || '-' || lpad(n::text, 4, '0'),
    adj || ' ' || noun,
    'The ' || adj || ' ' || lower(noun) || ', part of our ' || category_name || ' range.',
    price,
    stock,
    attributes,
    is_active,
    created_at
FROM (
    SELECT
        c.id AS category_id,
        c.name AS category_name,
        vocab.slug,
        n,
        (ARRAY[
            'Aero', 'Nordic', 'Summit', 'Ember', 'Atlas', 'Lumen', 'Drift', 'Vale', 'Orbit',
            'Cobalt', 'Juniper', 'Tide', 'Granite', 'Willow', 'Halo'
        ])[1 + floor(random() * 15)::int] AS adj,
        vocab.nouns[1 + floor(random() * array_length(vocab.nouns, 1))::int] AS noun,
        round((vocab.price_low + random() * (vocab.price_high - vocab.price_low))::numeric, 0) - 0.01 AS price,
        floor(random() * 250)::int AS stock,
        jsonb_build_object(
            'color', (ARRAY['black', 'white', 'sand', 'olive', 'slate'])[1 + floor(random() * 5)::int],
            'weight_g', 100 + floor(random() * 4000)::int,
            'warranty_months', (ARRAY[6, 12, 24])[1 + floor(random() * 3)::int]
        ) AS attributes,
        random() > 0.06 AS is_active,
        timestamptz '2024-09-01 00:00:00+00' + random() * interval '600 days' AS created_at
    FROM (VALUES
        ('audio', ARRAY['Headphones', 'Earbuds', 'Speaker', 'Soundbar', 'Turntable', 'DAC'], 29, 449),
        ('computing', ARRAY['Keyboard', 'Mouse', 'Monitor', 'Dock', 'SSD', 'Webcam'], 19, 899),
        ('cameras', ARRAY['Mirrorless Body', 'Prime Lens', 'Tripod', 'Camera Bag', 'Flash'], 39, 1899),
        ('cookware', ARRAY['Skillet', 'Dutch Oven', 'Saucepan', 'Wok', 'Knife Set'], 24, 329),
        ('coffee', ARRAY['Grinder', 'Kettle', 'Pour-Over Set', 'Espresso Machine', 'Scale'], 15, 1199),
        ('camping', ARRAY['Tent', 'Sleeping Bag', 'Stove', 'Headlamp', 'Backpack'], 12, 599),
        ('cycling', ARRAY['Helmet', 'Bike Light', 'Saddle', 'Pump', 'Bike Lock'], 14, 249),
        ('fiction', ARRAY['Novel', 'Short Stories', 'Anthology', 'Graphic Novel'], 9, 39),
        ('technical', ARRAY['Handbook', 'Field Guide', 'Reference', 'Workbook'], 19, 79)
    ) AS vocab (slug, nouns, price_low, price_high)
    JOIN categories c ON c.slug = vocab.slug
    CROSS JOIN generate_series(1, 30) AS n
) AS picked
ORDER BY created_at;

-- Orders: up to twelve per customer, each placed after the customer signed
-- up. The order count per customer is drawn per customer (the series bound
-- references u.id, which makes it correlated).
INSERT INTO orders (user_id, status, placed_at)
SELECT
    user_id,
    CASE
        WHEN r < 0.05 THEN 'pending'
        WHEN r < 0.15 THEN 'paid'
        WHEN r < 0.30 THEN 'shipped'
        WHEN r < 0.90 THEN 'delivered'
        WHEN r < 0.96 THEN 'cancelled'
        ELSE 'refunded'
    END,
    placed_at
FROM (
    SELECT
        u.id AS user_id,
        random() AS r,
        u.created_at + random() * (timestamptz '2026-09-30 00:00:00+00' - u.created_at) AS placed_at
    FROM users u
    CROSS JOIN LATERAL generate_series(1, 1 + floor(random() * 12)::int + (u.id * 0)::int) AS n
) AS picked
ORDER BY placed_at;

-- Order lines: one to four distinct products per order.
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT DISTINCT ON (order_id, product_id)
    order_id,
    product_id,
    1 + floor(random() * 3)::int,
    p.price
FROM (
    SELECT
        o.id AS order_id,
        1 + floor(random() * 270)::bigint AS product_id
    FROM orders o
    CROSS JOIN LATERAL generate_series(1, 1 + floor(random() * 4)::int + (o.id * 0)::int) AS line
) AS picked
JOIN products p ON p.id = picked.product_id
ORDER BY order_id, product_id;

UPDATE orders o
SET total = lines.total
FROM (
    SELECT order_id, sum(quantity * unit_price) AS total
    FROM order_items
    GROUP BY order_id
) AS lines
WHERE lines.order_id = o.id;

UPDATE orders
SET shipped_on = (placed_at + interval '1 day' * (1 + floor(random() * 4)))::date
WHERE status IN ('shipped', 'delivered', 'refunded');

-- Payments: one per order that reached checkout, plus a failed first attempt
-- on a few of them.
INSERT INTO payments (order_id, provider, amount, status, paid_at, metadata)
SELECT
    o.id,
    (ARRAY['card', 'card', 'card', 'paypal', 'bank_transfer', 'gift_card'])[1 + floor(random() * 6)::int],
    o.total,
    CASE o.status WHEN 'refunded' THEN 'refunded' WHEN 'paid' THEN 'authorized' ELSE 'captured' END,
    o.placed_at + interval '3 minutes',
    jsonb_build_object('risk_score', round(random()::numeric, 3), 'three_ds', random() > 0.4)
FROM orders o
WHERE o.status NOT IN ('pending', 'cancelled')
ORDER BY o.id;

INSERT INTO payments (order_id, provider, amount, status, paid_at, metadata)
SELECT
    o.id,
    'card',
    o.total,
    'failed',
    NULL,
    jsonb_build_object('decline_code', (ARRAY['insufficient_funds', 'expired_card', 'do_not_honor'])[1 + floor(random() * 3)::int])
FROM orders o
WHERE o.status <> 'pending' AND random() < 0.04
ORDER BY o.id;

ANALYZE users, categories, products, orders, order_items, payments;
