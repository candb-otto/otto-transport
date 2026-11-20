# Otto Transport System

Vehicle / GV request and allocation tracking for **Otto Clothing Pvt Ltd**.
Staff raise vehicle requests, Fleet Desk allocates a vehicle and driver, drivers update the trip, and management gets reports.

## How it is built

| Part | Where | What it is |
|---|---|---|
| Frontend | GitHub Pages (account `candb-otto`) | Plain HTML + CSS + JavaScript, no build step |
| Backend | Cloudflare Worker `otto-api` | `worker.js` – all business logic, login, roles |
| Database | Google Sheet | One tab per table (see below) |

The browser never talks to Google directly. It sends `POST` requests (JSON `{ fn, args }`) to the Worker, and the Worker reads/writes the Sheet using a Google service account.

## Files

```
index.html          Page structure (login, sidebar, top bar, modals)
app.css             All styling (layout, mobile drawer, pager, report + print styles)
app.js              All frontend logic (pages, filters, paging, exports, Management Report)
client-logo.png     Client logo (top bar, PDF header)
powered-by-logo.png "Powered by" logo (sidebar bottom, login, PDF header)
worker.js           Backend – deployed to Cloudflare (not hosted on GitHub Pages)
```

Keep `index.html`, `app.css`, `app.js` and the two logo files **in the same folder** of the GitHub repo.

## Roles

| Role | Access |
|---|---|
| Super_Admin | Everything Admin can do, plus **Management Report**; only role that can create/edit a Super_Admin |
| Admin | Users, masters (departments, locations, vehicles, drivers), all requests/allocations, reports |
| GV_User | Raise requests, see own requests, loading start/end for own goods-vehicle requests |
| FD_User | Fleet Desk: view pending requests, allocate, mark reached, start/end trip |
| Driver | Dashboard and **My Trips** (only own trips): Vehicle Reached, Start Trip, End Trip |

## Request flow

`Pending → Allocated → Reached → (Loading, goods vehicles only) → On Trip → Completed`
A request can also end as `Cancelled` or `Rejected`.

## Google Sheet tabs

`Users`, `Vehicles`, `Drivers`, `GV_Requests`, `Allocations`, `Status_Master`, `Department_Master`, `Location_Master`, `Notifications`

Important columns:
- **Drivers → EmployeeCode** (add this column).
- **Users → EmployeeCode**: for a Driver login this must match `Drivers.EmployeeCode`; that is how a driver sees only their own trips.
- **Users → Role**: one of `Super_Admin`, `Admin`, `GV_User`, `FD_User`, `Driver`.
- Dates are stored as text `dd/MM/yyyy HH:mm:ss` (IST).

## Setup

### 1. Google Sheet
1. Create the tabs above with their header rows.
2. Share the Sheet (Editor) with the service account email.
3. Create the first user directly in the `Users` sheet and set its Role to `Super_Admin`.

### 2. Cloudflare Worker
1. Create a Worker named `otto-api` and paste `worker.js`.
2. Add these variables (Settings → Variables, keep the key as a secret):

| Variable | Value |
|---|---|
| `SHEET_ID` | ID of the Google Sheet |
| `SA_EMAIL` | Service account email |
| `SA_PRIVATE_KEY` | Service account private key |
| `TOKEN_SECRET` | Any long random string (signs login tokens, 6 h) |
| `ALLOWED_ORIGIN` | `https://candb-otto.github.io` |

3. Deploy.

### 3. Frontend (GitHub Pages)
1. Upload `index.html`, `app.css`, `app.js`, `client-logo.png`, `powered-by-logo.png` to the repo.
2. Enable Pages (Settings → Pages → deploy from branch).
3. If the Worker URL ever changes, edit `API_URL` at the top of `app.js`.

## Features

- Role-based sidebar; mobile drawer menu (tap the menu icon).
- Paging in every list (10 per page, "Page x of y", numbered page buttons, total row count).
- Filters: GV Requests (requested by, date range, department); Allocations (requested by, date range, department, allocated by, driver).
- **Remarks** column on lists that have remarks (Locations, Vehicles, Drivers, Requests, Allocations, Reports).
- **Shared vehicle:** in the Allocate window, tick other Pending requests to carry them on the same vehicle and driver.
- **Planned Start** cannot be earlier than the current date and time.
- **Calculations** page (Super_Admin only) explains every number in the app.
- **Management Report** also has a Timeline Summary tab (department wise, with its own 1-page PDF) and % of requests raised on the KPI cards.
- CSV export on lists; in-app notifications (bell).
- **Management Report** (Super_Admin): quick date buttons (Today, Yesterday, Last 7 days, This Month), department filter, KPI cards vs previous period, process-time and process-gap KPIs, department/user-wise tables, vehicle and driver trip charts, generated insights.
  - **Export as CSV** – all tables.
  - **Export as PDF** – opens the print dialog with a fixed 2-page A4 layout; choose **Save as PDF** as the printer (turn "Headers and footers" off for a clean page).

## Updating

- Frontend change: replace the file(s) in GitHub, then hard-refresh (Ctrl+F5) because browsers cache `app.css` / `app.js`.
- Backend change: paste the new `worker.js` in Cloudflare and Deploy.

## Troubleshooting

| Symptom | Check |
|---|---|
| Page unstyled / blank | `app.css` / `app.js` not in the same folder as `index.html` |
| "Failed to fetch" | `ALLOWED_ORIGIN` wrong, or Worker not deployed |
| Sheet not found | Tab name misspelt or not shared with the service account |
| Driver sees "not linked" | Users.EmployeeCode does not match Drivers.EmployeeCode |
| Old screen after update | Hard refresh |
