from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import verify_api_key
from app.database import get_db
from app.models import Chemical
from app.schemas import ChemicalCreate, ChemicalSchema

router = APIRouter(tags=["chemicals"], dependencies=[Depends(verify_api_key)])


@router.get("/chemicals", response_model=list[ChemicalSchema])
async def list_chemicals(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chemical).order_by(Chemical.name))
    return [ChemicalSchema.model_validate(c) for c in result.scalars().all()]


@router.post("/chemicals", response_model=ChemicalSchema, status_code=201)
async def create_chemical(body: ChemicalCreate, db: AsyncSession = Depends(get_db)):
    chem = Chemical(**body.model_dump())
    db.add(chem)
    await db.commit()
    await db.refresh(chem)
    return ChemicalSchema.model_validate(chem)


@router.put("/chemicals/{chem_id}", response_model=ChemicalSchema)
async def update_chemical(chem_id: UUID, body: ChemicalCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chemical).where(Chemical.id == chem_id))
    chem = result.scalar_one_or_none()
    if not chem:
        raise HTTPException(status_code=404, detail="Chemical not found")
    for k, v in body.model_dump().items():
        setattr(chem, k, v)
    await db.commit()
    await db.refresh(chem)
    return ChemicalSchema.model_validate(chem)


@router.delete("/chemicals/{chem_id}", status_code=204)
async def delete_chemical(chem_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chemical).where(Chemical.id == chem_id))
    chem = result.scalar_one_or_none()
    if not chem:
        raise HTTPException(status_code=404, detail="Chemical not found")
    await db.delete(chem)
    await db.commit()
