"""Inventory management endpoints — stock levels, lots, transactions, recipes, BOM."""
from uuid import UUID
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, distinct, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import (
    InventoryItem, InventoryLot, InventoryTransaction, DesignBOM, ProductRecipe,
    Material, Chemical, Design, SimulationResult,
)
from app.schemas import (
    InventoryItemCreate, InventoryItemUpdate, InventoryItemSchema,
    InventoryLotCreate, InventoryLotUpdate, InventoryLotSchema,
    InventoryTransactionCreate, InventoryTransactionSchema,
    BOMLineSchema, ProductionConsumeRequest,
    RecipeLineCreate, RecipeLineSchema, RecipeBulkCreate,
    ProductionLogRequest, ProductionPreview, ProductionPreviewLine,
    ReceiveShipmentRequest, PhysicalCountRequest,
)

router = APIRouter(tags=["inventory"], dependencies=[Depends(verify_api_key)])


# ==================== INVENTORY ITEMS ====================

@router.get("/inventory", response_model=list[InventoryItemSchema])
async def list_inventory(
    category: str | None = Query(None, description="Filter by category"),
    db: AsyncSession = Depends(get_db),
):
    q = select(InventoryItem).order_by(InventoryItem.category, InventoryItem.name)
    if category:
        q = q.where(InventoryItem.category == category)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/inventory", response_model=InventoryItemSchema, status_code=201)
async def create_inventory_item(data: InventoryItemCreate, db: AsyncSession = Depends(get_db)):
    item = InventoryItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


# NOTE: literal-path GETs (summary, low-stock) MUST be declared before
# /inventory/{item_id} so FastAPI doesn't try to parse "summary" as a UUID.
@router.get("/inventory/summary")
async def inventory_summary(db: AsyncSession = Depends(get_db)):
    """Summary grouped by category."""
    result = await db.execute(
        select(
            InventoryItem.category,
            func.count(InventoryItem.id).label("item_count"),
            func.sum(InventoryItem.quantity).label("total_qty"),
        )
        .group_by(InventoryItem.category)
        .order_by(InventoryItem.category)
    )
    return [
        {"category": r.category, "item_count": r.item_count, "total_qty": r.total_qty}
        for r in result.all()
    ]


@router.get("/inventory/low-stock")
async def low_stock_alerts(db: AsyncSession = Depends(get_db)):
    """Items where quantity is at or below reorder point."""
    result = await db.execute(
        select(InventoryItem)
        .where(InventoryItem.reorder_point.isnot(None))
        .where(InventoryItem.quantity <= InventoryItem.reorder_point)
        .order_by(InventoryItem.category, InventoryItem.name)
    )
    return result.scalars().all()


# Phase 8: Operational dashboard endpoints
# These literal-path GETs MUST be declared before /inventory/{item_id}.

@router.get("/inventory/transactions")
async def list_all_transactions(
    limit: int = Query(50, le=500, description="Max rows to return"),
    offset: int = Query(0, ge=0, description="Skip this many rows for pagination"),
    item_id: UUID | None = Query(None, description="Filter to one inventory item"),
    reason: str | None = Query(None, description="received | production | scrap | count | adjustment | return"),
    since: datetime | None = Query(None, description="ISO timestamp — return rows >= this"),
    until: datetime | None = Query(None, description="ISO timestamp — return rows < this"),
    db: AsyncSession = Depends(get_db),
):
    """Paginated, filterable transaction ledger across all items.
    Joined with item name + lot number for the dashboard activity feed.
    """
    q = (
        select(
            InventoryTransaction,
            InventoryItem.name.label("item_name"),
            InventoryLot.lot_number.label("lot_number"),
        )
        .join(InventoryItem, InventoryTransaction.inventory_item_id == InventoryItem.id)
        .outerjoin(InventoryLot, InventoryTransaction.inventory_lot_id == InventoryLot.id)
        .order_by(InventoryTransaction.created_at.desc())
    )
    if item_id is not None:
        q = q.where(InventoryTransaction.inventory_item_id == item_id)
    if reason:
        q = q.where(InventoryTransaction.reason == reason)
    if since is not None:
        q = q.where(InventoryTransaction.created_at >= since)
    if until is not None:
        q = q.where(InventoryTransaction.created_at < until)
    q = q.limit(limit).offset(offset)

    result = await db.execute(q)
    rows = result.all()
    return [
        {
            "id": str(t.id),
            "inventory_item_id": str(t.inventory_item_id),
            "inventory_item_name": item_name,
            "inventory_lot_id": str(t.inventory_lot_id) if t.inventory_lot_id else None,
            "lot_number": lot_number,
            "qty_change": t.qty_change,
            "reason": t.reason,
            "batch_id": t.batch_id,
            "design_id": str(t.design_id) if t.design_id else None,
            "performed_by": t.performed_by,
            "notes": t.notes,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t, item_name, lot_number in rows
    ]


@router.get("/inventory/consumption-stats")
async def consumption_stats(
    days: int = Query(30, ge=1, le=730, description="Trailing window in days"),
    db: AsyncSession = Depends(get_db),
):
    """Per-item average daily consumption over the last `days` days. Powers
    the Reorder tab on the dashboard. Counts only outflow transactions
    (`reason in ('production','scrap')` with `qty_change < 0`). Items
    with no consumption in window are returned with `daily_use = 0`.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    txn_join = and_(
        InventoryTransaction.inventory_item_id == InventoryItem.id,
        InventoryTransaction.reason.in_(["production", "scrap"]),
        InventoryTransaction.qty_change < 0,
        InventoryTransaction.created_at >= cutoff,
    )
    q = (
        select(
            InventoryItem.id,
            InventoryItem.name,
            InventoryItem.unit,
            InventoryItem.quantity,
            InventoryItem.reorder_point,
            InventoryItem.lead_time_days,
            func.coalesce(func.sum(func.abs(InventoryTransaction.qty_change)), 0).label("qty_consumed"),
            func.count(InventoryTransaction.id).label("txn_count"),
            func.max(InventoryTransaction.created_at).label("last_consumed_at"),
        )
        .join(InventoryTransaction, txn_join, isouter=True)
        .group_by(
            InventoryItem.id, InventoryItem.name, InventoryItem.unit,
            InventoryItem.quantity, InventoryItem.reorder_point, InventoryItem.lead_time_days,
        )
    )
    result = await db.execute(q)
    rows = result.all()
    out = []
    for r in rows:
        qty_consumed = float(r.qty_consumed or 0)
        daily = qty_consumed / days if days > 0 else 0.0
        out.append({
            "inventory_item_id": str(r.id),
            "name": r.name,
            "unit": r.unit,
            "quantity": float(r.quantity or 0),
            "reorder_point": float(r.reorder_point) if r.reorder_point is not None else None,
            "lead_time_days": int(r.lead_time_days) if r.lead_time_days is not None else None,
            "qty_consumed": qty_consumed,
            "txn_count": int(r.txn_count or 0),
            "last_consumed_at": r.last_consumed_at.isoformat() if r.last_consumed_at else None,
            "days": days,
            "daily_use": daily,
        })
    return out


@router.get("/inventory/{item_id}", response_model=InventoryItemSchema)
async def get_inventory_item(item_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    return item


@router.put("/inventory/{item_id}", response_model=InventoryItemSchema)
async def update_inventory_item(item_id: UUID, data: InventoryItemUpdate, db: AsyncSession = Depends(get_db)):
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/inventory/{item_id}", status_code=204)
async def delete_inventory_item(item_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")
    await db.delete(item)
    await db.commit()


# ==================== INVENTORY LOTS (Phase 1) ====================

async def _find_or_create_lot(
    db: AsyncSession,
    item_id: UUID,
    lot_number: str | None,
    supplier: str | None = None,
    qty_to_add: float = 0,
) -> InventoryLot:
    """Idempotent helper. Returns the lot for (item, lot_number) — finds existing or creates new.
    `lot_number=None` or empty string is normalized to 'unspecified'.
    `qty_to_add` is appended to qty_received and qty_remaining if > 0.
    Caller is responsible for committing.
    """
    normalized = (lot_number or "").strip() or "unspecified"
    q = await db.execute(
        select(InventoryLot)
        .where(InventoryLot.inventory_item_id == item_id)
        .where(InventoryLot.lot_number == normalized)
    )
    lot = q.scalar_one_or_none()
    if lot:
        if qty_to_add:
            lot.qty_received += qty_to_add
            lot.qty_remaining += qty_to_add
        if supplier and not lot.supplier:
            lot.supplier = supplier
    else:
        lot = InventoryLot(
            inventory_item_id=item_id,
            lot_number=normalized,
            supplier=supplier,
            qty_received=qty_to_add,
            qty_remaining=qty_to_add,
        )
        db.add(lot)
        await db.flush()  # ensure lot.id is available for transaction FK
    return lot


@router.get("/inventory/{item_id}/lots", response_model=list[InventoryLotSchema])
async def list_lots_for_item(item_id: UUID, db: AsyncSession = Depends(get_db)):
    """Lots for one inventory item, sorted oldest-received first (FIFO order)."""
    if not await db.get(InventoryItem, item_id):
        raise HTTPException(404, "Inventory item not found")
    result = await db.execute(
        select(InventoryLot)
        .where(InventoryLot.inventory_item_id == item_id)
        .order_by(InventoryLot.received_date.asc(), InventoryLot.created_at.asc())
    )
    return result.scalars().all()


@router.get("/inventory/lots/{lot_id}", response_model=InventoryLotSchema)
async def get_lot(lot_id: UUID, db: AsyncSession = Depends(get_db)):
    lot = await db.get(InventoryLot, lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    return lot


@router.put("/inventory/lots/{lot_id}", response_model=InventoryLotSchema)
async def update_lot(lot_id: UUID, data: InventoryLotUpdate, db: AsyncSession = Depends(get_db)):
    """Adjust a specific lot. Modifying qty_remaining triggers the
    sync_inventory_quantity DB trigger which recomputes inventory_items.quantity.
    For audit trail, callers should also POST an /inventory/transactions entry
    referencing this lot.
    """
    lot = await db.get(InventoryLot, lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(lot, k, v)
    await db.commit()
    await db.refresh(lot)
    return lot


@router.delete("/inventory/lots/{lot_id}", status_code=204)
async def delete_lot(lot_id: UUID, db: AsyncSession = Depends(get_db)):
    lot = await db.get(InventoryLot, lot_id)
    if not lot:
        raise HTTPException(404, "Lot not found")
    await db.delete(lot)
    await db.commit()


# ==================== INVENTORY TRANSACTIONS ====================

@router.get("/inventory/{item_id}/transactions", response_model=list[InventoryTransactionSchema])
async def list_transactions(item_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InventoryTransaction)
        .where(InventoryTransaction.inventory_item_id == item_id)
        .order_by(InventoryTransaction.created_at.desc())
    )
    return result.scalars().all()


@router.post("/inventory/transactions", response_model=InventoryTransactionSchema, status_code=201)
async def create_transaction(data: InventoryTransactionCreate, db: AsyncSession = Depends(get_db)):
    """Generic transaction creation. As of Phase 1, prefer /receive, /physical-count,
    or /production/log which manage lots automatically. This endpoint is kept for
    audit/manual use; callers SHOULD pass inventory_lot_id to maintain lot integrity.
    If lot_id is given, qty_remaining on that lot is adjusted by qty_change.
    """
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    if data.inventory_lot_id:
        lot = await db.get(InventoryLot, data.inventory_lot_id)
        if not lot or lot.inventory_item_id != data.inventory_item_id:
            raise HTTPException(400, "Lot does not belong to this item")
        lot.qty_remaining += data.qty_change

    txn = InventoryTransaction(**data.model_dump())
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== PHYSICAL COUNT (reconciliation) ====================

@router.post("/inventory/{item_id}/count", response_model=InventoryTransactionSchema, status_code=201)
async def record_physical_count(
    item_id: UUID,
    counted_qty: float = Query(..., description="Actual counted quantity"),
    performed_by: str | None = Query(None),
    notes: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Record a physical count of an item's TOTAL stock — adjusts the 'unspecified'
    lot to reconcile. For lot-specific counts, use PUT /inventory/lots/{lot_id} instead.
    """
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    diff = counted_qty - item.quantity
    lot = await _find_or_create_lot(db, item_id, "unspecified", qty_to_add=0)
    lot.qty_remaining += diff  # trigger updates item.quantity

    txn = InventoryTransaction(
        inventory_item_id=item_id,
        inventory_lot_id=lot.id,
        qty_change=diff,
        reason="count",
        performed_by=performed_by,
        notes=notes or f"Physical count: {counted_qty} {item.unit} (was {item.quantity})",
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== DESIGN BOM ====================

@router.get("/designs/{design_id}/bom", response_model=list[BOMLineSchema])
async def get_design_bom(design_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DesignBOM)
        .where(DesignBOM.design_id == design_id)
        .order_by(DesignBOM.role, DesignBOM.layer_name)
    )
    lines = []
    for bom in result.scalars().all():
        d = {
            "id": bom.id,
            "design_id": bom.design_id,
            "inventory_item_id": bom.inventory_item_id,
            "material_id": bom.material_id,
            "layer_name": bom.layer_name,
            "role": bom.role,
            "qty_per_cell": bom.qty_per_cell,
            "unit": bom.unit,
            "notes": bom.notes,
            "created_at": bom.created_at,
            "material_name": None,
            "inventory_item_name": None,
        }
        # Resolve names
        if bom.material_id:
            mat = await db.get(Material, bom.material_id)
            if mat:
                d["material_name"] = mat.name
        if bom.inventory_item_id:
            inv = await db.get(InventoryItem, bom.inventory_item_id)
            if inv:
                d["inventory_item_name"] = inv.name
        lines.append(BOMLineSchema(**d))
    return lines


@router.post("/designs/{design_id}/bom/generate", response_model=list[BOMLineSchema])
async def generate_bom(design_id: UUID, db: AsyncSession = Depends(get_db)):
    """Auto-generate BOM from a design's simulation results and layer stack."""
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")

    sim_result = await db.execute(
        select(SimulationResult).where(SimulationResult.design_id == design_id)
    )
    sim = sim_result.scalar_one_or_none()
    if not sim:
        raise HTTPException(400, "No simulation result found — run simulation first")

    design_layers = design.layers or []
    if not design_layers:
        raise HTTPException(400, "Design has no layer data")

    # Delete existing BOM
    existing = await db.execute(select(DesignBOM).where(DesignBOM.design_id == design_id))
    for row in existing.scalars().all():
        await db.delete(row)

    bom_lines = []

    for layer in design_layers:
        layer_name = layer.get("name", "Unknown")
        layer_type = layer.get("type", "other")
        computed_len = layer.get("computedLen") or layer.get("len") or 0
        layer_width = layer.get("w", 0)
        layer_thickness = layer.get("t", 0)

        if layer_type == "mandrel":
            continue

        # Try to find matching design material
        mat_result = await db.execute(
            select(Material).where(Material.name == layer_name)
        )
        mat = mat_result.scalar_one_or_none()

        # Try to find matching inventory item
        inv_result = await db.execute(
            select(InventoryItem).where(InventoryItem.name == layer_name)
        )
        inv_item = inv_result.scalar_one_or_none()

        if not mat and not inv_item:
            continue  # skip layers without matching records

        if computed_len > 0:
            bom_line = DesignBOM(
                design_id=design_id,
                material_id=mat.id if mat else None,
                inventory_item_id=inv_item.id if inv_item else None,
                layer_name=layer_name,
                role=layer_type,
                qty_per_cell=round(computed_len, 1),
                unit="mm",
                notes=f"{layer_width}mm wide x {layer_thickness}mm thick",
            )
            db.add(bom_line)
            bom_lines.append(bom_line)

    # Tab counts
    c_tabs = sim.c_tabs or []
    a_tabs = sim.a_tabs or []
    if c_tabs:
        bom_line = DesignBOM(
            design_id=design_id,
            layer_name="Cathode tabs",
            role="cathode",
            qty_per_cell=len(c_tabs),
            unit="each",
            notes="Welded tabs",
        )
        db.add(bom_line)
        bom_lines.append(bom_line)

    if a_tabs:
        bom_line = DesignBOM(
            design_id=design_id,
            layer_name="Anode tabs",
            role="anode",
            qty_per_cell=len(a_tabs),
            unit="each",
            notes="Welded tabs",
        )
        db.add(bom_line)
        bom_lines.append(bom_line)

    await db.commit()
    return await get_design_bom(design_id, db)


# ==================== PRODUCTION CONSUMPTION (BOM-driven) ====================

@router.post("/inventory/consume", response_model=list[InventoryTransactionSchema])
async def consume_for_production(data: ProductionConsumeRequest, db: AsyncSession = Depends(get_db)):
    """Consume inventory based on design BOM x cell count, using FIFO across lots.
    Updated in Phase 1 to walk inventory_lots oldest-first instead of mutating
    inventory_items.quantity directly. One transaction per (BOM line × lot).
    """
    bom_result = await db.execute(
        select(DesignBOM).where(DesignBOM.design_id == data.design_id)
    )
    bom_lines = bom_result.scalars().all()
    if not bom_lines:
        raise HTTPException(400, "No BOM found for this design — generate BOM first")

    transactions: list[InventoryTransaction] = []
    for bom in bom_lines:
        if not bom.inventory_item_id:
            continue  # skip BOM lines not linked to inventory

        inv_item = await db.get(InventoryItem, bom.inventory_item_id)
        if not inv_item:
            continue

        consumed_total = bom.qty_per_cell * data.cell_count

        lots_q = await db.execute(
            select(InventoryLot)
            .where(InventoryLot.inventory_item_id == inv_item.id)
            .where(InventoryLot.qty_remaining > 0)
            .order_by(InventoryLot.received_date.asc(), InventoryLot.created_at.asc())
        )
        lots = lots_q.scalars().all()

        remaining = consumed_total
        for lot in lots:
            if remaining <= 0:
                break
            take = min(lot.qty_remaining, remaining)
            lot.qty_remaining -= take
            remaining -= take

            txn = InventoryTransaction(
                inventory_item_id=inv_item.id,
                inventory_lot_id=lot.id,
                qty_change=-take,
                reason="production",
                batch_id=data.batch_id,
                design_id=data.design_id,
                performed_by=data.performed_by,
                notes=(
                    data.notes
                    or f"{data.cell_count} cells x {bom.qty_per_cell} {bom.unit}/cell "
                       f"({bom.layer_name}, lot {lot.lot_number})"
                ),
            )
            db.add(txn)
            transactions.append(txn)

    await db.commit()
    for txn in transactions:
        await db.refresh(txn)
    return transactions


# ==================== RECEIVE SHIPMENT ====================

@router.post("/inventory/receive", response_model=InventoryTransactionSchema, status_code=201)
async def receive_shipment(data: ReceiveShipmentRequest, db: AsyncSession = Depends(get_db)):
    """Record a received shipment.

    Behavior:
      - If lot_number is provided, finds or creates that lot and appends qty.
      - If lot_number is empty, appends to the auto-managed "unspecified" lot
        for this item. (Graceful degradation — partial lot tracking is OK.)
      - inventory_items.quantity is updated by the sync_inventory_quantity
        DB trigger, NOT manually here.
    """
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    qty = abs(data.qty)
    lot = await _find_or_create_lot(
        db, data.inventory_item_id, data.lot_number, supplier=data.supplier, qty_to_add=qty
    )

    txn = InventoryTransaction(
        inventory_item_id=data.inventory_item_id,
        inventory_lot_id=lot.id,
        qty_change=qty,
        reason="received",
        performed_by=data.performed_by,
        notes=data.notes,
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== PHYSICAL COUNT ====================

@router.post("/inventory/physical-count", response_model=InventoryTransactionSchema, status_code=201)
async def physical_count(data: PhysicalCountRequest, db: AsyncSession = Depends(get_db)):
    """Reconcile a physical count to a specific lot.

    If `inventory_lot_id` is provided, that lot's qty_remaining is set to counted_qty.
    If omitted, the count is reconciled against the item's "unspecified" lot — the
    delta vs current total stock is applied to that lot. The DB trigger then
    updates inventory_items.quantity to SUM of all lots.
    """
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    if data.inventory_lot_id:
        lot = await db.get(InventoryLot, data.inventory_lot_id)
        if not lot or lot.inventory_item_id != data.inventory_item_id:
            raise HTTPException(400, "Lot does not belong to this item")
        diff = data.counted_qty - lot.qty_remaining
        lot.qty_remaining = data.counted_qty
    else:
        # No lot specified — reconcile against the unspecified lot
        diff = data.counted_qty - item.quantity
        lot = await _find_or_create_lot(db, data.inventory_item_id, "unspecified", qty_to_add=0)
        lot.qty_remaining += diff

    txn = InventoryTransaction(
        inventory_item_id=data.inventory_item_id,
        inventory_lot_id=lot.id,
        qty_change=diff,
        reason="count",
        performed_by=data.performed_by,
        notes=data.notes or f"Physical count: {data.counted_qty} {item.unit} (was {item.quantity})",
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== PRODUCT RECIPES ====================

@router.get("/recipes", response_model=list[RecipeLineSchema])
async def list_recipes(
    product: str | None = Query(None, description="Filter to one product's lines"),
    db: AsyncSession = Depends(get_db),
):
    q = select(ProductRecipe).order_by(ProductRecipe.product, ProductRecipe.component)
    if product:
        q = q.where(ProductRecipe.product == product)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/recipes/products")
async def list_recipe_products(db: AsyncSession = Depends(get_db)):
    """Distinct product names that have recipes defined."""
    result = await db.execute(
        select(distinct(ProductRecipe.product)).order_by(ProductRecipe.product)
    )
    return [r[0] for r in result.all()]


@router.post("/recipes/bulk", response_model=list[RecipeLineSchema], status_code=201)
async def save_recipe_bulk(data: RecipeBulkCreate, db: AsyncSession = Depends(get_db)):
    """Save one product's full recipe — replaces any existing lines for that product."""
    # Delete old lines for this product
    existing = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == data.product)
    )
    for row in existing.scalars().all():
        await db.delete(row)

    # Insert new lines
    new_lines = []
    for line in data.lines:
        rec = ProductRecipe(
            product=data.product,
            component=line["component"],
            qty=float(line["qty"]),
            unit=line["unit"],
            notes=line.get("notes"),
        )
        db.add(rec)
        new_lines.append(rec)

    await db.commit()
    for rec in new_lines:
        await db.refresh(rec)
    return new_lines


@router.post("/recipes", response_model=RecipeLineSchema, status_code=201)
async def add_recipe_line(data: RecipeLineCreate, db: AsyncSession = Depends(get_db)):
    rec = ProductRecipe(**data.model_dump())
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


@router.delete("/recipes/{recipe_id}", status_code=204)
async def delete_recipe_line(recipe_id: UUID, db: AsyncSession = Depends(get_db)):
    rec = await db.get(ProductRecipe, recipe_id)
    if not rec:
        raise HTTPException(404, "Recipe line not found")
    await db.delete(rec)
    await db.commit()


@router.delete("/recipes/product/{product}", status_code=204)
async def delete_all_for_product(product: str, db: AsyncSession = Depends(get_db)):
    """Delete all recipe lines for a product."""
    result = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == product)
    )
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()


# ==================== PRODUCTION (lot-aware FIFO consumption) ====================

async def _resolve_inventory_for_component(
    db: AsyncSession,
    component_name: str,
    selections: dict | None,
) -> InventoryItem | None:
    """Pick the inventory item to consume from for a recipe line.

    Multi-supplier model:
      - If `selections` (component → inventory_item_id) has this component,
        use that specific item.
      - Otherwise, fall back to the first item whose name matches.
    """
    if selections and component_name in selections:
        item = await db.get(InventoryItem, selections[component_name])
        if item:
            return item
    result = await db.execute(
        select(InventoryItem)
        .where(InventoryItem.name == component_name)
        .order_by(InventoryItem.created_at.asc())
    )
    return result.scalars().first()


async def _plan_fifo(
    db: AsyncSession,
    inv_item: InventoryItem,
    qty_needed: float,
) -> tuple[list[dict], float]:
    """Return (allocations, shortfall). Walks lots oldest-first, no mutation."""
    lots_q = await db.execute(
        select(InventoryLot)
        .where(InventoryLot.inventory_item_id == inv_item.id)
        .where(InventoryLot.qty_remaining > 0)
        .order_by(InventoryLot.received_date.asc(), InventoryLot.created_at.asc())
    )
    lots = lots_q.scalars().all()

    allocations = []
    remaining = qty_needed
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.qty_remaining, remaining)
        allocations.append({
            "lot_id": str(lot.id),
            "lot_number": lot.lot_number,
            "supplier": lot.supplier,
            "received_date": lot.received_date.isoformat() if lot.received_date else None,
            "available": lot.qty_remaining,
            "will_consume": take,
        })
        remaining -= take
    shortfall = max(remaining, 0)
    return allocations, shortfall


@router.post("/production/preview", response_model=ProductionPreview)
async def preview_production(data: ProductionLogRequest, db: AsyncSession = Depends(get_db)):
    """Preview which lots would be consumed if this production batch were committed.
    Read-only. Returns shortfalls if stock is insufficient.
    """
    recipe_q = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == data.product)
    )
    recipe_lines = recipe_q.scalars().all()
    if not recipe_lines:
        raise HTTPException(400, f"No recipe found for product '{data.product}'")

    selections = {k: v for k, v in (data.selections or {}).items()}
    plan_lines = []
    for line in recipe_lines:
        inv_item = await _resolve_inventory_for_component(db, line.component, selections)
        needed = line.qty * data.qty_produced

        if not inv_item:
            plan_lines.append(ProductionPreviewLine(
                component=line.component,
                inventory_item_id=None,
                inventory_item_name=None,
                supplier=None,
                needed=needed,
                unit=line.unit,
                shortfall=needed,  # 100% short if we can't even find the item
                lot_allocations=[],
            ))
            continue

        allocations, shortfall = await _plan_fifo(db, inv_item, needed)
        plan_lines.append(ProductionPreviewLine(
            component=line.component,
            inventory_item_id=inv_item.id,
            inventory_item_name=inv_item.name,
            supplier=inv_item.supplier,
            needed=needed,
            unit=line.unit,
            shortfall=shortfall,
            lot_allocations=allocations,
        ))

    return ProductionPreview(product=data.product, qty_produced=data.qty_produced, lines=plan_lines)


@router.get("/production/component-options")
async def component_options(
    product: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """For each recipe line, list inventory items whose name matches the component.
    Used by the production form's per-line supplier dropdown.

    Response: {component_name: [{id, name, supplier, quantity, unit}, ...]}
    """
    recipe_q = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == product)
    )
    recipe_lines = recipe_q.scalars().all()
    if not recipe_lines:
        raise HTTPException(404, f"No recipe found for product '{product}'")

    options: dict[str, list[dict]] = {}
    for line in recipe_lines:
        if line.component in options:
            continue
        items_q = await db.execute(
            select(InventoryItem)
            .where(InventoryItem.name == line.component)
            .order_by(InventoryItem.supplier.asc().nulls_last(), InventoryItem.created_at.asc())
        )
        options[line.component] = [
            {
                "id": str(i.id),
                "name": i.name,
                "supplier": i.supplier,
                "quantity": i.quantity,
                "unit": i.unit,
            }
            for i in items_q.scalars().all()
        ]
    return options


@router.post("/production/log", response_model=list[InventoryTransactionSchema], status_code=201)
async def log_production(data: ProductionLogRequest, db: AsyncSession = Depends(get_db)):
    """Log production of a product. Looks up the recipe and deducts each component
    from inventory using FIFO across that item's lots. Emits one transaction row
    per lot touched.

    Multi-supplier: `data.selections` maps component_name → inventory_item_id so
    operator can specify which supplier-variant was actually used. Components
    not in `selections` fall back to first match by name.

    Insufficient stock does NOT raise — partial consumption is recorded and the
    response reflects what was actually deducted. Caller can compare response
    line count to recipe line count to detect shortfalls.
    """
    recipe_q = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == data.product)
    )
    recipe_lines = recipe_q.scalars().all()
    if not recipe_lines:
        raise HTTPException(400, f"No recipe found for product '{data.product}'")

    selections = {k: v for k, v in (data.selections or {}).items()}
    transactions: list[InventoryTransaction] = []

    for line in recipe_lines:
        inv_item = await _resolve_inventory_for_component(db, line.component, selections)
        if not inv_item:
            continue  # missing item — skip and let caller notice

        consumed_total = line.qty * data.qty_produced

        lots_q = await db.execute(
            select(InventoryLot)
            .where(InventoryLot.inventory_item_id == inv_item.id)
            .where(InventoryLot.qty_remaining > 0)
            .order_by(InventoryLot.received_date.asc(), InventoryLot.created_at.asc())
        )
        lots = lots_q.scalars().all()

        remaining = consumed_total
        for lot in lots:
            if remaining <= 0:
                break
            take = min(lot.qty_remaining, remaining)
            lot.qty_remaining -= take
            remaining -= take

            txn = InventoryTransaction(
                inventory_item_id=inv_item.id,
                inventory_lot_id=lot.id,
                qty_change=-take,
                reason="production",
                batch_id=data.batch_id,
                performed_by=data.performed_by,
                notes=(
                    data.notes
                    or f"{data.qty_produced} x {data.product} (lot {lot.lot_number}, "
                       f"{take} {line.unit} of {line.component})"
                ),
            )
            db.add(txn)
            transactions.append(txn)
        # Note: if `remaining > 0` after walking all lots, this item is short.
        # We don't raise — the caller can compare response txn count to recipe
        # line count, or call /production/preview first to check.

    await db.commit()
    for txn in transactions:
        await db.refresh(txn)
    return transactions
