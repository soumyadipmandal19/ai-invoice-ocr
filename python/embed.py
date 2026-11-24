"""Local-only Nomic embedding worker. JSON enters stdin; JSON leaves stdout."""
import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import sys

MODEL = "nomic-embed-text-v1.5"
DIMENSIONS = 768


def generate(payload, download=False):
    texts = payload.get("texts")
    task = payload.get("task", "search_document")
    if (not isinstance(texts, list) or not 1 <= len(texts) <= 128
            or any(not isinstance(text, str) or not text.strip() or len(text) > 2000 for text in texts)
            or task not in ("search_document", "search_query")):
        raise ValueError("Invalid embedding input")
    model_path = Path(os.environ.get("EMBEDDING_MODEL_PATH", ".data/models/nomic")).resolve()
    if download:
        model_path.mkdir(parents=True, exist_ok=True)
    # Native/library progress must never corrupt the JSON response.
    with contextlib.redirect_stdout(sys.stderr):
        from nomic import embed
        result = embed.text(
            texts=texts, model=MODEL, task_type=task, dimensionality=DIMENSIONS,
            inference_mode="local", device=os.environ.get("EMBEDDING_DEVICE", "cpu"),
            model_path=str(model_path), allow_download=download, long_text_mode="mean",
        )
    vectors = result["embeddings"]
    if (result.get("inference_mode") != "local" or len(vectors) != len(texts)
            or any(len(v) != DIMENSIONS or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in v)
                   or not any(n != 0 for n in v) for v in vectors)):
        raise ValueError("Invalid local embedding response")
    return {"model": MODEL, "dimensions": DIMENSIONS, "inferenceMode": "local", "vectors": vectors}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="Download/cache the model and run a smoke check")
    args = parser.parse_args()
    try:
        payload = {"texts": ["Local embedding setup check."]} if args.download else json.loads(sys.stdin.read(2_000_001))
        result = generate(payload, download=args.download)
        if args.download:
            result.pop("vectors")
            result["ready"] = True
        print(json.dumps(result, allow_nan=False))
    except Exception:
        # Do not expose OCR, filesystem paths, or dependency error details.
        print(json.dumps({"error": "Local embedding failed. Check dependencies and run python/embed.py --download."}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
