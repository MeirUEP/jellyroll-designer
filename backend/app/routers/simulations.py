from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import CapacityResult, Design, SimulationResult
from app.schemas import CapResultCreate, CapResultSchema, SimResultCreate, SimResultSchema

router = APIRouter(tags=["simulations"], dependencies=[Depends(verify_api_key)])


async def _get_design(design_id: UUID, db: AsyncSession) -> Design:
    result = await db.execute(select(Design).where(Design.id == design_id))
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return design


@router.post("/designs/{design_id}/simulation", response_model=SimResultSchema, status_code=201)
async def save_simulation(design_id: UUID, body: SimResultCreate, db: AsyncSession = Depends(get_db)):
    await _get_design(design_id, db)

    # Upsert: delete existing, create new
    existing = await db.execute(
        select(SimulationResult).where(SimulationResult.design_id == design_id)
    )
    old = existing.scalar_one_or_none()
    if old:
        await db.delete(old)
        await db.flush()

    sim = SimulationResult(
        design_id=design_id,
        turns=body.turns,
        c_tabs=body.c_tabs,
        a_tabs=body.a_tabs,
        outer_r=body.outer_r,
        min_pitch=body.min_pitch,
        max_pitch=body.max_pitch,
    )
    db.add(sim)
    await db.commit()
    await db.refresh(sim)
    return SimResultSchema.model_validate(sim)


@router.get("/designs/{design_id}/simulation", response_model=SimResultSchema)
async def get_simulation(design_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SimulationResult).where(SimulationResult.design_id == design_id)
    )
    sim = result.scalar_one_or_none()
    if not sim:
        raise HTTPException(status_code=404, detail="No simulation result found")
    return SimResultSchema.model_validate(sim)


@router.post("/designs/{design_id}/capacity", response_model=CapResultSchema, status_code=201)
async def save_capacity(design_id: UUID, body: CapResultCreate, db: AsyncSession = Depends(get_db)):
    await _get_design(design_id, db)

    existing = await db.execute(
        select(CapacityResult).where(CapacityResult.design_id == design_id)
    )
    old = existing.scalar_one_or_none()
    if old:
        await db.delete(old)
        await db.flush()

    cap = CapacityResult(
        design_id=design_id,
        cath_cap_ah=body.cath_cap_ah,
        anod_cap_ah=body.anod_cap_ah,
        cell_cap_ah=body.cell_cap_ah,
        np_ratio=body.np_ratio,
        cell_energy_1e=body.cell_energy_1e,
        total_dry_mass=body.total_dry_mass,
        full_result=body.full_result,
    )
    db.add(cap)
    await db.commit()
    await db.refresh(cap)
    return CapResultSchema.model_validate(cap)


@router.get("/designs/{design_id}/capacity", response_model=CapResultSchema)
async def get_capacity(design_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CapacityResult).where(CapacityResult.design_id == design_id)
    )
    cap = result.scalar_one_or_none()
    if not cap:
        raise HTTPException(status_code=404, detail="No capacity result found")
    return CapResultSchema.model_validate(cap)
