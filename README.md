# Employee Tracker (Spec v4)

Internal time & activity tracking — Long Island City, NYC rules. See `docs/spec.md`.

Requires the MySQL84 Windows service running with an `emp_tracker` database
(see `docs/PROGRESS.md`). `start.bat` handles this automatically.

## Day 1 — run it

```powershell
# API
cd server; Copy-Item .env.example .env  # set DATABASE_URL
npm install; npm run migrate; npm run dev
# → http://localhost:5000/api/health

# UI (second terminal)
cd client; npm install; npm run dev
# → http://localhost:5173 → "API status: ok"
```

CPA: Eakub A. Khan CPA P.C. (export only, no payroll in-app).
