from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field


# ========== Chemical ==========
class ChemicalCreate(BaseModel):
    name: str = Field(..., max_length=255)
    density: float
    capacity: float = 0
    is_active_mat: bool = False
    category: str | None = None


class ChemicalSchema(ChemicalCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ========== Material ==========
class MaterialCreate(BaseModel):
    name: str = Field(..., max_length=255)
    type: Literal["separator", "tape", "collector", "other"]
    thickness: float
    width: float
    color: str | None = None


class MaterialSchema(MaterialCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ========== Mix ==========
# As of the inventory-driven rewrite, a mix component can point at either
# an inventory item (the new source of truth) or a legacy chemical. At
# least one must be set — enforced by the router, not here. capacity_override
# carries the user's per-design capacity choice (mAh/g); if null, consumers
# fall back to the inventory item's or chemical's default capacity.
class MixComponent(BaseModel):
    inventory_item_id: UUID | None = None
    chemical_id: UUID | None = None
    name_snapshot: str | None = None
    wt_pct: float
    is_active: bool = False
    capacity_override: float | None = None


class MixCreate(BaseModel):
    name: str = Field(..., max_length=255)
    type: Literal["cathode", "anode"]
    bulk_density: float
    thickness: float | None = None        # electrode paste thickness (mm)
    mesh_density: float = 0
    cc_material: str | None = None
    components: list[MixComponent]


class MixSchema(MixCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class MixDetail(MixSchema):
    """Mix with resolved chemical names for display."""
    resolved_components: list[dict] | None = None


# ========== Layer Stack ==========
class LayerStackItem(BaseModel):
    material_id: UUID
    position: int
    role: Literal["cathode", "anode", "separator", "tape", "collector", "other"]
    # Optional new-model links — lets saved stacks point at inventory items
    # (passive layers) and mixes (electrodes) so loaded layers aren't orphans.
    inventory_item_id: UUID | None = None
    mix_id: UUID | None = None


class LayerStackCreate(BaseModel):
    name: str = Field(..., max_length=255)
    items: list[LayerStackItem]


class LayerStackSchema(LayerStackCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class LayerStackDetail(LayerStackSchema):
    """Stack with resolved material details for display."""
    resolved_items: list[dict] | None = None


# ========== Cell Parameters Preset (standalone named snapshots) ==========
class CellParamsPresetCreate(BaseModel):
    name: str = Field(..., max_length=255)
    params: dict


class CellParamsPresetSchema(CellParamsPresetCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ========== Cell Parameters (legacy inline JSONB in designs) ==========
# DEPRECATED in favor of cell_params_preset_id FK on designs.
# Kept so legacy design records that still have inline cell_params can be read.
class CellParams(BaseModel):
    model_config = {"extra": "allow"}
    mandrel_d: float
    target_od: float
    cell_h: float
    pre_turns: float = 1.5
    tab_w: float = 10
    tab_h: float = 15
    first_cath_tab: float = 98
    cath_weld_from_tab: int = 1
    anod_weld_from_tab: int = 1
    anode_end_tab_clearance: float = 10


# ========== Experimental Data ==========
class ExperimentalTabData(BaseModel):
    tab_num: int
    arc_position_mm: float

class ExperimentalData(BaseModel):
    # Cell measurements
    measured_od: float | None = None             # mm — outer diameter of built cell
    measured_id: float | None = None             # mm — inner diameter (if measurable)
    num_turns: float | None = None               # counted turns from built cell

    # Electrode lengths (as cut / measured)
    cathode_length: float | None = None          # mm
    anode_length: float | None = None            # mm
    separator_length: float | None = None        # mm

    # Tab measurements
    cathode_tabs: list[ExperimentalTabData] | None = None
    anode_tabs: list[ExperimentalTabData] | None = None
    cathode_tab_spacings: list[float] | None = None   # consecutive spacings (mm)
    anode_tab_spacings: list[float] | None = None     # consecutive spacings (mm)
    first_cathode_tab_mm: float | None = None    # mm from cathode start to first tab
    first_anode_tab_mm: float | None = None      # mm from anode start to first tab
    num_cathode_tabs: int | None = None
    num_anode_tabs: int | None = None

    # Machine settings
    machine_tension: float | None = None         # machine tension setting (for correlation)
    winding_speed: float | None = None           # rpm or m/min

    notes: str | None = None


# ========== Design ==========
class DesignCreate(BaseModel):
    model_config = {"extra": "allow"}
    name: str = Field(..., max_length=255)
    description: str | None = None
    is_experimental: bool = False
    cathode_mix_id: UUID | None = None
    anode_mix_id: UUID | None = None
    layer_stack_id: UUID | None = None
    reference_design_id: UUID | None = None
    cell_params_preset_id: UUID | None = None  # preferred: FK into cell_param_presets
    cell_params: CellParams | None = None      # legacy inline snapshot (ignored if preset_id provided)
    layers: list[dict] | None = None
    elec_props: dict | None = None
    experimental_data: ExperimentalData | None = None


class DesignUpdate(BaseModel):
    model_config = {"extra": "allow"}
    name: str | None = None
    description: str | None = None
    is_experimental: bool | None = None
    cathode_mix_id: UUID | None = None
    anode_mix_id: UUID | None = None
    layer_stack_id: UUID | None = None
    reference_design_id: UUID | None = None
    cell_params_preset_id: UUID | None = None
    cell_params: CellParams | None = None
    layers: list[dict] | None = None
    elec_props: dict | None = None
    experimental_data: ExperimentalData | None = None


class DesignSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    version: str
    is_experimental: bool = False
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class SimResultSchema(BaseModel):
    id: UUID
    turns: list[dict]
    c_tabs: list[dict]
    a_tabs: list[dict]
    outer_r: float
    min_pitch: float
    max_pitch: float
    cathode_len: float | None = None
    anode_len: float | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class CapResultSchema(BaseModel):
    id: UUID
    cath_cap_ah: float
    anod_cap_ah: float
    cell_cap_ah: float
    np_ratio: float
    cell_energy_1e: float
    total_dry_mass: float
    full_result: dict
    created_at: datetime
    model_config = {"from_attributes": True}


class DesignDetail(DesignSummary):
    cathode_mix_id: UUID | None = None
    anode_mix_id: UUID | None = None
    layer_stack_id: UUID | None = None
    reference_design_id: UUID | None = None
    cell_params_preset_id: UUID | None = None
    cell_params: dict | None = None  # resolved params (from preset if linked, else legacy inline)
    layers: list[dict] | None = None
    elec_props: dict | None = None
    experimental_data: ExperimentalData | None = None
    cathode_mix: MixSchema | None = None
    anode_mix: MixSchema | None = None
    layer_stack: LayerStackSchema | None = None
    cell_params_preset: CellParamsPresetSchema | None = None
    sim_result: SimResultSchema | None = None
    cap_result: CapResultSchema | None = None


class DesignList(BaseModel):
    items: list[DesignSummary]
    total: int


# ========== Simulation Result ==========
class SimResultCreate(BaseModel):
    turns: list[dict]
    c_tabs: list[dict]
    a_tabs: list[dict]
    outer_r: float
    min_pitch: float
    max_pitch: float
    cathode_len: float | None = None
    anode_len: float | None = None


# ========== Capacity Result ==========
class CapResultCreate(BaseModel):
    cath_cap_ah: float
    anod_cap_ah: float
    cell_cap_ah: float
    np_ratio: float
    cell_energy_1e: float
    total_dry_mass: float
    full_result: dict


# ========== Inventory ==========
class InventoryItemCreate(BaseModel):
    name: str = Field(..., max_length=255)
    category: str = Field(..., max_length=50)         # DEPRECATED, see type/process_step/functionality
    unit: str = Field(..., max_length=30)
    supplier: str | None = None
    package_unit: str | None = None
    package_size: float | None = None
    quantity: float = 0
    lot_number: str | None = None                     # DEPRECATED, lots tracked in inventory_lots
    location: str | None = None
    reorder_point: float | None = None
    lead_time_days: int | None = None
    cost_per_unit: float | None = None
    cost_per_unit_gigascale: float | None = None
    bom_category: str | None = None                   # paste / mesh / tabs / separator / housing / electrolyte
    type: str | None = None                           # raw_chemical, separator, mesh, tab, can, lid, ...
    process_step: str | None = None                   # paste / electrode / winding / cell_assembly / module_assembly
    functionality: str | None = None                  # active_material, conductor, binder, separator, ...
    density: float | None = None
    is_active_mat: bool = False                       # DEPRECATED — capacity comes from mix wt% × cap
    thickness_mm: float | None = None
    width_mm: float | None = None
    color: str | None = None
    material_id: UUID | None = None
    chemical_id: UUID | None = None
    notes: str | None = None


class InventoryItemUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    unit: str | None = None
    supplier: str | None = None
    package_unit: str | None = None
    package_size: float | None = None
    quantity: float | None = None
    lot_number: str | None = None
    location: str | None = None
    reorder_point: float | None = None
    lead_time_days: int | None = None
    cost_per_unit: float | None = None
    cost_per_unit_gigascale: float | None = None
    bom_category: str | None = None
    type: str | None = None
    process_step: str | None = None
    functionality: str | None = None
    density: float | None = None
    is_active_mat: bool | None = None
    thickness_mm: float | None = None
    width_mm: float | None = None
    color: str | None = None
    material_id: UUID | None = None
    chemical_id: UUID | None = None
    notes: str | None = None


class InventoryItemSchema(InventoryItemCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ========== Inventory Lots (Phase 1) ==========
class InventoryLotCreate(BaseModel):
    inventory_item_id: UUID
    lot_number: str = Field(..., max_length=100)
    supplier: str | None = None
    received_date: datetime | None = None
    qty_received: float
    qty_remaining: float | None = None  # defaults to qty_received if omitted
    notes: str | None = None


class InventoryLotUpdate(BaseModel):
    lot_number: str | None = None
    supplier: str | None = None
    received_date: datetime | None = None
    qty_received: float | None = None
    qty_remaining: float | None = None
    notes: str | None = None


class InventoryLotSchema(BaseModel):
    id: UUID
    inventory_item_id: UUID
    lot_number: str
    supplier: str | None = None
    received_date: datetime
    qty_received: float
    qty_remaining: float
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ========== Inventory Transactions ==========
class InventoryTransactionCreate(BaseModel):
    inventory_item_id: UUID
    inventory_lot_id: UUID | None = None
    qty_change: float
    reason: str = Field(..., max_length=50)
    batch_id: str | None = None
    design_id: UUID | None = None
    performed_by: str | None = None
    notes: str | None = None


class InventoryTransactionSchema(InventoryTransactionCreate):
    id: UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# ========== Design BOM ==========
class BOMLineSchema(BaseModel):
    id: UUID
    design_id: UUID
    inventory_item_id: UUID | None = None
    material_id: UUID | None = None
    layer_name: str | None = None
    role: str | None = None
    qty_per_cell: float
    unit: str
    notes: str | None = None
    created_at: datetime
    material_name: str | None = None
    inventory_item_name: str | None = None
    model_config = {"from_attributes": True}


class BOMGenerateRequest(BaseModel):
    """Request to generate BOM from a saved design's simulation results."""
    design_id: UUID


class ProductionConsumeRequest(BaseModel):
    """Consume inventory for a production batch."""
    design_id: UUID
    cell_count: int
    batch_id: str | None = None
    performed_by: str | None = None
    notes: str | None = None


# ========== Product Recipes ==========
class RecipeLineCreate(BaseModel):
    product: str = Field(..., max_length=255)
    component: str = Field(..., max_length=255)
    qty: float
    unit: str = Field(..., max_length=30)
    notes: str | None = None


class RecipeLineSchema(RecipeLineCreate):
    id: UUID
    created_at: datetime
    model_config = {"from_attributes": True}


class RecipeBulkCreate(BaseModel):
    """Save one product's full recipe in one shot — replaces any existing lines for that product."""
    product: str = Field(..., max_length=255)
    lines: list[dict]  # [{component, qty, unit, notes}]


# ========== Production Log (consumes inventory via recipe) ==========
class ProductionLogRequest(BaseModel):
    product: str = Field(..., max_length=255)
    qty_produced: float
    batch_id: str | None = None
    performed_by: str | None = None
    production_date: str | None = None
    notes: str | None = None
    # Multi-supplier picker: per recipe component name, which inventory item
    # was actually used. If a component is missing here, the server falls back
    # to the first inventory item with a matching name.
    selections: dict[str, UUID] | None = None


class ProductionPreviewLine(BaseModel):
    component: str
    inventory_item_id: UUID | None
    inventory_item_name: str | None
    supplier: str | None
    needed: float
    unit: str
    shortfall: float
    lot_allocations: list[dict]


class ProductionPreview(BaseModel):
    product: str
    qty_produced: float
    lines: list[ProductionPreviewLine]


# ========== Receive Shipment ==========
class ReceiveShipmentRequest(BaseModel):
    inventory_item_id: UUID
    qty: float
    lot_number: str | None = None       # blank → routes to "unspecified" lot for this item
    supplier: str | None = None         # supplier on this specific lot (independent of catalog supplier)
    performed_by: str | None = None
    notes: str | None = None


# ========== Physical Count ==========
class PhysicalCountRequest(BaseModel):
    inventory_item_id: UUID
    counted_qty: float
    inventory_lot_id: UUID | None = None  # if omitted, adjust the "unspecified" lot
    performed_by: str | None = None
    notes: str | None = None
