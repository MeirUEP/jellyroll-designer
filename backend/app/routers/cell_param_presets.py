from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import CellParamsPreset
from app.schemas import CellParamsPresetCreate, CellParamsPresetSchema

router = APIRouter(tags=["cell_param_presets"], dependencies=[Depends(verify_api_key)])


@router.get("/cell-param-presets", response_model=list[CellParamsPresetSchema])
async def list_cell_param_presets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CellParamsPreset).order_by(CellParamsPreset.name))
    return [CellParamsPresetSchema.model_validate(p) for p in result.scalars().all()]


@router.get("/cell-param-presets/{preset_id}", response_model=CellParamsPresetSchema)
async def get_cell_param_preset(preset_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CellParamsPreset).where(CellParamsPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Cell params preset not found")
    return CellParamsPresetSchema.model_validate(preset)


@router.post("/cell-param-presets", response_model=CellParamsPresetSchema, status_code=201)
async def create_cell_param_preset(body: CellParamsPresetCreate, db: AsyncSession = Depends(get_db)):
    preset = CellParamsPreset(name=body.name, params=body.params)
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return CellParamsPresetSchema.model_validate(preset)


@router.put("/cell-param-presets/{preset_id}", response_model=CellParamsPresetSchema)
async def update_cell_param_preset(preset_id: UUID, body: CellParamsPresetCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CellParamsPreset).where(CellParamsPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Cell params preset not found")
    preset.name = body.name
    preset.params = body.params
    preset.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(preset)
    return CellParamsPresetSchema.model_validate(preset)


@router.delete("/cell-param-presets/{preset_id}", status_code=204)
async def delete_cell_param_preset(preset_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CellParamsPreset).where(CellParamsPreset.id == preset_id))
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Cell params preset not found")
    await db.delete(preset)
    await db.commit()
