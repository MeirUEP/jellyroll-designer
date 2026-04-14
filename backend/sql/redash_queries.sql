-- ============================================================
-- REDASH QUERIES FOR INVENTORY MANAGEMENT
-- Connect Redash to: postgresql://postgres:...@143.198.122.92:5432/jellyroll
-- ============================================================

-- ==================== DASHBOARD VIEWS ====================

-- 1. Current Stock Overview (main dashboard table)
SELECT
    name,
    category,
    quantity,
    unit,
    package_unit,
    package_size,
    CASE
        WHEN package_size > 0 THEN ROUND((quantity / package_size)::numeric, 1)
        ELSE NULL
    END AS packages_on_hand,
    reorder_point,
    CASE
        WHEN reorder_point IS NOT NULL AND quantity <= reorder_point THEN 'LOW'
        ELSE 'OK'
    END AS status,
    location,
    lot_number,
    updated_at
FROM inventory_items
ORDER BY category, name;


-- 2. Stock by Category (pie/bar chart)
SELECT
    category,
    COUNT(*) AS item_count,
    SUM(quantity) AS total_qty
FROM inventory_items
GROUP BY category
ORDER BY category;


-- 3. Low Stock Alerts
SELECT name, category, quantity, unit, reorder_point,
       ROUND((quantity - reorder_point)::numeric, 1) AS deficit
FROM inventory_items
WHERE reorder_point IS NOT NULL
  AND quantity <= reorder_point
ORDER BY (quantity - reorder_point);


-- 4. Transaction History (last 30 days)
SELECT
    t.created_at,
    i.name AS item,
    i.category,
    t.qty_change,
    i.unit,
    t.reason,
    t.batch_id,
    t.performed_by,
    t.notes
FROM inventory_transactions t
JOIN inventory_items i ON i.id = t.inventory_item_id
WHERE t.created_at >= NOW() - INTERVAL '30 days'
ORDER BY t.created_at DESC;


-- 5. Consumption by Batch (production tracking)
SELECT
    t.batch_id,
    t.created_at::date AS date,
    i.name AS material,
    ABS(t.qty_change) AS consumed,
    i.unit,
    t.notes
FROM inventory_transactions t
JOIN inventory_items i ON i.id = t.inventory_item_id
WHERE t.reason = 'production'
  AND t.batch_id IS NOT NULL
ORDER BY t.created_at DESC;


-- ==================== DATA ENTRY QUERIES ====================
-- Use Redash parameterized queries with dropdowns

-- 6. Receive Material (use as parameterized query)
-- Parameters: {{item_name}} (dropdown from inventory_items), {{qty}}, {{performed_by}}, {{notes}}
/*
WITH target AS (
    SELECT id, quantity FROM inventory_items WHERE name = '{{item_name}}'
)
INSERT INTO inventory_transactions (inventory_item_id, qty_change, reason, performed_by, notes)
SELECT id, {{qty}}, 'received', '{{performed_by}}', '{{notes}}'
FROM target;

UPDATE inventory_items SET quantity = quantity + {{qty}}, updated_at = NOW()
WHERE name = '{{item_name}}';
*/


-- 7. Record Physical Count (use as parameterized query)
-- Parameters: {{item_name}} (dropdown), {{counted_qty}}, {{performed_by}}
/*
WITH target AS (
    SELECT id, quantity FROM inventory_items WHERE name = '{{item_name}}'
)
INSERT INTO inventory_transactions (inventory_item_id, qty_change, reason, performed_by, notes)
SELECT id, {{counted_qty}} - quantity, 'count', '{{performed_by}}',
       'Physical count: ' || {{counted_qty}} || ' (was ' || quantity || ')'
FROM target;

UPDATE inventory_items SET quantity = {{counted_qty}}, updated_at = NOW()
WHERE name = '{{item_name}}';
*/


-- 8. Record Scrap/Waste
-- Parameters: {{item_name}}, {{qty_scrapped}}, {{performed_by}}, {{notes}}
/*
WITH target AS (
    SELECT id FROM inventory_items WHERE name = '{{item_name}}'
)
INSERT INTO inventory_transactions (inventory_item_id, qty_change, reason, performed_by, notes)
SELECT id, -{{qty_scrapped}}, 'scrap', '{{performed_by}}', '{{notes}}'
FROM target;

UPDATE inventory_items SET quantity = quantity - {{qty_scrapped}}, updated_at = NOW()
WHERE name = '{{item_name}}';
*/


-- 9. Dropdown source: Item Names (use as Redash dropdown query)
SELECT name FROM inventory_items ORDER BY category, name;


-- 10. Monthly Inventory Trend (for a specific item)
-- Parameter: {{item_name}}
/*
SELECT
    DATE_TRUNC('month', t.created_at) AS month,
    SUM(CASE WHEN t.qty_change > 0 THEN t.qty_change ELSE 0 END) AS received,
    SUM(CASE WHEN t.qty_change < 0 THEN ABS(t.qty_change) ELSE 0 END) AS consumed,
    SUM(t.qty_change) AS net_change
FROM inventory_transactions t
JOIN inventory_items i ON i.id = t.inventory_item_id
WHERE i.name = '{{item_name}}'
GROUP BY DATE_TRUNC('month', t.created_at)
ORDER BY month;
*/
