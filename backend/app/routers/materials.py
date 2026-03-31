from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import Material
from app.schemas import MaterialCreate, MaterialSchema

router = APIRouter(tags=["materials"], dependencies=[Depends(verify_api_key)])


@router.get("/materials", response_model=list[MaterialSchema])
async def list_materials(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Material).order_by(Material.name))
    return [MaterialSchema.model_validate(m) for m in result.scalars().all()]


@router.post("/materials", response_model=MaterialSchema, status_code=201)
async def create_material(body: MaterialCreate, db: AsyncSession = Depends(get_db)):
    mat = Material(**body.model_dump())
    db.add(mat)
    await db.commit()
    await db.refresh(mat)
    return MaterialSchema.model_validate(mat)


@router.put("/materials/{mat_id}", response_model=MaterialSchema)
async def update_material(mat_id: UUID, body: MaterialCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Material).where(Material.id == mat_id))
    mat = result.scalar_one_or_none()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    for k, v in body.model_dump().items():
        setattr(mat, k, v)
    await db.commit()
    await db.refresh(mat)
    return MaterialSchema.model_validate(mat)


@router.delete("/materials/{mat_id}", status_code=204)
async def delete_material(mat_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Material).where(Material.id == mat_id))
    mat = result.scalar_one_or_none()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    await db.delete(mat)
    await db.commit()
