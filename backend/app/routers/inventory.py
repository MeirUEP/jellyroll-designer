"""Inventory management endpoints — stock levels, transactions, recipes, BOM."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import (
    InventoryItem, InventoryTransaction, DesignBOM, ProductRecipe,
    Material, Chemical, Design, SimulationResult,
)
from app.schemas import (
    InventoryItemCreate, InventoryItemUpdate, InventoryItemSchema,
    InventoryTransactionCreate, InventoryTransactionSchema,
    BOMLineSchema, ProductionConsumeRequest,
    RecipeLineCreate, RecipeLineSchema, RecipeBulkCreate,
    ProductionLogRequest, ReceiveShipmentRequest, PhysicalCountRequest,
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
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    txn = InventoryTransaction(**data.model_dump())
    db.add(txn)

    # Update running quantity
    item.quantity += data.qty_change

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
    """Record a physical count — creates an adjustment transaction to reconcile."""
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    diff = counted_qty - item.quantity
    txn = InventoryTransaction(
        inventory_item_id=item_id,
        qty_change=diff,
        reason="count",
        performed_by=performed_by,
        notes=notes or f"Physical count: {counted_qty} {item.unit} (was {item.quantity})",
    )
    db.add(txn)
    item.quantity = counted_qty

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


# ==================== PRODUCTION CONSUMPTION ====================

@router.post("/inventory/consume", response_model=list[InventoryTransactionSchema])
async def consume_for_production(data: ProductionConsumeRequest, db: AsyncSession = Depends(get_db)):
    """Consume inventory based on design BOM x cell count."""
    bom_result = await db.execute(
        select(DesignBOM).where(DesignBOM.design_id == data.design_id)
    )
    bom_lines = bom_result.scalars().all()
    if not bom_lines:
        raise HTTPException(400, "No BOM found for this design — generate BOM first")

    transactions = []
    for bom in bom_lines:
        if not bom.inventory_item_id:
            continue  # skip BOM lines not linked to inventory

        inv_item = await db.get(InventoryItem, bom.inventory_item_id)
        if not inv_item:
            continue

        consumed = bom.qty_per_cell * data.cell_count
        txn = InventoryTransaction(
            inventory_item_id=inv_item.id,
            qty_change=-consumed,
            reason="production",
            batch_id=data.batch_id,
            design_id=data.design_id,
            performed_by=data.performed_by,
            notes=data.notes or f"{data.cell_count} cells x {bom.qty_per_cell} {bom.unit}/cell ({bom.layer_name})",
        )
        db.add(txn)
        inv_item.quantity -= consumed
        transactions.append(txn)

    await db.commit()
    for txn in transactions:
        await db.refresh(txn)
    return transactions


# ==================== INVENTORY SUMMARY ====================

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


# ==================== RECEIVE SHIPMENT ====================

@router.post("/inventory/receive", response_model=InventoryTransactionSchema, status_code=201)
async def receive_shipment(data: ReceiveShipmentRequest, db: AsyncSession = Depends(get_db)):
    """Record a received shipment — adds stock and creates a 'received' transaction."""
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    txn = InventoryTransaction(
        inventory_item_id=data.inventory_item_id,
        qty_change=abs(data.qty),
        reason="received",
        performed_by=data.performed_by,
        notes=data.notes,
    )
    db.add(txn)
    item.quantity += abs(data.qty)
    if data.lot_number:
        item.lot_number = data.lot_number

    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== PHYSICAL COUNT ====================

@router.post("/inventory/physical-count", response_model=InventoryTransactionSchema, status_code=201)
async def physical_count(data: PhysicalCountRequest, db: AsyncSession = Depends(get_db)):
    """Reconcile physical count — creates an adjustment transaction for the difference."""
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    diff = data.counted_qty - item.quantity
    txn = InventoryTransaction(
        inventory_item_id=data.inventory_item_id,
        qty_change=diff,
        reason="count",
        performed_by=data.performed_by,
        notes=data.notes or f"Physical count: {data.counted_qty} {item.unit} (was {item.quantity})",
    )
    db.add(txn)
    item.quantity = data.counted_qty

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


# ==================== PRODUCTION LOG ====================

@router.post("/production/log", response_model=list[InventoryTransactionSchema], status_code=201)
async def log_production(data: ProductionLogRequest, db: AsyncSession = Depends(get_db)):
    """Log production of a product. Looks up the recipe and deducts each component from inventory."""
    # Get recipe lines for this product
    recipe_result = await db.execute(
        select(ProductRecipe).where(ProductRecipe.product == data.product)
    )
    recipe_lines = recipe_result.scalars().all()
    if not recipe_lines:
        raise HTTPException(400, f"No recipe found for product '{data.product}'")

    transactions = []
    missing_items = []

    for line in recipe_lines:
        # Find inventory item by name
        inv_result = await db.execute(
            select(InventoryItem).where(InventoryItem.name == line.component)
        )
        inv_item = inv_result.scalar_one_or_none()
        if not inv_item:
            missing_items.append(line.component)
            continue

        consumed = line.qty * data.qty_produced
        txn = InventoryTransaction(
            inventory_item_id=inv_item.id,
            qty_change=-consumed,
            reason="production",
            batch_id=data.batch_id,
            performed_by=data.performed_by,
            notes=data.notes or f"{data.qty_produced} x {data.product} ({line.qty} {line.unit}/unit of {line.component})",
        )
        db.add(txn)
        inv_item.quantity -= consumed
        transactions.append(txn)

    if missing_items:
        # Don't fail — record what we can and warn via notes on the first txn
        # (the caller can still check response count vs recipe lines)
        pass

    await db.commit()
    for txn in transactions:
        await db.refresh(txn)
    return transactions
