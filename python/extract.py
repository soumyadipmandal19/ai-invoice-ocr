"""CLI entry point: emit one JSON result on stdout; diagnostics go to stderr."""

import argparse
import contextlib
import json
import sys
import traceback

from ocr.pdf_reader import ExtractionError
from ocr.document_reader import extract_document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file_path")
    parser.add_argument("--force-ocr", action="store_true")
    args = parser.parse_args()
    try:
        # Keep any library diagnostics out of the JSON output stream.
        with contextlib.redirect_stdout(sys.stderr):
            result = extract_document(args.file_path, force_ocr=args.force_ocr)
    except ExtractionError as error:
        result = {"error": {"code": error.code, "message": str(error)}}
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
