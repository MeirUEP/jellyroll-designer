import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from app.database import Base


class Chemical(Base):
    __tablename__ = "chemicals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    density = Column(Float, nullable=False)
    capacity = Column(Float, nullable=False, server_default="0")
    is_active_mat = Column(Boolean, nullable=False, server_default="false")
    category = Column(String(50), nullable=True)  # active, binder, additive, conductor
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))


class Material(Base):
    __tablename__ = "materials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    type = Column(String(50), nullable=False)  # separator, tape, collector, other
    thickness = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    color = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))


class Mix(Base):
    __tablename__ = "mixes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    type = Column(String(20), nullable=False)  # cathode, anode
    bulk_density = Column(Float, nullable=False)
    mesh_density = Column(Float, nullable=False, server_default="0")
    cc_material = Column(String(100), nullable=True)  # e.g. "Nickel mesh", "Copper mesh"
    components = Column(JSONB, nullable=False)  # [{chemical_id, wt_pct, is_active}]
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))


class LayerStack(Base):
    __tablename__ = "layer_stacks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    items = Column(JSONB, nullable=False)  # [{material_id, position, role}]
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))


class CellParamsPreset(Base):
    __tablename__ = "cell_param_presets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, unique=True)
    params = Column(JSONB, nullable=False)  # cell parameters snapshot (mandrel_d, target_od, tab zones, tension, etc.)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))


class Design(Base):
    __tablename__ = "designs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(String(10), nullable=False, server_default="1.2")
    is_experimental = Column(Boolean, nullable=False, server_default="false")
    cathode_mix_id = Column(UUID(as_uuid=True), ForeignKey("mixes.id"), nullable=True)
    anode_mix_id = Column(UUID(as_uuid=True), ForeignKey("mixes.id"), nullable=True)
    layer_stack_id = Column(UUID(as_uuid=True), ForeignKey("layer_stacks.id"), nullable=True)
    cell_params_preset_id = Column(UUID(as_uuid=True), ForeignKey("cell_param_presets.id", ondelete="RESTRICT"), nullable=True)
    cell_params = Column(JSONB, nullable=True)  # DEPRECATED: legacy inline snapshot, kept for backward-compat; new rows reference cell_params_preset_id instead
    layers = Column(JSONB, nullable=True)  # [{name, type, t, w, color, ...}] — complete layer stack snapshot
    elec_props = Column(JSONB, nullable=True)  # electrode properties for capacity calc
    reference_design_id = Column(UUID(as_uuid=True), ForeignKey("designs.id", ondelete="SET NULL"), nullable=True)
    experimental_data = Column(JSONB, nullable=True)  # measured OD, tab positions, electrode lengths
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))

    cathode_mix = relationship("Mix", foreign_keys=[cathode_mix_id])
    anode_mix = relationship("Mix", foreign_keys=[anode_mix_id])
    layer_stack = relationship("LayerStack", foreign_keys=[layer_stack_id])
    cell_params_preset = relationship("CellParamsPreset", foreign_keys=[cell_params_preset_id])
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
    cathode_len = Column(Float, nullable=True)
    anode_len = Column(Float, nullable=True)
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
