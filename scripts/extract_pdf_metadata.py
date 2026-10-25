#!/usr/bin/env python3
"""Build a local JSONL manifest with PDF metadata and citation hints.

The output is an inventory/sidecar for later upload; it does not contact OpenAI.
Only standard-library modules are required. If ``pdfinfo`` (Poppler) is
installed, its embedded PDF properties and page count are included.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def classify(name: str) -> tuple[str, str]:
    """Infer broad document class and a human-readable citation hint."""
    stem = Path(name).stem
    normalized = stem.casefold()
    thesis = re.search(r"tesis\s*(\d{7})", normalized)
    if thesis:
        return "jurisprudencia_tesis", f"Tesis {thesis.group(1)}; verificar rubro, época, registro y página en el PDF"
    if "acción de inconstitucionalidad" in normalized:
        return "sentencia", "Acción de inconstitucionalidad; verificar órgano, fecha, párrafo y página"
    if "precedente" in normalized or "sentencia" in normalized:
        return "precedente_judicial", "Precedente o sentencia; verificar expediente, órgano, fecha y página"
    if re.match(r"(?:ct|ct-)", normalized):
        return "criterio_judicial", "Criterio judicial; verificar expediente, órgano, fecha y página"
    if normalized in {"cpeum", "cnpp", "cpf", "codigo_de_comercio", "lfda", "lfpdppp", "lgpdppso", "lgsnsp", "lic", "lmtr", "lritf", "lsn"}:
        return "legislacion", "Texto normativo; citar ordenamiento, artículo, versión/fecha y página"
    if "infraestructura crítica" in normalized:
        return "documento_tecnico", "Documento técnico; verificar autoría, fecha, sección y página"
    if "protección de datos" in normalized:
        return "documento_tecnico", "Documento sobre protección de datos; verificar autoría, fecha, sección y página"
    return "documento", "Verificar título, autoría, fecha, sección y página en el PDF"


def pdf_properties(path: Path) -> dict[str, Any]:
    if not shutil.which("pdfinfo"):
        return {}
    try:
        result = subprocess.run(
            ["pdfinfo", str(path)], capture_output=True, text=True,
            timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if result.returncode:
        return {}
    properties: dict[str, Any] = {}
    keys = {
        "Title": "pdf_title", "Author": "pdf_author",
        "Subject": "pdf_subject", "Keywords": "pdf_keywords",
        "CreationDate": "pdf_creation_date", "ModDate": "pdf_modified_date",
        "Pages": "page_count",
    }
    for line in result.stdout.splitlines():
        key, sep, value = line.partition(":")
        target = keys.get(key.strip())
        value = value.strip()
        if not sep or not target or not value:
            continue
        if target == "page_count":
            try:
                properties[target] = int(value)
            except ValueError:
                pass
        else:
            properties[target] = value
    return properties


def make_record(path: Path, base: Path) -> dict[str, Any]:
    relative = path.relative_to(base).as_posix()
    doc_type, citation_hint = classify(path.name)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    properties = pdf_properties(path)
    record: dict[str, Any] = {
        "file_name": path.name,
        "source_path": relative,
        "file_type": "pdf",
        "document_type": doc_type,
        "jurisdiction": "México",
        "citation_hint": citation_hint,
        "sha256": digest.hexdigest(),
        "file_size_bytes": path.stat().st_size,
        "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **properties,
    }
    record["title"] = properties.get("pdf_title") or path.stem
    # OpenAI vector-store attributes support at most 16 scalar key/value pairs.
    # Keep this compact map alongside the richer local record.
    record["openai_attributes"] = {
        "document_type": doc_type,
        "jurisdiction": "México",
        "source_path": relative,
        "file_name": path.name,
        "sha256": digest.hexdigest(),
        **({"page_count": properties["page_count"]} if "page_count" in properties else {}),
    }
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "resource", help="carpeta con PDFs (default: resource/)")
    parser.add_argument("--output", type=Path, default=ROOT / "metadata" / "document_manifest.jsonl", help="JSONL de salida")
    args = parser.parse_args()
    source = args.input.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        parser.error(f"No existe la carpeta de entrada: {source}")
    pdfs = sorted(p for p in source.rglob("*") if p.is_file() and p.suffix.casefold() == ".pdf")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as stream:
        for path in pdfs:
            stream.write(json.dumps(make_record(path, source), ensure_ascii=False) + "\n")
    print(f"Procesados {len(pdfs)} PDFs; manifiesto: {output}")
    if not shutil.which("pdfinfo"):
        print("Aviso: instala Poppler (pdfinfo) para extraer propiedades y número de páginas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
