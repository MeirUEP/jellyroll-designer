"""Inventory management endpoints — stock levels, transactions, and BOM."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import (
    InventoryItem, InventoryTransaction, DesignBOM,
    Material, Design, SimulationResult,
)
from app.schemas import (
    InventoryItemCreate, InventoryItemUpdate, InventoryItemSchema, InventoryItemDetail,
    InventoryTransactionCreate, InventoryTransactionSchema,
    BOMLineSchema, BOMGenerateRequest, ProductionConsumeRequest,
)

router = APIRouter(tags=["inventory"], dependencies=[Depends(verify_api_key)])


# ==================== INVENTORY ITEMS ====================

@router.get("/inventory", response_model=list[InventoryItemDetail])
async def list_inventory(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InventoryItem, Material.name, Material.type)
        .join(Material, InventoryItem.material_id == Material.id)
        .order_by(Material.name)
    )
    items = []
    for row in result.all():
        inv, mat_name, mat_type = row
        d = InventoryItemSchema.model_validate(inv).model_dump()
        d["material_name"] = mat_name
        d["material_type"] = mat_type
        items.append(InventoryItemDetail(**d))
    return items


@router.post("/inventory", response_model=InventoryItemSchema, status_code=201)
async def create_inventory_item(data: InventoryItemCreate, db: AsyncSession = Depends(get_db)):
    # Verify material exists
    mat = await db.get(Material, data.material_id)
    if not mat:
        raise HTTPException(404, "Material not found")
    item = InventoryItem(**data.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("/inventory/{item_id}", response_model=InventoryItemDetail)
async def get_inventory_item(item_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(InventoryItem, Material.name, Material.type)
        .join(Material, InventoryItem.material_id == Material.id)
        .where(InventoryItem.id == item_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(404, "Inventory item not found")
    inv, mat_name, mat_type = row
    d = InventoryItemSchema.model_validate(inv).model_dump()
    d["material_name"] = mat_name
    d["material_type"] = mat_type
    return InventoryItemDetail(**d)


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
    # Verify inventory item exists
    item = await db.get(InventoryItem, data.inventory_item_id)
    if not item:
        raise HTTPException(404, "Inventory item not found")

    # Create transaction
    txn = InventoryTransaction(**data.model_dump())
    db.add(txn)

    # Update inventory quantity
    item.quantity += data.qty_change

    await db.commit()
    await db.refresh(txn)
    return txn


# ==================== DESIGN BOM ====================

@router.get("/designs/{design_id}/bom", response_model=list[BOMLineSchema])
async def get_design_bom(design_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DesignBOM, Material.name)
        .join(Material, DesignBOM.material_id == Material.id)
        .where(DesignBOM.design_id == design_id)
        .order_by(DesignBOM.role, DesignBOM.layer_name)
    )
    lines = []
    for row in result.all():
        bom, mat_name = row
        d = {
            "id": bom.id,
            "design_id": bom.design_id,
            "material_id": bom.material_id,
            "layer_name": bom.layer_name,
            "role": bom.role,
            "qty_per_cell": bom.qty_per_cell,
            "unit": bom.unit,
            "notes": bom.notes,
            "created_at": bom.created_at,
            "material_name": mat_name,
        }
        lines.append(BOMLineSchema(**d))
    return lines


@router.post("/designs/{design_id}/bom/generate", response_model=list[BOMLineSchema])
async def generate_bom(design_id: UUID, db: AsyncSession = Depends(get_db)):
    """Auto-generate BOM from a design's simulation results and layer stack."""
    # Load design with layers
    design = await db.get(Design, design_id)
    if not design:
        raise HTTPException(404, "Design not found")

    # Load simulation result
    sim_result = await db.execute(
        select(SimulationResult).where(SimulationResult.design_id == design_id)
    )
    sim = sim_result.scalar_one_or_none()
    if not sim:
        raise HTTPException(400, "No simulation result found — run simulation first")

    # Get layer data from design
    design_layers = design.layers or []
    if not design_layers:
        raise HTTPException(400, "Design has no layer data — save with layers first")

    # Delete existing BOM for this design
    existing = await db.execute(select(DesignBOM).where(DesignBOM.design_id == design_id))
    for row in existing.scalars().all():
        await db.delete(row)

    # Build BOM lines from simulation data + layers
    bom_lines = []

    # Process each layer — find its material and computed length from sim
    turns_data = sim.turns or []

    for layer in design_layers:
        layer_name = layer.get("name", "Unknown")
        layer_type = layer.get("type", "other")
        computed_len = layer.get("computedLen") or layer.get("len") or 0
        layer_width = layer.get("w", 0)
        layer_thickness = layer.get("t", 0)

        if layer_type == "mandrel":
            continue

        # Find matching material in DB
        mat_result = await db.execute(
            select(Material).where(Material.name == layer_name)
        )
        mat = mat_result.scalar_one_or_none()
        if not mat:
            continue  # skip layers without a matching material record

        # Length BOM line (mm)
        if computed_len > 0:
            bom_line = DesignBOM(
                design_id=design_id,
                material_id=mat.id,
                layer_name=layer_name,
                role=layer_type,
                qty_per_cell=round(computed_len, 1),
                unit="mm",
                notes=f"{layer_width}mm wide × {layer_thickness}mm thick",
            )
            db.add(bom_line)
            bom_lines.append(bom_line)

    # Add tab count as BOM lines (cathode and anode tabs)
    c_tabs = sim.c_tabs or []
    a_tabs = sim.a_tabs or []
    if c_tabs:
        # Find cathode material
        cath_mat = await db.execute(
            select(Material).where(Material.name.ilike("%cathode%"))
        )
        cath = cath_mat.scalar_one_or_none()
        if cath:
            bom_line = DesignBOM(
                design_id=design_id,
                material_id=cath.id,
                layer_name="Cathode tabs",
                role="cathode",
                qty_per_cell=len(c_tabs),
                unit="each",
                notes="Welded tabs",
            )
            db.add(bom_line)
            bom_lines.append(bom_line)

    if a_tabs:
        anode_mat = await db.execute(
            select(Material).where(Material.name.ilike("%anode%"))
        )
        anode = anode_mat.scalar_one_or_none()
        if anode:
            bom_line = DesignBOM(
                design_id=design_id,
                material_id=anode.id,
                layer_name="Anode tabs",
                role="anode",
                qty_per_cell=len(a_tabs),
                unit="each",
                notes="Welded tabs",
            )
            db.add(bom_line)
            bom_lines.append(bom_line)

    await db.commit()

    # Reload with material names for response
    return await get_design_bom(design_id, db)


# ==================== PRODUCTION CONSUMPTION ====================

@router.post("/inventory/consume", response_model=list[InventoryTransactionSchema])
async def consume_for_production(data: ProductionConsumeRequest, db: AsyncSession = Depends(get_db)):
    """Consume inventory based on design BOM × cell count."""
    # Load BOM
    bom_result = await db.execute(
        select(DesignBOM).where(DesignBOM.design_id == data.design_id)
    )
    bom_lines = bom_result.scalars().all()
    if not bom_lines:
        raise HTTPException(400, "No BOM found for this design — generate BOM first")

    transactions = []
    for bom in bom_lines:
        # Find inventory item for this material
        inv_result = await db.execute(
            select(InventoryItem).where(InventoryItem.material_id == bom.material_id)
        )
        inv_item = inv_result.scalar_one_or_none()
        if not inv_item:
            continue  # skip if no inventory for this material

        consumed = bom.qty_per_cell * data.cell_count
        txn = InventoryTransaction(
            inventory_item_id=inv_item.id,
            qty_change=-consumed,
            reason="production",
            batch_id=data.batch_id,
            design_id=data.design_id,
            notes=data.notes or f"{data.cell_count} cells × {bom.qty_per_cell} {bom.unit}/cell ({bom.layer_name})",
        )
        db.add(txn)

        # Update inventory quantity
        inv_item.quantity -= consumed

        transactions.append(txn)

    await db.commit()
    for txn in transactions:
        await db.refresh(txn)
    return transactions


# ==================== INVENTORY SUMMARY ====================

@router.get("/inventory/summary")
async def inventory_summary(db: AsyncSession = Depends(get_db)):
    """Get summary of all inventory with current stock levels."""
    result = await db.execute(
        select(
            Material.name,
            Material.type,
            func.sum(InventoryItem.quantity).label("total_qty"),
            InventoryItem.unit,
        )
        .join(Material, InventoryItem.material_id == Material.id)
        .group_by(Material.name, Material.type, InventoryItem.unit)
        .order_by(Material.type, Material.name)
    )
    return [
        {"material": r.name, "type": r.type, "quantity": r.total_qty, "unit": r.unit}
        for r in result.all()
    ]
