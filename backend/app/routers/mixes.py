from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import Chemical, Mix
from app.schemas import MixCreate, MixDetail, MixSchema

router = APIRouter(tags=["mixes"], dependencies=[Depends(verify_api_key)])


async def _resolve_components(mix: Mix, db: AsyncSession) -> list[dict]:
    """Resolve chemical_id references to full chemical details."""
    chem_ids = [c["chemical_id"] for c in (mix.components or [])]
    if not chem_ids:
        return []
    result = await db.execute(select(Chemical).where(Chemical.id.in_(chem_ids)))
    chem_map = {str(c.id): c for c in result.scalars().all()}
    resolved = []
    for comp in mix.components:
        chem = chem_map.get(comp["chemical_id"])
        resolved.append({
            "chemical_id": comp["chemical_id"],
            "wt_pct": comp["wt_pct"],
            "is_active": comp.get("is_active", False),
            "name": chem.name if chem else "Unknown",
            "density": chem.density if chem else 0,
            "capacity": chem.capacity if chem else 0,
        })
    return resolved


@router.get("/mixes", response_model=list[MixSchema])
async def list_mixes(type: str | None = None, db: AsyncSession = Depends(get_db)):
    q = select(Mix).order_by(Mix.name)
    if type:
        q = q.where(Mix.type == type)
    result = await db.execute(q)
    return [MixSchema.model_validate(m) for m in result.scalars().all()]


@router.get("/mixes/{mix_id}", response_model=MixDetail)
async def get_mix(mix_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mix).where(Mix.id == mix_id))
    mix = result.scalar_one_or_none()
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    resolved = await _resolve_components(mix, db)
    detail = MixDetail.model_validate(mix)
    detail.resolved_components = resolved
    return detail


@router.post("/mixes", response_model=MixSchema, status_code=201)
async def create_mix(body: MixCreate, db: AsyncSession = Depends(get_db)):
    mix = Mix(
        name=body.name,
        type=body.type,
        bulk_density=body.bulk_density,
        mesh_density=body.mesh_density,
        cc_material=body.cc_material,
        components=[c.model_dump(mode="json") for c in body.components],
    )
    db.add(mix)
    await db.commit()
    await db.refresh(mix)
    return MixSchema.model_validate(mix)


@router.put("/mixes/{mix_id}", response_model=MixSchema)
async def update_mix(mix_id: UUID, body: MixCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mix).where(Mix.id == mix_id))
    mix = result.scalar_one_or_none()
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    mix.name = body.name
    mix.type = body.type
    mix.bulk_density = body.bulk_density
    mix.mesh_density = body.mesh_density
    mix.cc_material = body.cc_material
    mix.components = [c.model_dump(mode="json") for c in body.components]
    await db.commit()
    await db.refresh(mix)
    return MixSchema.model_validate(mix)


@router.delete("/mixes/{mix_id}", status_code=204)
async def delete_mix(mix_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mix).where(Mix.id == mix_id))
    mix = result.scalar_one_or_none()
    if not mix:
        raise HTTPException(status_code=404, detail="Mix not found")
    await db.delete(mix)
    await db.commit()
