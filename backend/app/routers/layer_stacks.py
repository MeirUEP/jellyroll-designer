from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import LayerStack, Material
from app.schemas import LayerStackCreate, LayerStackDetail, LayerStackSchema

router = APIRouter(tags=["layer_stacks"], dependencies=[Depends(verify_api_key)])


async def _resolve_items(stack: LayerStack, db: AsyncSession) -> list[dict]:
    """Resolve material_id references to full material details."""
    mat_ids = [item["material_id"] for item in (stack.items or [])]
    if not mat_ids:
        return []
    result = await db.execute(select(Material).where(Material.id.in_(mat_ids)))
    mat_map = {str(m.id): m for m in result.scalars().all()}
    resolved = []
    for item in sorted(stack.items, key=lambda x: x["position"]):
        mat = mat_map.get(item["material_id"])
        resolved.append({
            "material_id": item["material_id"],
            "position": item["position"],
            "role": item["role"],
            "name": mat.name if mat else "Unknown",
            "type": mat.type if mat else "other",
            "thickness": mat.thickness if mat else 0,
            "width": mat.width if mat else 0,
            "color": mat.color if mat else "#888",
        })
    return resolved


@router.get("/layer-stacks", response_model=list[LayerStackSchema])
async def list_layer_stacks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LayerStack).order_by(LayerStack.name))
    return [LayerStackSchema.model_validate(s) for s in result.scalars().all()]


@router.get("/layer-stacks/{stack_id}", response_model=LayerStackDetail)
async def get_layer_stack(stack_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LayerStack).where(LayerStack.id == stack_id))
    stack = result.scalar_one_or_none()
    if not stack:
        raise HTTPException(status_code=404, detail="Layer stack not found")
    resolved = await _resolve_items(stack, db)
    detail = LayerStackDetail.model_validate(stack)
    detail.resolved_items = resolved
    return detail


@router.post("/layer-stacks", response_model=LayerStackSchema, status_code=201)
async def create_layer_stack(body: LayerStackCreate, db: AsyncSession = Depends(get_db)):
    stack = LayerStack(
        name=body.name,
        items=[item.model_dump(mode="json") for item in body.items],
    )
    db.add(stack)
    await db.commit()
    await db.refresh(stack)
    return LayerStackSchema.model_validate(stack)


@router.put("/layer-stacks/{stack_id}", response_model=LayerStackSchema)
async def update_layer_stack(stack_id: UUID, body: LayerStackCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LayerStack).where(LayerStack.id == stack_id))
    stack = result.scalar_one_or_none()
    if not stack:
        raise HTTPException(status_code=404, detail="Layer stack not found")
    stack.name = body.name
    stack.items = [item.model_dump(mode="json") for item in body.items]
    await db.commit()
    await db.refresh(stack)
    return LayerStackSchema.model_validate(stack)


@router.delete("/layer-stacks/{stack_id}", status_code=204)
async def delete_layer_stack(stack_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LayerStack).where(LayerStack.id == stack_id))
    stack = result.scalar_one_or_none()
    if not stack:
        raise HTTPException(status_code=404, detail="Layer stack not found")
    await db.delete(stack)
    await db.commit()
