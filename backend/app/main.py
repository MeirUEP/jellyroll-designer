import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.config import get_settings
from app.database import engine
from app.routers import chemicals, materials, mixes, layer_stacks, designs, simulations, cell_param_presets, inventory


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(
    title="Jellyroll Designer API",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chemicals.router, prefix="/api/v1")
app.include_router(materials.router, prefix="/api/v1")
app.include_router(mixes.router, prefix="/api/v1")
app.include_router(layer_stacks.router, prefix="/api/v1")
app.include_router(cell_param_presets.router, prefix="/api/v1")
app.include_router(designs.router, prefix="/api/v1")
app.include_router(simulations.router, prefix="/api/v1")
app.include_router(inventory.router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}


# Serve frontend — must be AFTER API routes
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent  # jellyroll-designer/


@app.get("/")
async def serve_index():
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"detail": "index.html not found"}


@app.get("/designer.html")
async def serve_designer():
    f = FRONTEND_DIR / "designer.html"
    if f.exists():
        return FileResponse(f)
    return {"detail": "designer.html not found"}


@app.get("/inventory.html")
async def serve_inventory():
    f = FRONTEND_DIR / "inventory.html"
    if f.exists():
        return FileResponse(f)
    return {"detail": "inventory.html not found"}


# Serve any other static files (e.g. icons, images, js/) from the repo root
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
