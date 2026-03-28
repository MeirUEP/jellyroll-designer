from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.auth import verify_api_key
from app.database import get_db
from app.models import Design
from app.schemas import (
    DesignCreate, DesignDetail, DesignImport, DesignList,
    DesignSummary, DesignUpdate, ElecProps,
)

router = APIRouter(tags=["designs"], dependencies=[Depends(verify_api_key)])


@router.get("/designs", response_model=DesignList)
async def list_designs(
    skip: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)
):
    total = await db.scalar(select(func.count(Design.id)))
    q = (
        select(Design)
        .order_by(Design.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(q)
    items = result.scalars().all()
    return DesignList(
        items=[DesignSummary.model_validate(d) for d in items],
        total=total or 0,
    )


@router.get("/designs/{design_id}", response_model=DesignDetail)
async def get_design(design_id: UUID, db: AsyncSession = Depends(get_db)):
    q = (
        select(Design)
        .options(selectinload(Design.sim_result), selectinload(Design.cap_result))
        .where(Design.id == design_id)
    )
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return DesignDetail.model_validate(design)


@router.post("/designs", response_model=DesignDetail, status_code=201)
async def create_design(body: DesignCreate, db: AsyncSession = Depends(get_db)):
    design = Design(
        name=body.name,
        description=body.description,
        params=body.params.model_dump(),
        layers=[l.model_dump() for l in body.layers],
        elec_props=body.elec_props.model_dump(),
    )
    db.add(design)
    await db.commit()
    # Re-fetch with eager loading to avoid lazy-load in async
    q = select(Design).options(
        selectinload(Design.sim_result), selectinload(Design.cap_result)
    ).where(Design.id == design.id)
    result = await db.execute(q)
    design = result.scalar_one()
    return DesignDetail.model_validate(design)


@router.put("/designs/{design_id}", response_model=DesignDetail)
async def update_design(design_id: UUID, body: DesignCreate, db: AsyncSession = Depends(get_db)):
    q = select(Design).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    design.name = body.name
    design.description = body.description
    design.params = body.params.model_dump()
    design.layers = [l.model_dump() for l in body.layers]
    design.elec_props = body.elec_props.model_dump()
    design.updated_at = datetime.now(timezone.utc)

    await db.commit()
    q = select(Design).options(
        selectinload(Design.sim_result), selectinload(Design.cap_result)
    ).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one()
    return DesignDetail.model_validate(design)


@router.patch("/designs/{design_id}", response_model=DesignDetail)
async def patch_design(design_id: UUID, body: DesignUpdate, db: AsyncSession = Depends(get_db)):
    q = select(Design).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")

    if body.name is not None:
        design.name = body.name
    if body.description is not None:
        design.description = body.description
    if body.params is not None:
        design.params = body.params.model_dump()
    if body.layers is not None:
        design.layers = [l.model_dump() for l in body.layers]
    if body.elec_props is not None:
        design.elec_props = body.elec_props.model_dump()
    design.updated_at = datetime.now(timezone.utc)

    await db.commit()
    q = select(Design).options(
        selectinload(Design.sim_result), selectinload(Design.cap_result)
    ).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one()
    return DesignDetail.model_validate(design)


@router.delete("/designs/{design_id}", status_code=204)
async def delete_design(design_id: UUID, db: AsyncSession = Depends(get_db)):
    q = select(Design).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    await db.delete(design)
    await db.commit()


@router.post("/designs/import", response_model=DesignDetail, status_code=201)
async def import_design(body: DesignImport, db: AsyncSession = Depends(get_db)):
    name = body.name or f"Imported {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    elec_props = body.elecProps or ElecProps(
        cath_bulk_density=2.41, cath_active_wt=0.75, cath_spec_cap=250,
        cath_mesh_dens=0.16, anod_bulk_density=4.062, anod_zn_wt=0.75,
        anod_zno_wt=0.16, anod_zn_cap=820, anod_zno_cap=660, anod_mesh_dens=0.149,
    )
    design = Design(
        name=name,
        version=body.version,
        params=body.params.model_dump(),
        layers=[l.model_dump() for l in body.layers],
        elec_props=elec_props.model_dump(),
    )
    db.add(design)
    await db.commit()
    q = select(Design).options(
        selectinload(Design.sim_result), selectinload(Design.cap_result)
    ).where(Design.id == design.id)
    result = await db.execute(q)
    design = result.scalar_one()
    return DesignDetail.model_validate(design)


@router.get("/designs/{design_id}/export")
async def export_design(design_id: UUID, db: AsyncSession = Depends(get_db)):
    q = select(Design).where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return {
        "version": design.version,
        "params": design.params,
        "layers": design.layers,
        "elecProps": design.elec_props,
    }
