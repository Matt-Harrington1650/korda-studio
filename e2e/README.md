# E2E Tests

## Prerequisites

E2E tests drive the real Electron app. The compiled main entry (`.vite/build/main.js`)
must exist before running tests.

**Generate it:**
```
npm start
# Wait for the app window to open, then press Ctrl+C
```

## Running

```
npm run test:e2e
```

## Test data

Tests use `src/main/__testdata__/projects/` which contains:
- `PROJ-001/C-101_IFC_Rev_A.dwg`
- `PROJ-001/S-201_DD.pdf`
- `PROJ-002/Footing_Calc_Rev2.xlsx`
- `PROJ-002/Geotech_Report_Final.pdf`
