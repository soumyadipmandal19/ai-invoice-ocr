# Deployment

[Back to README](../README.md)

## Runtime requirements

Uploads are limited to 10 MB, PDFs to 1–20 pages, and still images to 20 million pixels. Extraction has a 120-second worker timeout and allows two active requests per Next.js process. OCR currently uses English language data; complex layouts and handwriting may need correction. The LLM mapping budget is smaller than the upload limit, so a valid upload can still be too large for financial organization.

## Hosting

Deploy to a Node.js host or container that also provides Python, the pinned Python packages, Tesseract language data, and a writable job directory. A static export cannot run this backend. The Python virtual environment must be recreated on the host; Next.js does not bundle it.

In production, disable `INNGEST_DEV`, configure `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, and sync `/api/inngest` with Inngest Cloud. Configure the public application URL and, when needed behind a reverse proxy, `AUTH_ORIGIN`. Keep all credentials server-side.

Temporary classification inputs live on the filesystem. Deployments with multiple app instances need a shared job directory accessible to upload and workflow requests, or a different shared job-storage implementation. Larger workloads should move extraction to a persistent worker. Authentication includes seven-day HTTP-only sessions and salted scrypt password hashing; email verification and password recovery are not implemented.

See the [environment template](../.env.example) for configuration keys.
