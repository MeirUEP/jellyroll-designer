from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field


# ========== Cell Parameters ==========
class CellParams(BaseModel):
    mandrel_d: float
    target_od: float
    cell_h: float
    tab_w: float
    tab_h: float
    skip_turns: int
    cath_angle: float
    anod_angle: float


# ========== Layer ==========
class Layer(BaseModel):
    name: str
    type: Literal["mandrel", "anode", "cathode", "separator", "collector", "tape", "other"]
    t: float
    w: float
    len: float
    off: float
    color: str


# ========== Electrode Properties ==========
class ElecProps(BaseModel):
    cath_bulk_density: float
    cath_active_wt: float
    cath_spec_cap: float
    cath_mesh_dens: float
    anod_bulk_density: float
    anod_zn_wt: float
    anod_zno_wt: float
    anod_zn_cap: float
    anod_zno_cap: float
    anod_mesh_dens: float


# ========== Design ==========
class DesignCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    params: CellParams
    layers: list[Layer]
    elec_props: ElecProps


class DesignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    params: CellParams | None = None
    layers: list[Layer] | None = None
    elec_props: ElecProps | None = None


class DesignSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    version: str
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
    params: CellParams
    layers: list[Layer]
    elec_props: ElecProps
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


# ========== Capacity Result ==========
class CapResultCreate(BaseModel):
    cath_cap_ah: float
    anod_cap_ah: float
    cell_cap_ah: float
    np_ratio: float
    cell_energy_1e: float
    total_dry_mass: float
    full_result: dict


# ========== Import (matches frontend JSON save format) ==========
class DesignImport(BaseModel):
    version: str = "1.1"
    params: CellParams
    layers: list[Layer]
    elecProps: ElecProps | None = None
    name: str | None = None
