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
    DesignCreate, DesignDetail, DesignList,
    DesignSummary, DesignUpdate,
)

router = APIRouter(tags=["designs"], dependencies=[Depends(verify_api_key)])


def _design_query():
    return select(Design).options(
        selectinload(Design.cathode_mix),
        selectinload(Design.anode_mix),
        selectinload(Design.layer_stack),
        selectinload(Design.sim_result),
        selectinload(Design.cap_result),
    )


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
    q = _design_query().where(Design.id == design_id)
    result = await db.execute(q)
    design = result.scalar_one_or_none()
    if not design:
        raise HTTPException(status_code=404, detail="Design not found")
    return DesignDetail.model_validate(design)


def _extract_cell_params(body):
    """Extract cell_params from body — frontend may send 'params' instead of 'cell_params'."""
    if body.cell_params:
        return body.cell_params.model_dump()
    # Frontend sends 'params' as extra field
    extra = getattr(body, 'params', None)
    if extra:
        return extra if isinstance(extra, dict) else extra.model_dump()
    return {}


def _extract_layers(body):
    """Extract layers from body — frontend may send as top-level extra field."""
    if body.layers is not None:
        return body.layers
    return getattr(body, 'layers', None)


def _extract_elec_props(body):
    """Extract elec_props from body — frontend may send as 'elec_props' extra field."""
    if body.elec_props is not None:
        return body.elec_props
    return getattr(body, 'elec_props', None)


@router.post("/designs", response_model=DesignDetail, status_code=201)
async def create_design(body: DesignCreate, db: AsyncSession = Depends(get_db)):
    design = Design(
        name=body.name,
        description=body.description,
        is_experimental=body.is_experimental,
        cathode_mix_id=body.cathode_mix_id,
        anode_mix_id=body.anode_mix_id,
        layer_stack_id=body.layer_stack_id,
        reference_design_id=body.reference_design_id,
        cell_params=_extract_cell_params(body),
        layers=_extract_layers(body),
        elec_props=_extract_elec_props(body),
        experimental_data=body.experimental_data.model_dump() if body.experimental_data else None,
    )
    db.add(design)
    await db.commit()
    q = _design_query().where(Design.id == design.id)
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
    design.is_experimental = body.is_experimental
    design.cathode_mix_id = body.cathode_mix_id
    design.anode_mix_id = body.anode_mix_id
    design.layer_stack_id = body.layer_stack_id
    design.reference_design_id = body.reference_design_id
    design.cell_params = _extract_cell_params(body)
    layers = _extract_layers(body)
    if layers is not None:
        design.layers = layers
    elec_props = _extract_elec_props(body)
    if elec_props is not None:
        design.elec_props = elec_props
    if body.experimental_data:
        design.experimental_data = body.experimental_data.model_dump()
    design.updated_at = datetime.now(timezone.utc)

    await db.commit()
    q = _design_query().where(Design.id == design_id)
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
    if body.is_experimental is not None:
        design.is_experimental = body.is_experimental
    if body.cathode_mix_id is not None:
        design.cathode_mix_id = body.cathode_mix_id
    if body.anode_mix_id is not None:
        design.anode_mix_id = body.anode_mix_id
    if body.layer_stack_id is not None:
        design.layer_stack_id = body.layer_stack_id
    if body.reference_design_id is not None:
        design.reference_design_id = body.reference_design_id
    cp = _extract_cell_params(body)
    if cp:
        design.cell_params = cp
    if body.layers is not None:
        design.layers = body.layers
    if body.elec_props is not None:
        design.elec_props = body.elec_props
    if body.experimental_data is not None:
        design.experimental_data = body.experimental_data.model_dump()
    design.updated_at = datetime.now(timezone.utc)

    await db.commit()
    q = _design_query().where(Design.id == design_id)
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
