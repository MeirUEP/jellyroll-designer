import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Design(Base):
    __tablename__ = "designs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(String(10), nullable=False, server_default="1.1")
    params = Column(JSONB, nullable=False)
    layers = Column(JSONB, nullable=False)
    elec_props = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))

    sim_result = relationship("SimulationResult", back_populates="design", uselist=False, cascade="all, delete-orphan")
    cap_result = relationship("CapacityResult", back_populates="design", uselist=False, cascade="all, delete-orphan")


class SimulationResult(Base):
    __tablename__ = "simulation_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    design_id = Column(UUID(as_uuid=True), ForeignKey("designs.id", ondelete="CASCADE"), nullable=False, unique=True)
    turns = Column(JSONB, nullable=False)
    c_tabs = Column(JSONB, nullable=False)
    a_tabs = Column(JSONB, nullable=False)
    outer_r = Column(Float, nullable=False)
    min_pitch = Column(Float, nullable=False)
    max_pitch = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))

    design = relationship("Design", back_populates="sim_result")


class CapacityResult(Base):
    __tablename__ = "capacity_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    design_id = Column(UUID(as_uuid=True), ForeignKey("designs.id", ondelete="CASCADE"), nullable=False, unique=True)
    cath_cap_ah = Column(Float, nullable=False)
    anod_cap_ah = Column(Float, nullable=False)
    cell_cap_ah = Column(Float, nullable=False)
    np_ratio = Column(Float, nullable=False)
    cell_energy_1e = Column(Float, nullable=False)
    total_dry_mass = Column(Float, nullable=False)
    full_result = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))

    design = relationship("Design", back_populates="cap_result")
