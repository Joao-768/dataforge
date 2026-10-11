# Demo walkthrough

A two-to-three minute path through DataForge that shows each capability against a real database. It works on a fresh `docker compose up --build`.

## 1. Landing (10 s)

Open http://localhost:3300. Scroll once to show the workflow section (canvas, generated SQL, transactional apply), then click **Explore the live demo**.

## 2. Overview (10 s)

The *Storefront* project opens on its own copy of the e-commerce database: 6 tables, about 17,700 rows, 6 relationships. Point at **Sandbox ready** and the PostgreSQL version in the project bar.

## 3. Schema designer (40 s)

- Open **Designer**. The tables arrive auto-arranged with crow's-foot relationships.
- Click `payments` to show the inspector; click the dashed `categories.parent_id` loop (optional self-reference).
- Press **T** to add a table, rename it `reviews`, add columns `rating` (smallint, default 5) and `body` (text).
- In the inspector, **Reference a table… → products → Add**: DataForge adds `product_id bigint` and the foreign key. Click the new relationship and set **On delete** to CASCADE. (Dragging from a column's dot onto another table's key does the same for existing columns.)
- Show **Undo/Redo**, then **Review migration**: the generated `CREATE TABLE` and `ALTER TABLE … ADD CONSTRAINT`, step by step.

## 4. Migration (20 s)

Create the migration, then **Apply**. It runs in one transaction and turns **Applied** with its duration. Back in the designer, the draft reads *In sync with the database*.

## 5. SQL editor (40 s)

- Open **SQL**, then **Saved → Best-selling products by category** (a window function). Run it with **⌘/Ctrl+Enter**.
- **Explain → EXPLAIN ANALYZE**: confirm, and walk through the plan: the most expensive step highlighted, estimated against actual rows.
- Type `delete from payments` and run it in **Read** mode: PostgreSQL refuses it (`cannot execute DELETE in a read-only transaction`).

## 6. Data explorer (20 s)

Open **Data → products**, add the filter `price > 1000`, sort by price, double-click a row to show the JSON attributes, then **+ Row** to insert one and show the constraint error from a negative price.

## 7. Import and analytics (20 s)

- **Import / Export**: drop a `categories.csv`, show the automatic mapping and **Skip invalid rows**; the report lists the duplicate slug by line.
- **Analytics**: the queries just run, p95, the slowest statements, and table and index statistics from `pg_stat_*`.

## Talking points

- Every number on screen comes from PostgreSQL or the app's own history.
- Read-only is enforced by a read-only role and transaction, not by inspecting SQL text.
- Each visitor has a private database; nothing they do affects anyone else, and it disappears after a day.
