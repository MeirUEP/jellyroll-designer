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


# ========== Inventory & BOM ==========

class InventoryItem(Base):
    """Standalone inventory catalog item. Covers everything: chemicals, separators,
    electrolyte, finished goods, packaging, electronics, etc."""
    __tablename__ = "inventory_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False)
    category = Column(String(50), nullable=False)        # raw_chemical, separator, collector, electrolyte, finished_good, packaging, electronics, other
    unit = Column(String(30), nullable=False)             # kg, lbs, ft, m, L, pcs, rolls
    package_unit = Column(String(50), nullable=True)      # bag, supersack, roll, drum, tote, jar, bottle, box
    package_size = Column(Float, nullable=True)           # qty per package
    quantity = Column(Float, nullable=False, server_default="0")  # current stock
    lot_number = Column(String(100), nullable=True)
    location = Column(String(100), nullable=True)
    reorder_point = Column(Float, nullable=True)
    material_id = Column(UUID(as_uuid=True), ForeignKey("materials.id", ondelete="SET NULL"), nullable=True)
    chemical_id = Column(UUID(as_uuid=True), ForeignKey("chemicals.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"), onupdate=lambda: datetime.now(timezone.utc))

    material = relationship("Material")
    chemical = relationship("Chemical")
    transactions = relationship("InventoryTransaction", back_populates="inventory_item", cascade="all, delete-orphan")


class InventoryTransaction(Base):
    """Append-only ledger of every inventory change."""
    __tablename__ = "inventory_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    inventory_item_id = Column(UUID(as_uuid=True), ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False)
    qty_change = Column(Float, nullable=False)           # positive = received, negative = consumed/scrapped
    reason = Column(String(50), nullable=False)          # received, production, scrap, adjustment, count, return
    batch_id = Column(String(100), nullable=True)        # reference to FileMaker batch
    design_id = Column(UUID(as_uuid=True), ForeignKey("designs.id", ondelete="SET NULL"), nullable=True)
    performed_by = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))

    inventory_item = relationship("InventoryItem", back_populates="transactions")


class DesignBOM(Base):
    """Bill of materials for a design — auto-generated from simulation results."""
    __tablename__ = "design_bom"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    design_id = Column(UUID(as_uuid=True), ForeignKey("designs.id", ondelete="CASCADE"), nullable=False)
    inventory_item_id = Column(UUID(as_uuid=True), ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True)
    material_id = Column(UUID(as_uuid=True), ForeignKey("materials.id", ondelete="SET NULL"), nullable=True)
    layer_name = Column(String(255), nullable=True)
    role = Column(String(50), nullable=True)              # cathode, anode, separator, electrolyte, can, tab
    qty_per_cell = Column(Float, nullable=False)
    unit = Column(String(30), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))

    design = relationship("Design")
    inventory_item = relationship("InventoryItem")
    material = relationship("Material")


class ProductRecipe(Base):
    """Flat recipe table: each row = one component line for a product.
    Components reference inventory_items by name (not FK) so recipes can
    be defined before every item exists and renamed items don't cascade."""
    __tablename__ = "product_recipes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    product = Column(String(255), nullable=False)          # 'Rev 5 Anode Batch', 'Rev 5 Cell', etc.
    component = Column(String(255), nullable=False)        # must match inventory_items.name
    qty = Column(Float, nullable=False)                    # qty per 1 product unit
    unit = Column(String(30), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), server_default=text("now()"))
